import request from 'supertest';
import app from '../src/app';
import { sequelize, User, initDb } from '../src/models';
import { generateToken } from '../src/utils/jwt';
import { s3Service, formatMediaUrl, formatThumbnailUrl } from '../src/services/s3.service';

describe('Media Presigned URL & Lambda Thumbnail Helpers', () => {
  let user: User;
  let token: string;

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    await initDb(true);

    user = await User.create({
      id: 'a0000000-0000-0000-0000-000000000001',
      username: 'mediauser',
      email: 'media@test.com',
      password: 'HashedPassword123!',
      fullName: 'Media Tester',
      isActive: true,
    });

    token = generateToken({ id: user.id, email: user.email, role: 'user' });
  });

  afterAll(async () => {
    await sequelize.close();
  });

  describe('Thumbnail and Media URL Formatters', () => {
    it('should format relative S3 key to public URL and Lambda thumbnail URL', () => {
      const key = 'uploads/users/123/photo.jpg';
      const publicUrl = formatMediaUrl(key);
      const thumbnailUrl = formatThumbnailUrl(key);

      expect(publicUrl).toContain('uploads/users/123/photo.jpg');
      expect(thumbnailUrl).toContain('thumbnails/uploads/users/123/photo.jpg');
    });

    it('should format full S3 URL to Lambda thumbnail URL under thumbnails/ prefix', () => {
      const fullS3Url = 'https://flirttime.s3.ap-south-1.amazonaws.com/uploads/avatar.jpg';
      const thumbnailUrl = formatThumbnailUrl(fullS3Url);

      expect(thumbnailUrl).toContain('/thumbnails/uploads/avatar.jpg');
    });

    it('should not double-prefix already formatted thumbnail URLs', () => {
      const existingThumb = 'https://flirttime.s3.ap-south-1.amazonaws.com/thumbnails/uploads/avatar.jpg';
      const result = formatThumbnailUrl(existingThumb);

      expect(result).toBe(existingThumb);
      expect(result).not.toContain('thumbnails/thumbnails');
    });

    it('should append crop parameters to Unsplash images', () => {
      const unsplashUrl = 'https://images.unsplash.com/photo-1534528741775-53994a69daeb';
      const thumb = formatThumbnailUrl(unsplashUrl);

      expect(thumb).toContain('w=300&h=300&fit=crop');
    });

    it('should return empty string for null or undefined input', () => {
      expect(formatMediaUrl(null)).toBe('');
      expect(formatThumbnailUrl(null)).toBe('');
    });
  });

  describe('POST /api/v1/media/presigned-url', () => {
    it('should require authentication', async () => {
      const res = await request(app)
        .post('/api/v1/media/presigned-url')
        .send({ folder: 'uploads' });

      expect(res.status).toBe(401);
    });

    it('should generate a valid presigned upload URL with public and thumbnail URLs', async () => {
      const res = await request(app)
        .post('/api/v1/media/presigned-url')
        .set('Authorization', `Bearer ${token}`)
        .send({
          folder: 'photos',
          mimeType: 'image/jpeg',
          expiresInSeconds: 600,
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toBeDefined();

      const { uploadUrl, key, publicUrl, thumbnailUrl, expiresInSeconds, headers } = res.body.data;

      expect(uploadUrl).toBeDefined();
      expect(key).toContain('photos/');
      expect(publicUrl).toContain(key);
      expect(thumbnailUrl).toContain(`thumbnails/${key}`);
      expect(expiresInSeconds).toBe(600);
      expect(headers['Content-Type']).toBe('image/jpeg');
    });

    it('should also work on the alias /api/v1/media/upload-url', async () => {
      const res = await request(app)
        .post('/api/v1/media/upload-url')
        .set('Authorization', `Bearer ${token}`)
        .send({
          folder: 'moments',
          mimeType: 'image/png',
        });

      expect(res.status).toBe(200);
      expect(res.body.data.key).toContain('moments/');
      expect(res.body.data.thumbnailUrl).toContain('thumbnails/moments/');
    });

    it('should reject invalid folder or invalid mimeType', async () => {
      const res = await request(app)
        .post('/api/v1/media/presigned-url')
        .set('Authorization', `Bearer ${token}`)
        .send({
          folder: 'malicious_folder',
          mimeType: 'application/x-executable',
        });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
    });
  });
});
