import { S3Client } from '@aws-sdk/client-s3';
import { RekognitionClient } from '@aws-sdk/client-rekognition';
import { env } from './env';

let s3ClientInstance: S3Client | null = null;
let rekognitionClientInstance: RekognitionClient | null = null;

/**
 * Returns AWS S3 Client instance.
 * Uses explicit credentials if provided, otherwise falls back to AWS default credentials (IAM role / ECS task role).
 */
export const getS3Client = (): S3Client => {
  if (s3ClientInstance) {
    return s3ClientInstance;
  }

  const clientConfig: any = {
    region: env.AWS_REGION,
  };

  if (env.AWS_ACCESS_KEY_ID && env.AWS_SECRET_ACCESS_KEY) {
    clientConfig.credentials = {
      accessKeyId: env.AWS_ACCESS_KEY_ID,
      secretAccessKey: env.AWS_SECRET_ACCESS_KEY,
    };
  }

  s3ClientInstance = new S3Client(clientConfig);
  return s3ClientInstance;
};

/**
 * Returns AWS Rekognition Client instance.
 */
export const getRekognitionClient = (): RekognitionClient => {
  if (rekognitionClientInstance) {
    return rekognitionClientInstance;
  }

  const clientConfig: any = {
    region: env.AWS_REGION,
  };

  if (env.AWS_ACCESS_KEY_ID && env.AWS_SECRET_ACCESS_KEY) {
    clientConfig.credentials = {
      accessKeyId: env.AWS_ACCESS_KEY_ID,
      secretAccessKey: env.AWS_SECRET_ACCESS_KEY,
    };
  }

  rekognitionClientInstance = new RekognitionClient(clientConfig);
  return rekognitionClientInstance;
};
