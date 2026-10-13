import {
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  HeadObjectCommand,
} from '@aws-sdk/client-s3';
import crypto from 'crypto';
import sharp from 'sharp';
import { getS3Client } from '../config/aws';
import { env } from '../config/env';

export class S3ServiceError extends Error {
  public statusCode: number;
  public errorCode: string;

  constructor(message: string, statusCode = 500, errorCode = 'S3_ERROR') {
    super(message);
    this.name = 'S3ServiceError';
    this.statusCode = statusCode;
    this.errorCode = errorCode;
    Object.setPrototypeOf(this, S3ServiceError.prototype);
  }
}

export class S3Service {
  private bucket: string;

  constructor() {
    this.bucket = env.AWS_S3_BUCKET;
  }

  /**
   * Uploads an image buffer privately to S3 and returns the S3 object key
   */
  public async uploadPrivateImage(
    buffer: Buffer,
    userId: string,
    mimeType = 'image/jpeg',
    folder = 'verifications'
  ): Promise<string> {
    return this.uploadMedia(buffer, userId, mimeType, folder);
  }

  /**
   * Universal S3 upload for photos, audio recordings, and verification documents
   */
  public async uploadMedia(
    buffer: Buffer,
    userId: string,
    mimeType = 'image/jpeg',
    folder = 'uploads'
  ): Promise<string> {
    const s3 = getS3Client();
    let ext = 'bin';
    if (mimeType.includes('png')) ext = 'png';
    else if (mimeType.includes('webp')) ext = 'webp';
    else if (mimeType.includes('jpeg') || mimeType.includes('jpg')) ext = 'jpg';
    else if (mimeType.includes('mpeg') || mimeType.includes('mp3')) ext = 'mp3';
    else if (mimeType.includes('m4a') || mimeType.includes('mp4')) ext = 'm4a';
    else if (mimeType.includes('wav')) ext = 'wav';
    else if (mimeType.includes('aac')) ext = 'aac';
    else if (mimeType.includes('ogg')) ext = 'ogg';
    else if (mimeType.includes('webm')) ext = 'webm';

    const uniqueId = crypto.randomBytes(16).toString('hex');
    const key = `${folder}/${userId}/${Date.now()}_${uniqueId}.${ext}`;

    try {
      const command = new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: buffer,
        ContentType: mimeType,
        ServerSideEncryption: 'AES256',
      });

      await s3.send(command);

      // Automatically generate and upload resized thumbnail for public images
      if (
        mimeType.startsWith('image/') &&
        folder !== 'verifications'
      ) {
        this.generateAndUploadThumbnail(key, buffer).catch((thumbErr: any) => {
          console.warn(`[Thumbnail Warning] Could not generate thumbnail for ${key}:`, thumbErr.message);
        });
      }

      return key;
    } catch (error: any) {
      console.error(`[S3 Upload Error] Failed to upload ${key}:`, error.message);
      throw new S3ServiceError(
        `Failed to store media file in secure storage: ${error.message || 'S3 error'}`,
        500,
        'S3_UPLOAD_FAILED'
      );
    }
  }

  /**
   * Retrieves an image buffer from S3 using its object key or full URL
   */
  public async getObjectBuffer(keyOrUrl: string): Promise<Buffer> {
    if (!keyOrUrl || typeof keyOrUrl !== 'string') {
      throw new S3ServiceError('Empty key or URL provided', 404, 'S3_OBJECT_NOT_FOUND');
    }

    const trimmed = keyOrUrl.trim();

    // If it's a full HTTP/HTTPS URL
    if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) {
      try {
        const parsedUrl = new URL(trimmed);
        if (parsedUrl.hostname.includes('.amazonaws.com')) {
          const rawPath = decodeURIComponent(parsedUrl.pathname.replace(/^\/+/, ''));
          const cleanKey = rawPath.startsWith(`${this.bucket}/`)
            ? rawPath.slice(this.bucket.length + 1)
            : rawPath;
          if (cleanKey) {
            return await this.fetchFromS3(cleanKey);
          }
        }

        // External CDN/Unsplash URL: fetch via HTTP with 8s timeout
        const response = await fetch(trimmed, { signal: AbortSignal.timeout(8000) });
        if (!response.ok) {
          throw new S3ServiceError(
            `Failed to fetch image from URL: ${response.statusText}`,
            404,
            'S3_OBJECT_NOT_FOUND'
          );
        }
        const arrayBuffer = await response.arrayBuffer();
        return Buffer.from(arrayBuffer);
      } catch (httpErr: any) {
        if (httpErr instanceof S3ServiceError) throw httpErr;
        console.warn(`[Image Fetch Warning] Could not fetch image from ${trimmed}:`, httpErr.message);
        throw new S3ServiceError(
          `Could not fetch reference image: ${httpErr.message}`,
          404,
          'S3_OBJECT_NOT_FOUND'
        );
      }
    }

    return await this.fetchFromS3(trimmed);
  }

  private async fetchFromS3(key: string): Promise<Buffer> {
    const s3 = getS3Client();

    try {
      const command = new GetObjectCommand({
        Bucket: this.bucket,
        Key: key,
      });

      const response = await s3.send(command);
      if (!response.Body) {
        throw new S3ServiceError(`S3 object ${key} has empty body`, 404, 'S3_OBJECT_EMPTY');
      }

      const streamToBuffer = async (stream: any): Promise<Buffer> => {
        const chunks: Uint8Array[] = [];
        for await (const chunk of stream) {
          chunks.push(chunk);
        }
        return Buffer.concat(chunks);
      };

      return await streamToBuffer(response.Body);
    } catch (error: any) {
      if (error.name === 'NoSuchKey' || error.$metadata?.httpStatusCode === 404) {
        throw new S3ServiceError(
          `Reference image not found in storage: ${key}`,
          404,
          'S3_OBJECT_NOT_FOUND'
        );
      }
      console.error(`[S3 Get Error] Failed to retrieve ${key}:`, error.message);
      throw new S3ServiceError(
        `Failed to retrieve reference image from secure storage: ${error.message || 'S3 error'}`,
        500,
        'S3_GET_FAILED'
      );
    }
  }

  /**
   * Extracts S3 relative key from a full S3/CloudFront URL or returns the key if already relative
   */
  public extractKey(keyOrUrl?: string | null): string {
    if (!keyOrUrl) return '';
    const trimmed = keyOrUrl.trim();
    if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) {
      try {
        const parsed = new URL(trimmed);
        if (parsed.hostname.includes('.amazonaws.com')) {
          let rawPath = decodeURIComponent(parsed.pathname.replace(/^\/+/, ''));
          if (rawPath.startsWith(`${this.bucket}/`)) {
            rawPath = rawPath.slice(this.bucket.length + 1);
          }
          return rawPath || trimmed;
        }
        if (env.AWS_CLOUDFRONT_URL) {
          try {
            const cfHost = new URL(env.AWS_CLOUDFRONT_URL).hostname;
            if (parsed.hostname === cfHost) {
              return decodeURIComponent(parsed.pathname.replace(/^\/+/, ''));
            }
          } catch {}
        }
      } catch {}
      return trimmed;
    }
    return trimmed.replace(/^\/+/, '');
  }

  /**
   * Resolves an S3 key or external URL to a full public URL
   */
  public getPublicUrl(keyOrUrl?: string | null): string {
    if (!keyOrUrl) return '';
    if (keyOrUrl.startsWith('http://') || keyOrUrl.startsWith('https://')) {
      return keyOrUrl;
    }
    const cleanKey = keyOrUrl.replace(/^\/+/, '');
    if (env.AWS_CLOUDFRONT_URL) {
      const cdnBase = env.AWS_CLOUDFRONT_URL.replace(/\/+$/, '');
      return `${cdnBase}/${cleanKey}`;
    }
    return `https://${this.bucket}.s3.${env.AWS_REGION}.amazonaws.com/${cleanKey}`;
  }

  /**
   * Resolves an S3 key or external URL to an AWS Lambda-generated thumbnail URL
   * AWS Lambda generates and saves resized thumbnails under: thumbnails/${key}
   */
  public getThumbnailUrl(keyOrUrl?: string | null): string {
    if (!keyOrUrl) return '';
    const trimmed = keyOrUrl.trim();

    // If it's an external HTTP/HTTPS URL
    if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) {
      if (trimmed.includes('images.unsplash.com')) {
        return trimmed.includes('?') ? `${trimmed}&w=300&h=300&fit=crop` : `${trimmed}?w=300&h=300&fit=crop`;
      }
      try {
        const parsed = new URL(trimmed);
        if (parsed.hostname.includes('.amazonaws.com')) {
          let pathname = decodeURIComponent(parsed.pathname.replace(/^\/+/, ''));
          if (pathname.startsWith(`${this.bucket}/`)) {
            pathname = pathname.slice(this.bucket.length + 1);
          }
          if (pathname.startsWith(`${env.AWS_S3_THUMBNAIL_PREFIX}/`)) {
            return trimmed;
          }
          const thumbKey = `${env.AWS_S3_THUMBNAIL_PREFIX}/${pathname}`;
          if (env.AWS_CLOUDFRONT_URL) {
            const cdnBase = env.AWS_CLOUDFRONT_URL.replace(/\/+$/, '');
            return `${cdnBase}/${thumbKey}`;
          }
          return `https://${this.bucket}.s3.${env.AWS_REGION}.amazonaws.com/${thumbKey}`;
        }
      } catch (_) {}

      return trimmed;
    }

    const cleanKey = trimmed.replace(/^\/+/, '');
    if (cleanKey.startsWith(`${env.AWS_S3_THUMBNAIL_PREFIX}/`)) {
      return this.getPublicUrl(cleanKey);
    }
    const thumbKey = `${env.AWS_S3_THUMBNAIL_PREFIX}/${cleanKey}`;
    if (env.AWS_CLOUDFRONT_URL) {
      const cdnBase = env.AWS_CLOUDFRONT_URL.replace(/\/+$/, '');
      return `${cdnBase}/${thumbKey}`;
    }
    return `https://${this.bucket}.s3.${env.AWS_REGION}.amazonaws.com/${thumbKey}`;
  }

  /**
   * Verifies if an object exists in the S3 bucket and returns its metadata
   */
  public async checkObjectExists(key: string): Promise<{
    exists: boolean;
    contentLength?: number;
    contentType?: string;
  }> {
    if (!key || typeof key !== 'string') return { exists: false };

    // In test environment or if credentials not configured, allow mock verification
    if (
      process.env.NODE_ENV === 'test' ||
      !env.AWS_ACCESS_KEY_ID ||
      !env.AWS_SECRET_ACCESS_KEY
    ) {
      return {
        exists: true,
        contentLength: 1024 * 100,
        contentType: 'image/jpeg',
      };
    }

    const s3 = getS3Client();
    try {
      const command = new HeadObjectCommand({
        Bucket: this.bucket,
        Key: key,
      });
      const response = await s3.send(command);
      return {
        exists: true,
        contentLength: response.ContentLength,
        contentType: response.ContentType,
      };
    } catch (err: any) {
      if (
        err.name === 'NotFound' ||
        err.name === 'NoSuchKey' ||
        err.$metadata?.httpStatusCode === 404
      ) {
        return { exists: false };
      }
      console.warn(`[S3 HeadObject Warning] Error checking ${key}:`, err.message);
      return { exists: false };
    }
  }

  /**
   * Generates a presigned S3 PUT URL for direct client-side media uploads
   */
  public async generatePresignedUploadUrl(
    userId: string,
    mimeType = 'image/jpeg',
    folder = 'uploads',
    expiresInSeconds = 900
  ): Promise<{
    uploadUrl: string;
    key: string;
    imageKey: string;
    publicUrl: string;
    thumbnailUrl: string;
    expiresInSeconds: number;
    headers: Record<string, string>;
  }> {
    let ext = 'jpg';
    if (mimeType.includes('png')) ext = 'png';
    else if (mimeType.includes('webp')) ext = 'webp';
    else if (mimeType.includes('jpeg') || mimeType.includes('jpg')) ext = 'jpg';
    else if (mimeType.includes('mp4') || mimeType.includes('video')) ext = 'mp4';

    const uniqueId = crypto.randomBytes(16).toString('hex');
    const key = `${folder}/${userId}/${Date.now()}_${uniqueId}.${ext}`;
    const publicUrl = this.getPublicUrl(key);
    const thumbnailUrl = this.getThumbnailUrl(key);

    const accessKey = env.AWS_ACCESS_KEY_ID;
    const secretKey = env.AWS_SECRET_ACCESS_KEY;
    const region = env.AWS_REGION;
    const bucket = this.bucket;

    if (!accessKey || !secretKey) {
      return {
        uploadUrl: `${publicUrl}?mock_upload=true`,
        key,
        imageKey: key,
        publicUrl,
        thumbnailUrl,
        expiresInSeconds,
        headers: {
          'Content-Type': mimeType,
        },
      };
    }

    try {
      const dateObj = new Date();
      const amzDate = dateObj.toISOString().replace(/[:-]|\.\d{3}/g, '');
      const dateStamp = amzDate.substring(0, 8);
      const host = `${bucket}.s3.${region}.amazonaws.com`;
      const credentialScope = `${dateStamp}/${region}/s3/aws4_request`;

      const queryParams: Record<string, string> = {
        'X-Amz-Algorithm': 'AWS4-HMAC-SHA256',
        'X-Amz-Credential': `${accessKey}/${credentialScope}`,
        'X-Amz-Date': amzDate,
        'X-Amz-Expires': expiresInSeconds.toString(),
        'X-Amz-SignedHeaders': 'host',
      };

      const sortedQueryString = Object.keys(queryParams)
        .sort()
        .map((k) => `${encodeURIComponent(k)}=${encodeURIComponent(queryParams[k])}`)
        .join('&');

      const canonicalUri = `/${encodeURI(key).replace(/\+/g, '%20')}`;
      const canonicalHeaders = `host:${host}\n`;
      const signedHeaders = 'host';
      const payloadHash = 'UNSIGNED-PAYLOAD';

      const canonicalRequest = [
        'PUT',
        canonicalUri,
        sortedQueryString,
        canonicalHeaders,
        signedHeaders,
        payloadHash,
      ].join('\n');

      const stringToSign = [
        'AWS4-HMAC-SHA256',
        amzDate,
        credentialScope,
        crypto.createHash('sha256').update(canonicalRequest).digest('hex'),
      ].join('\n');

      const kDate = crypto.createHmac('sha256', `AWS4${secretKey}`).update(dateStamp).digest();
      const kRegion = crypto.createHmac('sha256', kDate).update(region).digest();
      const kService = crypto.createHmac('sha256', kRegion).update('s3').digest();
      const kSigning = crypto.createHmac('sha256', kService).update('aws4_request').digest();
      const signature = crypto.createHmac('sha256', kSigning).update(stringToSign).digest('hex');

      const uploadUrl = `https://${host}${canonicalUri}?${sortedQueryString}&X-Amz-Signature=${signature}`;

      return {
        uploadUrl,
        key,
        imageKey: key,
        publicUrl,
        thumbnailUrl,
        expiresInSeconds,
        headers: {
          'Content-Type': mimeType,
        },
      };
    } catch (err: any) {
      console.error('[Presigned URL Error]:', err.message);
      return {
        uploadUrl: publicUrl,
        key,
        imageKey: key,
        publicUrl,
        thumbnailUrl,
        expiresInSeconds,
        headers: {
          'Content-Type': mimeType,
        },
      };
    }
  }

  /**
   * Generates a 400x400 thumbnail for an image and uploads it to S3 under thumbnails/
   */
  public async generateAndUploadThumbnail(key: string, buffer?: Buffer): Promise<string | null> {
    const cleanKey = key.replace(/^\/+/, '');
    const thumbKey = `${env.AWS_S3_THUMBNAIL_PREFIX}/${cleanKey}`;
    const s3 = getS3Client();

    try {
      let imageBuffer = buffer;
      if (!imageBuffer) {
        imageBuffer = await this.getObjectBuffer(cleanKey);
      }

      const thumbBuffer = await sharp(imageBuffer)
        .resize(400, 400, { fit: 'inside', withoutEnlargement: true })
        .jpeg({ quality: 80 })
        .toBuffer();

      await s3.send(
        new PutObjectCommand({
          Bucket: this.bucket,
          Key: thumbKey,
          Body: thumbBuffer,
          ContentType: 'image/jpeg',
          ServerSideEncryption: 'AES256',
        })
      );

      return thumbKey;
    } catch (err: any) {
      console.warn(`[Thumbnail Warning] Could not generate thumbnail for ${cleanKey}:`, err.message);
      return null;
    }
  }

  /**
   * Ensures a thumbnail exists in S3 for a given image key (useful for presigned direct uploads)
   */
  public async ensureThumbnail(key: string): Promise<void> {
    if (!key || key.startsWith('http://') || key.startsWith('https://')) return;
    const cleanKey = key.replace(/^\/+/, '');
    if (cleanKey.startsWith(`${env.AWS_S3_THUMBNAIL_PREFIX}/`) || cleanKey.startsWith('verifications/')) {
      return;
    }
    const thumbKey = `${env.AWS_S3_THUMBNAIL_PREFIX}/${cleanKey}`;
    try {
      const check = await this.checkObjectExists(thumbKey);
      if (!check.exists) {
        this.generateAndUploadThumbnail(cleanKey).catch((e: any) =>
          console.warn(`[Thumbnail Background Error] ${cleanKey}:`, e.message)
        );
      }
    } catch (err: any) {
      console.warn(`[Ensure Thumbnail Warning] ${cleanKey}:`, err.message);
    }
  }

  /**
   * Deletes an object and its thumbnail from S3 (used for cleanup on failure)
   */
  public async deleteObject(key: string): Promise<void> {
    const s3 = getS3Client();
    const cleanKey = key.replace(/^\/+/, '');
    try {
      const command = new DeleteObjectCommand({
        Bucket: this.bucket,
        Key: cleanKey,
      });
      await s3.send(command);

      const thumbKey = `${env.AWS_S3_THUMBNAIL_PREFIX}/${cleanKey}`;
      await s3.send(
        new DeleteObjectCommand({
          Bucket: this.bucket,
          Key: thumbKey,
        })
      ).catch(() => {});
    } catch (error: any) {
      console.warn(`[S3 Delete Warning] Could not delete orphaned key ${cleanKey}:`, error.message);
    }
  }
}

export const s3Service = new S3Service();

/**
 * Common universal functions for resolving image and thumbnail URLs across all modules
 */
export const formatMediaUrl = (keyOrUrl?: string | null): string => s3Service.getPublicUrl(keyOrUrl);
export const formatThumbnailUrl = (keyOrUrl?: string | null): string => s3Service.getThumbnailUrl(keyOrUrl);
export const extractS3Key = (keyOrUrl?: string | null): string => s3Service.extractKey(keyOrUrl);

