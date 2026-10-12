import { Op } from 'sequelize';
import { sequelize } from '../config/database';
import { User } from '../models/user.model';
import { FaceVerification, FaceVerificationStatus } from '../models/faceVerification.model';
import { s3Service, S3ServiceError } from './s3.service';
import { rekognitionService, RekognitionServiceError } from './rekognition.service';
import { env } from '../config/env';

export interface ProcessVerificationInput {
  userId: string;
  imageBuffer: Buffer;
  originalFilename?: string;
  mimeType?: string;
  fileSize?: number;
  verificationType?: string;
  referenceImageBuffer?: Buffer;
}

export interface VerificationResponseData {
  verificationId: string;
  status: FaceVerificationStatus;
  verificationType: string;
  similarity?: number | null;
  attemptNo: number;
  isLatest: boolean;
  faceDetected: boolean;
  faceCount: number;
  quality?: {
    brightness?: number;
    sharpness?: number;
    confidence?: number;
  };
  rejectionReason?: string | null;
  reasonCode: string;
  reasonMessage?: string | null;
  liveness: {
    status: string;
    message: string;
  };
}

export class FaceVerificationServiceError extends Error {
  public statusCode: number;
  public errorCode?: string;
  public data?: any;

  constructor(message: string, statusCode: number = 400, errorCode?: string, data?: any) {
    super(message);
    this.name = 'FaceVerificationServiceError';
    this.statusCode = statusCode;
    this.errorCode = errorCode;
    this.data = data;
    Object.setPrototypeOf(this, FaceVerificationServiceError.prototype);
  }
}

export class FaceVerificationService {
  private activeUserVerifications: Set<string> = new Set();
  private static readonly MAX_ATTEMPTS_PER_HOUR = 10;

  /**
   * Main verification orchestrator using AWS S3 & Rekognition with Laravel-compatible flow
   */
  public async processFaceVerification(
    input: ProcessVerificationInput
  ): Promise<VerificationResponseData> {
    const {
      userId,
      imageBuffer,
      originalFilename,
      mimeType,
      fileSize,
      verificationType = 'gesture',
      referenceImageBuffer,
    } = input;

    if (!userId || typeof userId !== 'string' || !userId.trim()) {
      throw new FaceVerificationServiceError('User ID is required', 401, 'UNAUTHORIZED');
    }

    if (!imageBuffer || !Buffer.isBuffer(imageBuffer) || imageBuffer.length === 0) {
      throw new FaceVerificationServiceError('No selfie image provided', 400, 'MISSING_IMAGE_FILE');
    }

    // 1. Concurrency Protection: Prevent simultaneous submissions by the same user
    if (this.activeUserVerifications.has(userId)) {
      throw new FaceVerificationServiceError(
        'Face verification is already in progress for this account. Please wait.',
        429,
        'CONCURRENT_REQUEST'
      );
    }

    this.activeUserVerifications.add(userId);

    try {
      // 2. Fetch authenticated user
      const user = await User.findByPk(userId);
      if (!user) {
        throw new FaceVerificationServiceError('User account not found', 404, 'USER_NOT_FOUND');
      }

      if (!user.isActive) {
        throw new FaceVerificationServiceError('User account is deactivated', 403, 'USER_DEACTIVATED');
      }

      // 3. Hourly Rate Limiting check (10 attempts/hour)
      const oneHourAgo = new Date(Date.now() - 3600 * 1000);
      const recentAttemptsCount = await FaceVerification.count({
        where: {
          userId,
          createdAt: {
            [Op.gte]: oneHourAgo,
          },
        },
      });

      if (recentAttemptsCount >= FaceVerificationService.MAX_ATTEMPTS_PER_HOUR) {
        throw new FaceVerificationServiceError(
          `Maximum verification attempts (${FaceVerificationService.MAX_ATTEMPTS_PER_HOUR}/hour) reached. Please try again in 1 hour.`,
          429,
          'RATE_LIMIT_EXCEEDED'
        );
      }

      // 4. Retrieve Primary Reference Profile Photo (Optional for first-time registration)
      let targetImageBuffer: Buffer | null = null;
      let hasReferencePhoto = false;

      if (referenceImageBuffer && Buffer.isBuffer(referenceImageBuffer) && referenceImageBuffer.length > 0) {
        targetImageBuffer = referenceImageBuffer;
        hasReferencePhoto = true;
      } else if (user.profilePicture && typeof user.profilePicture === 'string' && user.profilePicture.trim()) {
        try {
          targetImageBuffer = await s3Service.getObjectBuffer(user.profilePicture.trim());
          hasReferencePhoto = true;
        } catch (s3Err: any) {
          if (s3Err instanceof S3ServiceError && s3Err.statusCode === 404) {
            console.warn('[Profile Photo Fetch Warning] Primary profile photo not found in storage:', user.profilePicture);
            hasReferencePhoto = false;
          } else {
            console.error('[Profile Photo Fetch Error]:', s3Err.message);
            throw new FaceVerificationServiceError(
              'Failed to retrieve primary profile photo from secure storage.',
              503,
              'STORAGE_UNAVAILABLE'
            );
          }
        }
      }

      // 5. Upload Selfie to Private S3 Bucket
      let s3Key: string;
      try {
        s3Key = await s3Service.uploadPrivateImage(
          imageBuffer,
          userId,
          mimeType || 'image/jpeg',
          'verifications'
        );
      } catch (uploadErr: any) {
        console.error('[S3 Selfie Upload Error]:', uploadErr.message);
        throw new FaceVerificationServiceError(
          `Failed to securely store verification selfie image: ${uploadErr.message || 'S3 upload error'}`,
          500,
          'S3_UPLOAD_FAILED'
        );
      }

      const totalAttempts = await FaceVerification.count({ where: { userId: user.id } });
      const currentAttemptNo = totalAttempts + 1;

      // 6. Face Detection on Uploaded Selfie via AWS Rekognition
      let detectResult;
      try {
        detectResult = await rekognitionService.detectFaces(imageBuffer);
      } catch (detErr: any) {
        if (detErr instanceof RekognitionServiceError) {
          throw new FaceVerificationServiceError(
            detErr.message,
            detErr.statusCode,
            detErr.errorCode
          );
        }
        throw new FaceVerificationServiceError(
          'Face detection failed due to an unexpected error.',
          503,
          'REKOGNITION_SERVICE_UNAVAILABLE'
        );
      }

      const primaryFace = detectResult.faces[0];
      const qualityInfo = primaryFace
        ? {
            brightness: primaryFace.brightness,
            sharpness: primaryFace.sharpness,
            confidence: primaryFace.confidence,
          }
        : undefined;

      const safeMetadata = {
        originalFilename: originalFilename || 'selfie.jpg',
        mimeType: mimeType || 'image/jpeg',
        fileSize: fileSize || imageBuffer.length,
        faceCount: detectResult.faceCount,
        quality: qualityInfo,
        s3Key,
      };

      // 7. Handle No Face or Multiple Faces Detection Failures
      if (detectResult.errorReason) {
        const failedStatus: FaceVerificationStatus =
          detectResult.errorReason === 'NO_FACE_DETECTED' ? 'action_required' : 'rejected';

        const record = await sequelize.transaction(async (transaction) => {
          await FaceVerification.update(
            { isLatest: false },
            { where: { userId: user.id, isLatest: true }, transaction }
          );

          return await FaceVerification.create(
            {
              userId: user.id,
              status: failedStatus,
              verificationType,
              sourceImage: s3Key,
              faceDetected: detectResult.faceCount > 0,
              faceCount: detectResult.faceCount,
              qualityScore: primaryFace?.confidence || null,
              brightnessScore: primaryFace?.brightness || null,
              similarityScore: null,
              identityMatched: false,
              livenessStatus: 'unavailable_single_frame',
              reasonCode: detectResult.errorReason!,
              reasonMessage: detectResult.errorMessage,
              rejectionReason: detectResult.errorReason,
              attempts: currentAttemptNo,
              attemptNo: currentAttemptNo,
              isLatest: true,
              metadata: safeMetadata,
            },
            { transaction }
          );
        });

        return {
          verificationId: record.id,
          status: failedStatus,
          verificationType,
          similarity: null,
          attemptNo: currentAttemptNo,
          isLatest: true,
          faceDetected: detectResult.faceCount > 0,
          faceCount: detectResult.faceCount,
          quality: qualityInfo,
          rejectionReason: detectResult.errorReason,
          reasonCode: detectResult.errorReason,
          reasonMessage: detectResult.errorMessage,
          liveness: {
            status: 'unavailable_single_frame',
            message: 'Single 2D selfie image cannot establish 3D liveness or active presence',
          },
        };
      }

      // 8. Face Comparison or First-Time Face Registration Approval
      let isApproved = false;
      let similarityScore: number | null = null;
      let finalStatus: FaceVerificationStatus = 'rejected';
      let finalReasonCode = 'IDENTITY_MISMATCH';
      let finalReasonMessage = 'The selfie did not match the primary profile photo';
      let rejectionReason: string | null = null;

      if (hasReferencePhoto && targetImageBuffer) {
        // Compare against existing profile photo via AWS Rekognition
        let compareResult;
        try {
          compareResult = await rekognitionService.compareFaces(
            imageBuffer,
            targetImageBuffer,
            env.FACE_SIMILARITY_THRESHOLD
          );
        } catch (compErr: any) {
          if (compErr instanceof RekognitionServiceError) {
            throw new FaceVerificationServiceError(
              compErr.message,
              compErr.statusCode,
              compErr.errorCode
            );
          }
          throw new FaceVerificationServiceError(
            'Face comparison service is temporarily unavailable.',
            503,
            'REKOGNITION_SERVICE_UNAVAILABLE'
          );
        }

        isApproved = compareResult.isMatch;
        similarityScore = compareResult.similarity;
        finalStatus = isApproved ? 'approved' : 'rejected';
        finalReasonCode = isApproved ? 'VERIFICATION_SUCCESSFUL' : 'IDENTITY_MISMATCH';
        finalReasonMessage = isApproved
          ? 'Identity verification completed successfully'
          : 'The selfie did not match the primary profile photo';
        rejectionReason = isApproved ? null : 'IDENTITY_MISMATCH';
      } else {
        // First-time face verification: Exactly 1 valid face detected in front of the camera
        isApproved = true;
        similarityScore = 100;
        finalStatus = 'approved';
        finalReasonCode = 'VERIFICATION_SUCCESSFUL';
        finalReasonMessage = 'Real face detected and identity verified successfully';
        rejectionReason = null;
      }

      // 9. Atomic Database Persistence & User Verification State Update
      const record = await sequelize.transaction(async (transaction) => {
        // Mark previous verification records as not latest
        await FaceVerification.update(
          { isLatest: false },
          { where: { userId: user.id, isLatest: true }, transaction }
        );

        // Create new verification record
        const createdRecord = await FaceVerification.create(
          {
            userId: user.id,
            status: finalStatus,
            verificationType,
            sourceImage: s3Key,
            faceDetected: true,
            faceCount: 1,
            qualityScore: primaryFace?.confidence || null,
            brightnessScore: primaryFace?.brightness || null,
            similarityScore,
            identityMatched: isApproved,
            livenessStatus: 'unavailable_single_frame',
            reasonCode: finalReasonCode,
            reasonMessage: finalReasonMessage,
            rejectionReason,
            attempts: currentAttemptNo,
            attemptNo: currentAttemptNo,
            isLatest: true,
            metadata: {
              ...safeMetadata,
              similarity: similarityScore,
              isFirstTimeRegistration: !hasReferencePhoto,
            },
          },
          { transaction }
        );

        // Update User verification status and profile picture upon approval
        if (isApproved) {
          user.isFaceVerified = true;
          user.faceVerifiedAt = new Date();
          // If the user has no profile photo set, set this verified selfie as their profile photo
          if (!user.profilePicture) {
            user.profilePicture = s3Key;
          }
          await user.save({ transaction });
        }

        return createdRecord;
      });

      return {
        verificationId: record.id,
        status: finalStatus,
        verificationType,
        similarity: similarityScore,
        attemptNo: currentAttemptNo,
        isLatest: true,
        faceDetected: true,
        faceCount: 1,
        quality: qualityInfo,
        rejectionReason,
        reasonCode: finalReasonCode,
        reasonMessage: finalReasonMessage,
        liveness: {
          status: 'unavailable_single_frame',
          message: 'Single 2D selfie image cannot establish 3D liveness or active presence',
        },
      };
    } finally {
      this.activeUserVerifications.delete(userId);
    }
  }
}

export const faceVerificationService = new FaceVerificationService();
