import request from 'supertest';
import app from '../src/app';
import { sequelize, User, FaceVerification } from '../src/models';
import { generateToken } from '../src/utils/jwt';
import {
  createSingleFaceImage,
  createBlankImage,
  createMultiFaceImage,
} from './helpers/imageFixtures';
import { s3Service } from '../src/services/s3.service';
import { rekognitionService, RekognitionServiceError } from '../src/services/rekognition.service';

describe('Laravel-Compatible Face Recognition API (POST /api/v1/gesture-upload)', () => {
  let testUser: User;
  let authToken: string;

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    await sequelize.sync({ force: true });
  });

  beforeEach(async () => {
    jest.restoreAllMocks();
    await FaceVerification.destroy({ where: {}, truncate: true });
    await User.destroy({ where: {}, truncate: true });

    testUser = await User.create({
      username: 'facetestuser_99',
      email: 'facetestuser@example.com',
      fullName: 'Face Test User',
      isPhoneVerified: true,
      role: 'user',
      isActive: true,
      isProfileComplete: true,
      isFaceVerified: false,
      profilePicture: 'profiles/facetestuser_99/primary_photo.jpg',
    });

    authToken = generateToken({
      id: testUser.id,
      email: testUser.email,
      phone: testUser.phone,
      role: testUser.role,
    });

    // Default mock: S3 uploads & retrieval
    jest.spyOn(s3Service, 'uploadPrivateImage').mockResolvedValue('verifications/user99/test_selfie.jpg');
    jest.spyOn(s3Service, 'getObjectBuffer').mockResolvedValue(Buffer.alloc(2048, 1));
  });

  afterAll(async () => {
    jest.restoreAllMocks();
  });

  describe('1. Unauthenticated Request', () => {
    it('should reject requests without Authorization header with 401', async () => {
      const validImage = await createBlankImage(300, 300);

      const res = await request(app)
        .post('/api/v1/gesture-upload')
        .attach('selfie_image', validImage, 'selfie.jpg');

      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
      expect(res.body.message).toMatch(/token missing or malformed/i);
    });
  });

  describe('2. Missing Selfie Image', () => {
    it('should reject request when no selfie image is attached with 400', async () => {
      const res = await request(app)
        .post('/api/v1/gesture-upload')
        .set('Authorization', `Bearer ${authToken}`);

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.error).toBe('MISSING_IMAGE_FILE');
    });
  });

  describe('3. Invalid Image Format', () => {
    it('should reject unsupported file formats (e.g. text/pdf) with 400', async () => {
      const textBuffer = Buffer.from('This is a text file not an image');

      const res = await request(app)
        .post('/api/v1/gesture-upload')
        .set('Authorization', `Bearer ${authToken}`)
        .attach('selfie_image', textBuffer, 'document.txt');

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.message).toMatch(/unsupported file format/i);
    });
  });

  describe('4. Image Exceeding Upload Limit', () => {
    it('should reject files exceeding the 5MB size limit with 400 FILE_TOO_LARGE', async () => {
      // 6MB buffer
      const largeBuffer = Buffer.alloc(6 * 1024 * 1024, 0xff);

      const res = await request(app)
        .post('/api/v1/gesture-upload')
        .set('Authorization', `Bearer ${authToken}`)
        .attach('selfie_image', largeBuffer, 'huge_selfie.jpg');

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.error).toBe('FILE_TOO_LARGE');
    });
  });

  describe('5. Missing Primary Profile Photo', () => {
    it('should return 422 with MISSING_PRIMARY_PHOTO when user has no primary profile photo', async () => {
      // Set user's profilePicture to null
      testUser.profilePicture = null;
      await testUser.save();

      const validImage = await createBlankImage(300, 300);

      const res = await request(app)
        .post('/api/v1/gesture-upload')
        .set('Authorization', `Bearer ${authToken}`)
        .attach('selfie_image', validImage, 'selfie.jpg');

      expect(res.status).toBe(422);
      expect(res.body.success).toBe(false);
      expect(res.body.error).toBe('MISSING_PRIMARY_PHOTO');
      expect(res.body.message).toMatch(/no primary profile photo found/i);
    });
  });

  describe('6. No Face Detected in Selfie', () => {
    it('should return action_required with NO_FACE_DETECTED when 0 faces found', async () => {
      const validImage = await createBlankImage(300, 300);

      jest.spyOn(rekognitionService, 'detectFaces').mockResolvedValueOnce({
        faceCount: 0,
        faces: [],
        errorReason: 'NO_FACE_DETECTED',
        errorMessage: 'No face detected in the uploaded selfie. Please take a clear photo showing your face.',
      });

      const res = await request(app)
        .post('/api/v1/gesture-upload')
        .set('Authorization', `Bearer ${authToken}`)
        .attach('selfie_image', validImage, 'blank.jpg');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.status).toBe('action_required');
      expect(res.body.data.faceDetected).toBe(false);
      expect(res.body.data.faceCount).toBe(0);
      expect(res.body.data.reasonCode).toBe('NO_FACE_DETECTED');

      // User must not be verified
      const user = await User.findByPk(testUser.id);
      expect(user?.isFaceVerified).toBe(false);
    });
  });

  describe('7. Multiple Faces Detected in Selfie', () => {
    it('should reject with MULTIPLE_FACES_DETECTED when more than 1 face is in frame', async () => {
      const validImage = await createMultiFaceImage(600, 400);

      jest.spyOn(rekognitionService, 'detectFaces').mockResolvedValueOnce({
        faceCount: 2,
        faces: [
          { confidence: 99.2, brightness: 75, sharpness: 80 },
          { confidence: 98.1, brightness: 72, sharpness: 78 },
        ],
        errorReason: 'MULTIPLE_FACES_DETECTED',
        errorMessage: 'Multiple faces detected. Please upload a selfie with only yourself.',
      });

      const res = await request(app)
        .post('/api/v1/gesture-upload')
        .set('Authorization', `Bearer ${authToken}`)
        .attach('selfie_image', validImage, 'multiface.jpg');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.status).toBe('rejected');
      expect(res.body.data.faceCount).toBe(2);
      expect(res.body.data.rejectionReason).toBe('MULTIPLE_FACES_DETECTED');
    });
  });

  describe('8. Successful Face Match (Similarity >= 85%)', () => {
    it('should approve verification and update user isFaceVerified = true on match', async () => {
      const validImage = await createSingleFaceImage(400, 400);

      jest.spyOn(rekognitionService, 'detectFaces').mockResolvedValueOnce({
        faceCount: 1,
        faces: [{ confidence: 99.5, brightness: 82, sharpness: 90 }],
      });

      jest.spyOn(rekognitionService, 'compareFaces').mockResolvedValueOnce({
        isMatch: true,
        similarity: 91.5,
        confidence: 99.5,
        threshold: 85,
      });

      const res = await request(app)
        .post('/api/v1/gesture-upload')
        .set('Authorization', `Bearer ${authToken}`)
        .attach('selfie_image', validImage, 'selfie.jpg');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.message).toMatch(/completed successfully/i);
      expect(res.body.data.status).toBe('approved');
      expect(res.body.data.similarity).toBe(91.5);
      expect(res.body.data.attemptNo).toBe(1);
      expect(res.body.data.isLatest).toBe(true);
      expect(res.body.data.liveness.status).toBe('unavailable_single_frame');

      // Verify database record
      const record = await FaceVerification.findByPk(res.body.data.verificationId);
      expect(record).not.toBeNull();
      expect(record?.status).toBe('approved');
      expect(record?.sourceImage).toBe('verifications/user99/test_selfie.jpg');
      expect(record?.isLatest).toBe(true);

      // Verify user model updated
      const updatedUser = await User.findByPk(testUser.id);
      expect(updatedUser?.isFaceVerified).toBe(true);
      expect(updatedUser?.faceVerifiedAt).not.toBeNull();
    });

    it('should support legacy route POST /api/v1/face-verification/upload and field name "image"', async () => {
      const validImage = await createSingleFaceImage(400, 400);

      jest.spyOn(rekognitionService, 'detectFaces').mockResolvedValueOnce({
        faceCount: 1,
        faces: [{ confidence: 99.0, brightness: 80, sharpness: 88 }],
      });

      jest.spyOn(rekognitionService, 'compareFaces').mockResolvedValueOnce({
        isMatch: true,
        similarity: 88.0,
        confidence: 99.0,
        threshold: 85,
      });

      const res = await request(app)
        .post('/api/v1/face-verification/upload')
        .set('Authorization', `Bearer ${authToken}`)
        .attach('image', validImage, 'selfie.jpg');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.status).toBe('approved');
      expect(res.body.data.similarity).toBe(88.0);
    });
  });

  describe('9. Completed Face Mismatch (Similarity < 85%)', () => {
    it('should reject verification with IDENTITY_MISMATCH when faces do not match', async () => {
      const validImage = await createSingleFaceImage(400, 400);

      jest.spyOn(rekognitionService, 'detectFaces').mockResolvedValueOnce({
        faceCount: 1,
        faces: [{ confidence: 99.1, brightness: 81, sharpness: 89 }],
      });

      jest.spyOn(rekognitionService, 'compareFaces').mockResolvedValueOnce({
        isMatch: false,
        similarity: 42.0,
        confidence: 99.1,
        threshold: 85,
      });

      const res = await request(app)
        .post('/api/v1/gesture-upload')
        .set('Authorization', `Bearer ${authToken}`)
        .attach('selfie_image', validImage, 'selfie.jpg');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.status).toBe('rejected');
      expect(res.body.data.rejectionReason).toBe('IDENTITY_MISMATCH');
      expect(res.body.data.similarity).toBe(42.0);

      // User must NOT be marked verified
      const updatedUser = await User.findByPk(testUser.id);
      expect(updatedUser?.isFaceVerified).toBe(false);
    });
  });

  describe('10. AWS Timeout / Permission / Transient Service Error', () => {
    it('should return 503 REKOGNITION_SERVICE_UNAVAILABLE and NEVER mark as mismatch', async () => {
      const validImage = await createBlankImage(300, 300);

      jest.spyOn(rekognitionService, 'detectFaces').mockRejectedValueOnce(
        new RekognitionServiceError(
          'AWS Rekognition service failure: Connection timeout',
          503,
          'REKOGNITION_SERVICE_UNAVAILABLE',
          true
        )
      );

      const res = await request(app)
        .post('/api/v1/gesture-upload')
        .set('Authorization', `Bearer ${authToken}`)
        .attach('selfie_image', validImage, 'selfie.jpg');

      expect(res.status).toBe(503);
      expect(res.body.success).toBe(false);
      expect(res.body.error).toBe('REKOGNITION_SERVICE_UNAVAILABLE');

      // User must NOT be updated or marked rejected in error
      const user = await User.findByPk(testUser.id);
      expect(user?.isFaceVerified).toBe(false);
    });
  });

  describe('11. S3 Upload Failure', () => {
    it('should return 500 when S3 storage fails and abort process', async () => {
      const validImage = await createBlankImage(300, 300);

      jest.spyOn(s3Service, 'uploadPrivateImage').mockRejectedValueOnce(
        new Error('S3 Access Denied: Bucket policy violation')
      );

      const res = await request(app)
        .post('/api/v1/gesture-upload')
        .set('Authorization', `Bearer ${authToken}`)
        .attach('selfie_image', validImage, 'selfie.jpg');

      expect(res.status).toBe(500);
      expect(res.body.success).toBe(false);
      expect(res.body.error).toBe('S3_UPLOAD_FAILED');
    });
  });

  describe('12. Database Persistence Failure / Transaction Safety', () => {
    it('should rollback transaction and return 500 if database persistence fails', async () => {
      const validImage = await createBlankImage(300, 300);

      jest.spyOn(rekognitionService, 'detectFaces').mockResolvedValueOnce({
        faceCount: 1,
        faces: [{ confidence: 99 }],
      });
      jest.spyOn(rekognitionService, 'compareFaces').mockResolvedValueOnce({
        isMatch: true,
        similarity: 95.0,
        confidence: 99,
        threshold: 85,
      });

      // Force create to fail inside transaction
      jest.spyOn(FaceVerification, 'create').mockRejectedValueOnce(
        new Error('Database disk full or constraint violation')
      );

      const res = await request(app)
        .post('/api/v1/gesture-upload')
        .set('Authorization', `Bearer ${authToken}`)
        .attach('selfie_image', validImage, 'selfie.jpg');

      expect(res.status).toBe(500);
      const user = await User.findByPk(testUser.id);
      expect(user?.isFaceVerified).toBe(false);
    });
  });

  describe('13. Profile Image Authorization Isolation', () => {
    it('should only compare against authenticated user profile photo, never an arbitrary input key', async () => {
      const validImage = await createBlankImage(300, 300);

      const getBufferSpy = jest.spyOn(s3Service, 'getObjectBuffer');

      jest.spyOn(rekognitionService, 'detectFaces').mockResolvedValueOnce({
        faceCount: 1,
        faces: [{ confidence: 99 }],
      });
      jest.spyOn(rekognitionService, 'compareFaces').mockResolvedValueOnce({
        isMatch: true,
        similarity: 90,
        confidence: 99,
        threshold: 85,
      });

      await request(app)
        .post('/api/v1/gesture-upload')
        .set('Authorization', `Bearer ${authToken}`)
        .attach('selfie_image', validImage, 'selfie.jpg');

      expect(getBufferSpy).toHaveBeenCalledWith(testUser.profilePicture);
    });
  });

  describe('14. History & isLatest Flag Handling', () => {
    it('should mark older verification records as isLatest = false and increment attemptNo', async () => {
      const validImage = await createBlankImage(300, 300);

      jest.spyOn(rekognitionService, 'detectFaces').mockResolvedValue({
        faceCount: 1,
        faces: [{ confidence: 99 }],
      });
      jest.spyOn(rekognitionService, 'compareFaces').mockResolvedValue({
        isMatch: false,
        similarity: 50,
        confidence: 99,
        threshold: 85,
      });

      // Attempt 1
      const res1 = await request(app)
        .post('/api/v1/gesture-upload')
        .set('Authorization', `Bearer ${authToken}`)
        .attach('selfie_image', validImage, 'selfie1.jpg');

      expect(res1.body.data.attemptNo).toBe(1);
      expect(res1.body.data.isLatest).toBe(true);

      // Attempt 2
      const res2 = await request(app)
        .post('/api/v1/gesture-upload')
        .set('Authorization', `Bearer ${authToken}`)
        .attach('selfie_image', validImage, 'selfie2.jpg');

      expect(res2.body.data.attemptNo).toBe(2);
      expect(res2.body.data.isLatest).toBe(true);

      // Verify records in DB
      const record1 = await FaceVerification.findByPk(res1.body.data.verificationId);
      const record2 = await FaceVerification.findByPk(res2.body.data.verificationId);

      expect(record1?.isLatest).toBe(false);
      expect(record1?.attemptNo).toBe(1);

      expect(record2?.isLatest).toBe(true);
      expect(record2?.attemptNo).toBe(2);
    });
  });

  describe('15. Concurrent Verification Attempts', () => {
    it('should prevent concurrent attempts from creating race conditions and return 429', async () => {
      const validImage = await createBlankImage(300, 300);

      jest.spyOn(rekognitionService, 'detectFaces').mockImplementation(async () => {
        await new Promise((r) => setTimeout(r, 200));
        return {
          faceCount: 1,
          faces: [{ confidence: 99 }],
        };
      });

      jest.spyOn(rekognitionService, 'compareFaces').mockResolvedValue({
        isMatch: true,
        similarity: 90,
        confidence: 99,
        threshold: 85,
      });

      const [res1, res2] = await Promise.all([
        request(app)
          .post('/api/v1/gesture-upload')
          .set('Authorization', `Bearer ${authToken}`)
          .attach('selfie_image', validImage, 'selfie1.jpg'),
        request(app)
          .post('/api/v1/gesture-upload')
          .set('Authorization', `Bearer ${authToken}`)
          .attach('selfie_image', validImage, 'selfie2.jpg'),
      ]);

      const statuses = [res1.status, res2.status].sort();
      expect(statuses).toEqual([200, 429]);

      const rejectedRes = res1.status === 429 ? res1 : res2;
      expect(rejectedRes.body.error).toBe('CONCURRENT_REQUEST');
    });
  });

  describe('16. Hourly Rate Limiting', () => {
    it('should block requests when user reaches 10 attempts in an hour with 429 RATE_LIMIT_EXCEEDED', async () => {
      // Seed 10 recent verification records
      for (let i = 0; i < 10; i++) {
        await FaceVerification.create({
          userId: testUser.id,
          status: 'rejected',
          verificationType: 'gesture',
          faceDetected: true,
          faceCount: 1,
          reasonCode: 'IDENTITY_MISMATCH',
          attempts: i + 1,
          attemptNo: i + 1,
          isLatest: i === 9,
          createdAt: new Date(Date.now() - 1000 * 60 * 10),
        });
      }

      const validImage = await createBlankImage(300, 300);

      const res = await request(app)
        .post('/api/v1/gesture-upload')
        .set('Authorization', `Bearer ${authToken}`)
        .attach('selfie_image', validImage, 'selfie.jpg');

      expect(res.status).toBe(429);
      expect(res.body.success).toBe(false);
      expect(res.body.error).toBe('RATE_LIMIT_EXCEEDED');
      expect(res.body.message).toMatch(/maximum verification attempts/i);
    });
  });
});
