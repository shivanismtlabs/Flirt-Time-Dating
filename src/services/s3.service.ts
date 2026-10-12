import {
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
} from '@aws-sdk/client-s3';
import crypto from 'crypto';
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
   * Resolves an S3 key or external URL to a full public URL
   */
  public getPublicUrl(keyOrUrl?: string | null): string {
    if (!keyOrUrl) return '';
    if (keyOrUrl.startsWith('http://') || keyOrUrl.startsWith('https://')) {
      return keyOrUrl;
    }
    const cleanKey = keyOrUrl.replace(/^\/+/, '');
    return `https://${this.bucket}.s3.${env.AWS_REGION}.amazonaws.com/${cleanKey}`;
  }

  /**
   * Generates a presigned S3 PUT URL for direct client-side media uploads
   */
  public async generatePresignedUploadUrl(
    userId: string,
    mimeType = 'image/jpeg',
    folder = 'quick_moments',
    expiresInSeconds = 900
  ): Promise<{
    uploadUrl: string;
    key: string;
    publicUrl: string;
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

    const accessKey = env.AWS_ACCESS_KEY_ID;
    const secretKey = env.AWS_SECRET_ACCESS_KEY;
    const region = env.AWS_REGION;
    const bucket = this.bucket;

    if (!accessKey || !secretKey) {
      return {
        uploadUrl: `${publicUrl}?mock_upload=true`,
        key,
        publicUrl,
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
        publicUrl,
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
        publicUrl,
        expiresInSeconds,
        headers: {
          'Content-Type': mimeType,
        },
      };
    }
  }

  /**
   * Deletes an object from S3 (used for cleanup on failure)
   */
  public async deleteObject(key: string): Promise<void> {
    const s3 = getS3Client();
    try {
      const command = new DeleteObjectCommand({
        Bucket: this.bucket,
        Key: key,
      });
      await s3.send(command);
    } catch (error: any) {
      console.warn(`[S3 Delete Warning] Could not delete orphaned key ${key}:`, error.message);
    }
  }
}

export const s3Service = new S3Service();
