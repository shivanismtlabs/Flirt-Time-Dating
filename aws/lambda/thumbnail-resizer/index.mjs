import { S3Client, GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import sharp from 'sharp';

const s3 = new S3Client();

// Prefix where thumbnails are stored (must match AWS_S3_THUMBNAIL_PREFIX in backend)
const THUMBNAIL_PREFIX = process.env.THUMBNAIL_PREFIX || 'thumbnails';
const THUMBNAIL_WIDTH = parseInt(process.env.THUMBNAIL_WIDTH || '400', 10);
const THUMBNAIL_HEIGHT = parseInt(process.env.THUMBNAIL_HEIGHT || '400', 10);
const THUMBNAIL_QUALITY = parseInt(process.env.THUMBNAIL_QUALITY || '80', 10);

/**
 * AWS Lambda Handler triggered by S3 ObjectCreated events
 */
export const handler = async (event) => {
  console.log('Received S3 event:', JSON.stringify(event, null, 2));

  for (const record of event.Records) {
    const bucket = record.s3.bucket.name;
    const rawKey = record.s3.object.key;
    const key = decodeURIComponent(rawKey.replace(/\+/g, ' '));

    // CRITICAL: Prevent infinite recursion loops!
    // Never process images that are already in the thumbnails prefix
    if (key.startsWith(`${THUMBNAIL_PREFIX}/`) || key.includes(`/${THUMBNAIL_PREFIX}/`)) {
      console.log(`[SKIP] Key is already a thumbnail: ${key}`);
      continue;
    }

    // Only process supported image formats
    const isImage = /\.(jpe?g|png|webp|gif|avif|tiff?)$/i.test(key);
    if (!isImage) {
      console.log(`[SKIP] Not an image file: ${key}`);
      continue;
    }

    console.log(`[PROCESSING] Resizing ${key} from bucket ${bucket}...`);

    try {
      // 1. Download original object from S3
      const getCommand = new GetObjectCommand({
        Bucket: bucket,
        Key: key,
      });

      const response = await s3.send(getCommand);
      const streamToBuffer = async (stream) => {
        const chunks = [];
        for await (const chunk of stream) {
          chunks.push(chunk);
        }
        return Buffer.concat(chunks);
      };

      const originalBuffer = await streamToBuffer(response.Body);

      // 2. Resize image using Sharp
      // Use sharp rotate() to respect EXIF orientation from mobile phone cameras
      const thumbnailBuffer = await sharp(originalBuffer)
        .rotate()
        .resize({
          width: THUMBNAIL_WIDTH,
          height: THUMBNAIL_HEIGHT,
          fit: sharp.fit.cover,
          position: sharp.strategy.entropy, // focuses on faces / highest entropy area
        })
        .jpeg({
          quality: THUMBNAIL_QUALITY,
          progressive: true,
          mozjpeg: true,
        })
        .toBuffer();

      // 3. Upload thumbnail to thumbnails/${key}
      const targetThumbnailKey = `${THUMBNAIL_PREFIX}/${key}`;

      const putCommand = new PutObjectCommand({
        Bucket: bucket,
        Key: targetThumbnailKey,
        Body: thumbnailBuffer,
        ContentType: 'image/jpeg',
        CacheControl: 'public, max-age=31536000, immutable',
        Metadata: {
          'original-key': key,
          'resized-by': 'flirttime-lambda-resizer',
        },
      });

      await s3.send(putCommand);
      console.log(`[SUCCESS] Thumbnail created successfully: ${targetThumbnailKey}`);
    } catch (err) {
      console.error(`[ERROR] Failed to process image ${key}:`, err);
      // Don't rethrow unless you want Lambda to retry via SQS/DLQ
    }
  }

  return { statusCode: 200, body: 'Thumbnail processing complete' };
};
