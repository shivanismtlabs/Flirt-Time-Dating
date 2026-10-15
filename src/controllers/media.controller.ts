import { Request, Response, NextFunction } from 'express';
import { s3Service } from '../services/s3.service';

export class MediaController {
  /**
   * Generates a presigned S3 PUT URL for direct client upload
   * POST /api/v1/media/presigned-url
   */
  public async getPresignedUploadUrl(
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    try {
      const userId = (req as any).user?.id || 'anonymous';
      const { mimeType = 'image/jpeg', folder = 'uploads', expiresInSeconds = 900 } = req.body;

      const presignedData = await s3Service.generatePresignedUploadUrl(
        userId,
        mimeType,
        folder,
        expiresInSeconds
      );

      res.status(200).json({
        success: true,
        message: 'Presigned upload URL generated successfully',
        data: presignedData,
      });
    } catch (error) {
      next(error);
    }
  }
}

export const mediaController = new MediaController();
