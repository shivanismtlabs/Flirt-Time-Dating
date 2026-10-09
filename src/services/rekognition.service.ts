import {
  DetectFacesCommand,
  CompareFacesCommand,
  Attribute,
  Pose,
  BoundingBox,
} from '@aws-sdk/client-rekognition';
import { getRekognitionClient } from '../config/aws';
import { env } from '../config/env';

export interface RekognitionDetectFaceResult {
  faceCount: number;
  faces: Array<{
    confidence: number;
    brightness?: number;
    sharpness?: number;
    pose?: {
      roll?: number;
      yaw?: number;
      pitch?: number;
    };
    boundingBox?: {
      width?: number;
      height?: number;
      left?: number;
      top?: number;
    };
  }>;
  errorReason?: string;
  errorMessage?: string;
}

export interface RekognitionCompareResult {
  isMatch: boolean;
  similarity: number;
  confidence: number;
  threshold: number;
  faceMatchDetails?: any;
}

export class RekognitionServiceError extends Error {
  public statusCode: number;
  public errorCode: string;
  public isTransient: boolean;

  constructor(message: string, statusCode = 500, errorCode = 'REKOGNITION_ERROR', isTransient = true) {
    super(message);
    this.name = 'RekognitionServiceError';
    this.statusCode = statusCode;
    this.errorCode = errorCode;
    this.isTransient = isTransient;
    Object.setPrototypeOf(this, RekognitionServiceError.prototype);
  }
}

export class RekognitionService {
  /**
   * Detects faces and extracts facial quality signals in an image buffer using AWS Rekognition DetectFaces
   */
  public async detectFaces(imageBuffer: Buffer): Promise<RekognitionDetectFaceResult> {
    const client = getRekognitionClient();

    try {
      const command = new DetectFacesCommand({
        Image: {
          Bytes: imageBuffer,
        },
        Attributes: [Attribute.ALL],
      });

      const response = await client.send(command);
      const faceDetails = response.FaceDetails || [];

      if (faceDetails.length === 0) {
        return {
          faceCount: 0,
          faces: [],
          errorReason: 'NO_FACE_DETECTED',
          errorMessage: 'No face detected in the uploaded selfie. Please take a clear photo showing your face.',
        };
      }

      if (faceDetails.length > 1) {
        return {
          faceCount: faceDetails.length,
          faces: faceDetails.map((f) => ({
            confidence: f.Confidence || 0,
            brightness: f.Quality?.Brightness,
            sharpness: f.Quality?.Sharpness,
            pose: f.Pose
              ? {
                  roll: f.Pose.Roll,
                  yaw: f.Pose.Yaw,
                  pitch: f.Pose.Pitch,
                }
              : undefined,
            boundingBox: f.BoundingBox
              ? {
                  width: f.BoundingBox.Width,
                  height: f.BoundingBox.Height,
                  left: f.BoundingBox.Left,
                  top: f.BoundingBox.Top,
                }
              : undefined,
          })),
          errorReason: 'MULTIPLE_FACES_DETECTED',
          errorMessage: 'Multiple faces detected. Please upload a selfie with only yourself.',
        };
      }

      const primaryFace = faceDetails[0];
      return {
        faceCount: 1,
        faces: [
          {
            confidence: primaryFace.Confidence || 0,
            brightness: primaryFace.Quality?.Brightness,
            sharpness: primaryFace.Quality?.Sharpness,
            pose: primaryFace.Pose
              ? {
                  roll: primaryFace.Pose.Roll,
                  yaw: primaryFace.Pose.Yaw,
                  pitch: primaryFace.Pose.Pitch,
                }
              : undefined,
            boundingBox: primaryFace.BoundingBox
              ? {
                  width: primaryFace.BoundingBox.Width,
                  height: primaryFace.BoundingBox.Height,
                  left: primaryFace.BoundingBox.Left,
                  top: primaryFace.BoundingBox.Top,
                }
              : undefined,
          },
        ],
      };
    } catch (error: any) {
      if (
        error.name === 'InvalidImageFormatException' ||
        error.name === 'InvalidParameterException'
      ) {
        throw new RekognitionServiceError(
          'The uploaded image is corrupted or in an unsupported format for face analysis.',
          400,
          'INVALID_IMAGE_FORMAT',
          false
        );
      }

      if (error.name === 'ImageTooLargeException') {
        throw new RekognitionServiceError(
          'Image dimensions or payload too large for face recognition analysis.',
          400,
          'IMAGE_TOO_LARGE',
          false
        );
      }

      console.error('[AWS Rekognition DetectFaces Error]:', error.message || error);
      throw new RekognitionServiceError(
        `AWS Rekognition service failure: ${error.message || 'Face detection failed'}`,
        503,
        'REKOGNITION_SERVICE_UNAVAILABLE',
        true
      );
    }
  }

  /**
   * Compares the uploaded selfie against the primary reference profile photo using AWS Rekognition CompareFaces
   */
  public async compareFaces(
    sourceImageBuffer: Buffer,
    targetImageBuffer: Buffer,
    customThreshold?: number
  ): Promise<RekognitionCompareResult> {
    const client = getRekognitionClient();
    const threshold = customThreshold !== undefined ? customThreshold : env.FACE_SIMILARITY_THRESHOLD;

    try {
      const command = new CompareFacesCommand({
        SourceImage: {
          Bytes: sourceImageBuffer,
        },
        TargetImage: {
          Bytes: targetImageBuffer,
        },
        SimilarityThreshold: threshold,
      });

      const response = await client.send(command);
      const faceMatches = response.FaceMatches || [];
      const unmatchedFaces = response.UnmatchedFaces || [];

      if (faceMatches.length > 0) {
        // Take the highest matching face
        const bestMatch = faceMatches.reduce((prev, curr) =>
          (curr.Similarity || 0) > (prev.Similarity || 0) ? curr : prev
        );

        const similarity = Math.round((bestMatch.Similarity || 0) * 10) / 10;
        const isMatch = similarity >= threshold;

        return {
          isMatch,
          similarity,
          confidence: bestMatch.Face?.Confidence || 0,
          threshold,
          faceMatchDetails: bestMatch,
        };
      }

      // No matches passed the threshold
      return {
        isMatch: false,
        similarity: unmatchedFaces.length > 0 ? 0 : 0,
        confidence: 0,
        threshold,
      };
    } catch (error: any) {
      if (
        error.name === 'InvalidImageFormatException' ||
        error.name === 'InvalidParameterException'
      ) {
        throw new RekognitionServiceError(
          'One of the images could not be parsed by the face comparison service.',
          400,
          'INVALID_IMAGE_FORMAT',
          false
        );
      }

      console.error('[AWS Rekognition CompareFaces Error]:', error.message || error);
      throw new RekognitionServiceError(
        `AWS Rekognition comparison failed: ${error.message || 'Comparison error'}`,
        503,
        'REKOGNITION_SERVICE_UNAVAILABLE',
        true
      );
    }
  }
}

export const rekognitionService = new RekognitionService();
