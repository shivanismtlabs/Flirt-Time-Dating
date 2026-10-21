import { Request, Response, NextFunction } from 'express';
import { s3Service } from '../services/s3.service';
import { sendSuccess, sendError } from '../utils/response';

export class MediaController {
  /**
   * Universal S3 media upload handler.
   * Supports:
   * 1. Direct multipart/form-data file upload to AWS S3 (single or multiple files).
   * 2. Presigned S3 upload URL generation if called with JSON body / query params.
   *
   * POST /api/v1/media/uploads
   * POST /api/v1/media/upload
   * POST /api/v1/media
   */
  public async uploadMediaHandler(
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    try {
      const userId = (req as any).user?.id || 'anonymous';

      // 1. Gather all attached files from multipart form fields
      const fileList: Express.Multer.File[] = [];
      if (req.files) {
        const filesObj = req.files as Record<string, Express.Multer.File[]>;
        const fields = [
          'file',
          'files',
          'media',
          'medias',
          'image',
          'images',
          'photo',
          'photos',
          'audio',
          'video',
          'attachment',
          'attachments',
          'document',
        ];
        for (const f of fields) {
          if (Array.isArray(filesObj[f])) {
            fileList.push(...filesObj[f]);
          }
        }
      }
      if (fileList.length === 0 && req.file) {
        fileList.push(req.file);
      }

      // If file(s) are uploaded via multipart/form-data, upload directly to S3
      if (fileList.length > 0) {
        const folderRaw = (req.body?.folder || req.query?.folder || 'uploads').toString().trim();
        const validFolders = [
          'uploads',
          'photos',
          'moments',
          'verifications',
          'avatars',
          'quick-moments',
          'quick_moments',
          'audio',
          'chat',
          'covers',
        ];
        const folder = validFolders.includes(folderRaw) ? folderRaw : 'uploads';

        const uploadedResults: Array<{
          key: string;
          url: string;
          mediaUrl: string;
          publicUrl: string;
          thumbnailUrl: string;
          mimeType: string;
          size: number;
          fileName?: string;
        }> = [];

        for (const file of fileList) {
          const mimeType = file.mimetype || 'image/jpeg';
          const s3Key = await s3Service.uploadMedia(file.buffer, userId, mimeType, folder);

          // Automatically generate thumbnail for images uploaded to public folders
          if (mimeType.startsWith('image/') && folder !== 'verifications') {
            s3Service.generateAndUploadThumbnail(s3Key, file.buffer).catch((err: any) => {
              console.warn(`[Thumbnail Warning] Could not generate thumbnail for ${s3Key}:`, err.message);
            });
          }

          const publicUrl = s3Service.getPublicUrl(s3Key);
          const thumbnailUrl = s3Service.getThumbnailUrl(s3Key);

          uploadedResults.push({
            key: s3Key,
            url: publicUrl,
            mediaUrl: publicUrl,
            publicUrl: publicUrl,
            thumbnailUrl: thumbnailUrl,
            mimeType: mimeType,
            size: file.size,
            fileName: file.originalname,
          });
        }

        const primary = uploadedResults[0];
        const responseData: any = {
          key: primary.key,
          url: primary.url,
          mediaUrl: primary.mediaUrl,
          publicUrl: primary.publicUrl,
          thumbnailUrl: primary.thumbnailUrl,
          mimeType: primary.mimeType,
          size: primary.size,
          fileName: primary.fileName,
        };

        if (uploadedResults.length > 1) {
          responseData.files = uploadedResults;
        }

        return sendSuccess(res, 'Media uploaded successfully', responseData, 201);
      }

      // 2. If no file is attached, generate presigned S3 PUT URL for direct client upload
      const folderRaw = (req.body?.folder || req.query?.folder || 'uploads').toString().trim();
      const validFolders = [
        'uploads',
        'photos',
        'moments',
        'verifications',
        'avatars',
        'quick-moments',
        'quick_moments',
        'audio',
        'chat',
        'covers',
      ];
      const folder = validFolders.includes(folderRaw) ? folderRaw : 'uploads';
      const mimeType = (req.body?.mimeType || req.query?.mimeType || 'image/jpeg').toString().trim();
      const rawExpiry = Number(req.body?.expiresInSeconds || req.query?.expiresInSeconds || 900);
      const expiresInSeconds = Number.isFinite(rawExpiry) && rawExpiry >= 60 && rawExpiry <= 3600
        ? rawExpiry
        : 900;

      const presignedData = await s3Service.generatePresignedUploadUrl(
        userId,
        mimeType,
        folder,
        expiresInSeconds
      );

      return sendSuccess(res, 'Presigned upload URL generated successfully', presignedData, 200);
    } catch (error) {
      next(error);
    }
  }

  /**
   * Generates a presigned S3 PUT URL for direct client upload
   * POST /api/v1/media/presigned-url
   * POST /api/v1/media/upload-url
   */
  public async getPresignedUploadUrl(
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    try {
      const userId = (req as any).user?.id || 'anonymous';
      const folderRaw = (req.body?.folder || req.query?.folder || 'uploads').toString().trim();
      const validFolders = [
        'uploads',
        'photos',
        'moments',
        'verifications',
        'avatars',
        'quick-moments',
        'quick_moments',
        'audio',
        'chat',
        'covers',
      ];
      const folder = validFolders.includes(folderRaw) ? folderRaw : 'uploads';
      const mimeType = (req.body?.mimeType || req.query?.mimeType || 'image/jpeg').toString().trim();
      const rawExpiry = Number(req.body?.expiresInSeconds || req.query?.expiresInSeconds || 900);
      const expiresInSeconds = Number.isFinite(rawExpiry) && rawExpiry >= 60 && rawExpiry <= 3600
        ? rawExpiry
        : 900;

      const presignedData = await s3Service.generatePresignedUploadUrl(
        userId,
        mimeType,
        folder,
        expiresInSeconds
      );

      return sendSuccess(res, 'Presigned upload URL generated successfully', presignedData, 200);
    } catch (error) {
      next(error);
    }
  }
}

export const mediaController = new MediaController();
