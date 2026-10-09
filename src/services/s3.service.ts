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
    const s3 = getS3Client();
    const ext = mimeType.includes('png') ? 'png' : mimeType.includes('webp') ? 'webp' : 'jpg';
    const uniqueId = crypto.randomBytes(16).toString('hex');
    const key = `${folder}/${userId}/${Date.now()}_${uniqueId}.${ext}`;

    try {
      const command = new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: buffer,
        ContentType: mimeType,
        // Ensure the uploaded object remains strictly private
        ServerSideEncryption: 'AES256',
      });

      await s3.send(command);
      return key;
    } catch (error: any) {
      console.error(`[S3 Upload Error] Failed to upload ${key}:`, error.message);
      throw new S3ServiceError(
        `Failed to store verification image in secure storage: ${error.message || 'S3 error'}`,
        500,
        'S3_UPLOAD_FAILED'
      );
    }
  }

  /**
   * Retrieves an image buffer from S3 using its object key
   */
  public async getObjectBuffer(key: string): Promise<Buffer> {
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

      // Convert readable stream to buffer
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
        throw new S3ServiceError(`Reference image not found in storage: ${key}`, 404, 'S3_OBJECT_NOT_FOUND');
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
