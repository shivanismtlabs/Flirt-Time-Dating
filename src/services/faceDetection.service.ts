import path from 'path';
import fs from 'fs';
import sharp from 'sharp';
import * as ort from 'onnxruntime-node';

export interface BoundingBox {
  xMin: number;
  yMin: number;
  xMax: number;
  yMax: number;
  width: number;
  height: number;
  confidence: number;
}

export interface ImageQualityMetrics {
  width: number;
  height: number;
  format: string;
  channels: number;
  meanBrightness: number;
  blurVariance: number;
  isLightingAcceptable: boolean;
  isSharpnessAcceptable: boolean;
  lightingIssue?: 'TOO_DARK' | 'TOO_BRIGHT';
}

export interface FaceDetectionResult {
  faces: BoundingBox[];
  faceCount: number;
  quality: ImageQualityMetrics;
  primaryFaceCropBuffer?: Buffer;
  errorReason?: string;
  errorMessage?: string;
}

export class FaceDetectionService {
  private ultraFaceSession: ort.InferenceSession | null = null;
  private isInitializing: boolean = false;
  private readonly modelPath: string;
  private priors: [number, number, number, number][] = [];

  constructor() {
    this.modelPath = path.resolve(
      __dirname,
      '../assets/models/version-RFB-320.onnx'
    );
    this.initPriors();
  }

  /**
   * Generates SSD prior anchors for UltraFace 320x240 RFB model
   */
  private initPriors(): void {
    const featureMapSizes = [
      [30, 40],
      [15, 20],
      [8, 10],
      [4, 5],
    ];
    const shrinkageTable = [8, 16, 32, 64];
    const minBoxesTable = [
      [10, 16, 24],
      [32, 48],
      [64, 96],
      [128, 192, 256],
    ];

    this.priors = [];
    for (let index = 0; index < featureMapSizes.length; index++) {
      const [fH, fW] = featureMapSizes[index];
      const s = shrinkageTable[index];
      const minBoxes = minBoxesTable[index];
      for (let y = 0; y < fH; y++) {
        for (let x = 0; x < fW; x++) {
          const cx = ((x + 0.5) * s) / 320;
          const cy = ((y + 0.5) * s) / 240;
          for (const minSize of minBoxes) {
            const w = minSize / 320;
            const h = minSize / 240;
            this.priors.push([cx, cy, w, h]);
          }
        }
      }
    }
  }

  /**
   * Initializes or gets the cached ONNX session for UltraFace
   */
  public async getSession(): Promise<ort.InferenceSession> {
    if (this.ultraFaceSession) {
      return this.ultraFaceSession;
    }

    if (this.isInitializing) {
      while (this.isInitializing) {
        await new Promise((res) => setTimeout(res, 50));
      }
      if (this.ultraFaceSession) return this.ultraFaceSession;
    }

    this.isInitializing = true;
    try {
      if (!fs.existsSync(this.modelPath)) {
        throw new Error(`UltraFace ONNX model not found at ${this.modelPath}`);
      }
      this.ultraFaceSession = await ort.InferenceSession.create(this.modelPath, {
        executionProviders: ['cpu'],
        graphOptimizationLevel: 'all',
      });
      return this.ultraFaceSession;
    } finally {
      this.isInitializing = false;
    }
  }

  /**
   * Validates file signature (magic bytes) to ensure file content matches image format
   */
  public validateFileSignature(buffer: Buffer): { isValid: boolean; detectedFormat?: string } {
    if (!buffer || buffer.length < 12) {
      return { isValid: false };
    }

    // JPEG: FF D8 FF
    if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
      return { isValid: true, detectedFormat: 'jpeg' };
    }

    // PNG: 89 50 4E 47 0D 0A 1A 0A
    if (
      buffer[0] === 0x89 &&
      buffer[1] === 0x50 &&
      buffer[2] === 0x4e &&
      buffer[3] === 0x47 &&
      buffer[4] === 0x0d &&
      buffer[5] === 0x0a &&
      buffer[6] === 0x1a &&
      buffer[7] === 0x0a
    ) {
      return { isValid: true, detectedFormat: 'png' };
    }

    // WebP: RIFF .... WEBP
    if (
      buffer[0] === 0x52 &&
      buffer[1] === 0x49 &&
      buffer[2] === 0x46 &&
      buffer[3] === 0x46 &&
      buffer[8] === 0x57 &&
      buffer[9] === 0x45 &&
      buffer[10] === 0x42 &&
      buffer[11] === 0x50
    ) {
      return { isValid: true, detectedFormat: 'webp' };
    }

    return { isValid: false };
  }

  /**
   * Calculates Laplacian variance for sharpness/blur estimation and mean brightness
   */
  public async analyzeQuality(buffer: Buffer): Promise<ImageQualityMetrics> {
    const image = sharp(buffer);
    const metadata = await image.metadata();

    if (!metadata.width || !metadata.height) {
      throw new Error('Could not read image dimensions');
    }

    // 1. Mean brightness via stats
    const stats = await image.stats();
    const channelMeans = stats.channels.map((c) => c.mean);
    const meanBrightness =
      channelMeans.reduce((acc, val) => acc + val, 0) / (channelMeans.length || 1);

    const isTooDark = meanBrightness < 35;
    const isTooBright = meanBrightness > 230;
    const isLightingAcceptable = !isTooDark && !isTooBright;
    const lightingIssue = isTooDark ? 'TOO_DARK' : isTooBright ? 'TOO_BRIGHT' : undefined;

    // 2. Sharpness / Blur via Laplacian variance on grayscale raw pixels
    const sampleWidth = Math.min(metadata.width, 400);
    const sampleHeight = Math.min(metadata.height, 400);
    const { data: grayData, info } = await sharp(buffer)
      .resize(sampleWidth, sampleHeight, { fit: 'inside' })
      .grayscale()
      .raw()
      .toBuffer({ resolveWithObject: true });

    const w = info.width;
    const h = info.height;
    let lapSum = 0;
    let lapSqSum = 0;
    let count = 0;

    for (let y = 1; y < h - 1; y++) {
      for (let x = 1; x < w - 1; x++) {
        const center = grayData[y * w + x];
        const up = grayData[(y - 1) * w + x];
        const down = grayData[(y + 1) * w + x];
        const left = grayData[y * w + (x - 1)];
        const right = grayData[y * w + (x + 1)];

        // Discrete Laplacian kernel: [[0, 1, 0], [1, -4, 1], [0, 1, 0]]
        const lap = up + down + left + right - 4 * center;
        lapSum += lap;
        lapSqSum += lap * lap;
        count++;
      }
    }

    const meanLap = count > 0 ? lapSum / count : 0;
    const blurVariance = count > 0 ? lapSqSum / count - meanLap * meanLap : 0;
    const isSharpnessAcceptable = blurVariance >= 12.0;

    return {
      width: metadata.width,
      height: metadata.height,
      format: metadata.format || 'unknown',
      channels: metadata.channels || 3,
      meanBrightness: Math.round(meanBrightness * 100) / 100,
      blurVariance: Math.round(blurVariance * 100) / 100,
      isLightingAcceptable,
      isSharpnessAcceptable,
      lightingIssue,
    };
  }

  /**
   * Runs face detection and analyzes face geometry, count, size, and centering
   */
  public async detectFaces(buffer: Buffer): Promise<FaceDetectionResult> {
    // 1. Validate signature
    const sig = this.validateFileSignature(buffer);
    if (!sig.isValid) {
      throw new Error('Invalid image file signature or unsupported format.');
    }

    // 2. Validate corrupt image & get quality metrics
    const quality = await this.analyzeQuality(buffer);

    if (quality.width < 100 || quality.height < 100) {
      return {
        faces: [],
        faceCount: 0,
        quality,
        errorReason: 'IMAGE_DIMENSIONS_TOO_SMALL',
        errorMessage: 'Image dimensions are too small. Minimum resolution is 100x100 pixels.',
      };
    }

    // 3. Preprocess for UltraFace ONNX (320x240 RGB normalized)
    const session = await this.getSession();
    const rawRgbBuffer = await sharp(buffer)
      .resize(320, 240, { fit: 'fill' })
      .removeAlpha()
      .raw()
      .toBuffer();

    const OrtFloat32 = (new ort.Tensor('float32', [0], [1])).data.constructor as Float32ArrayConstructor;
    const floatData = new OrtFloat32(1 * 3 * 240 * 320);
    for (let c = 0; c < 3; c++) {
      for (let h = 0; h < 240; h++) {
        for (let w = 0; w < 320; w++) {
          const rawIdx = (h * 320 + w) * 3 + c;
          const tensorIdx = c * (240 * 320) + (h * 320 + w);
          floatData[tensorIdx] = (rawRgbBuffer[rawIdx] - 127.0) / 128.0;
        }
      }
    }

    const inputTensor = new ort.Tensor('float32', floatData, [1, 3, 240, 320]);
    const inferenceResults = await session.run({ input: inputTensor });

    const scoresTensor = inferenceResults.scores;
    const boxesTensor = inferenceResults.boxes;

    const scoresData = scoresTensor.data as Float32Array;
    const boxesData = boxesTensor.data as Float32Array;

    const rawCandidates: BoundingBox[] = [];
    const confidenceThreshold = 0.70;

    for (let i = 0; i < this.priors.length; i++) {
      const bgLogit = scoresData[i * 2 + 0];
      const faceLogit = scoresData[i * 2 + 1];

      // Softmax
      const maxLogit = Math.max(bgLogit, faceLogit);
      const expBg = Math.exp(bgLogit - maxLogit);
      const expFace = Math.exp(faceLogit - maxLogit);
      const faceScore = expFace / (expBg + expFace);

      if (faceScore >= confidenceThreshold) {
        const prior = this.priors[i];
        const boxPredCx = boxesData[i * 4 + 0];
        const boxPredCy = boxesData[i * 4 + 1];
        const boxPredW = boxesData[i * 4 + 2];
        const boxPredH = boxesData[i * 4 + 3];

        const cx = boxPredCx * 0.1 * prior[2] + prior[0];
        const cy = boxPredCy * 0.1 * prior[3] + prior[1];
        const w = Math.exp(boxPredW * 0.2) * prior[2];
        const h = Math.exp(boxPredH * 0.2) * prior[3];

        const xMinNorm = Math.max(0, cx - w / 2);
        const yMinNorm = Math.max(0, cy - h / 2);
        const xMaxNorm = Math.min(1, cx + w / 2);
        const yMaxNorm = Math.min(1, cy + h / 2);

        const xMin = Math.round(xMinNorm * quality.width);
        const yMin = Math.round(yMinNorm * quality.height);
        const xMax = Math.round(xMaxNorm * quality.width);
        const yMax = Math.round(yMaxNorm * quality.height);
        const width = Math.max(1, xMax - xMin);
        const height = Math.max(1, yMax - yMin);

        rawCandidates.push({
          xMin,
          yMin,
          xMax,
          yMax,
          width,
          height,
          confidence: Math.round(faceScore * 1000) / 1000,
        });
      }
    }

    // 4. Non-Maximum Suppression (NMS)
    const nmsFilteredFaces = this.applyNMS(rawCandidates, 0.35);

    // 5. Evaluate face count & geometric quality rules
    if (nmsFilteredFaces.length === 0) {
      return {
        faces: [],
        faceCount: 0,
        quality,
        errorReason: 'NO_FACE_DETECTED',
        errorMessage: 'No face detected in the image. Please take a clear photo showing your face.',
      };
    }

    if (nmsFilteredFaces.length > 1) {
      return {
        faces: nmsFilteredFaces,
        faceCount: nmsFilteredFaces.length,
        quality,
        errorReason: 'MULTIPLE_FACES_DETECTED',
        errorMessage: 'Multiple faces detected. Please upload a photo with only yourself.',
      };
    }

    const primaryFace = nmsFilteredFaces[0];
    const imgArea = quality.width * quality.height;
    const faceArea = primaryFace.width * primaryFace.height;
    const faceAreaRatio = faceArea / imgArea;

    // Face Size Rule
    if (faceAreaRatio < 0.04 || primaryFace.width < 50 || primaryFace.height === 0) {
      return {
        faces: nmsFilteredFaces,
        faceCount: 1,
        quality,
        errorReason: 'FACE_TOO_SMALL',
        errorMessage: 'Face is too small in the frame. Please move closer to the camera.',
      };
    }

    // Face Centering & Boundary Rule
    const faceCenterX = primaryFace.xMin + primaryFace.width / 2;
    const faceCenterY = primaryFace.yMin + primaryFace.height / 2;
    const imgCenterX = quality.width / 2;
    const imgCenterY = quality.height / 2;
    const offsetX = Math.abs(faceCenterX - imgCenterX) / quality.width;
    const offsetY = Math.abs(faceCenterY - imgCenterY) / quality.height;

    const isCutOffAtBorders =
      (primaryFace.xMin <= 2 || primaryFace.yMin <= 2 ||
       primaryFace.xMax >= quality.width - 2 || primaryFace.yMax >= quality.height - 2) &&
      (offsetX > 0.35 || offsetY > 0.35);

    if (isCutOffAtBorders) {
      return {
        faces: nmsFilteredFaces,
        faceCount: 1,
        quality,
        errorReason: 'FACE_POORLY_POSITIONED',
        errorMessage: 'Face is poorly positioned or cut off. Please center your face in the frame.',
      };
    }

    // Image Lighting Rule
    if (!quality.isLightingAcceptable) {
      if (quality.lightingIssue === 'TOO_DARK') {
        return {
          faces: nmsFilteredFaces,
          faceCount: 1,
          quality,
          errorReason: 'POOR_LIGHTING_TOO_DARK',
          errorMessage: 'Image is too dark. Please ensure good lighting and avoid shadows.',
        };
      } else {
        return {
          faces: nmsFilteredFaces,
          faceCount: 1,
          quality,
          errorReason: 'POOR_LIGHTING_OVEREXPOSED',
          errorMessage: 'Image is overexposed. Please avoid harsh flash or strong backlighting.',
        };
      }
    }

    // Image Sharpness Rule
    if (!quality.isSharpnessAcceptable) {
      return {
        faces: nmsFilteredFaces,
        faceCount: 1,
        quality,
        errorReason: 'IMAGE_TOO_BLURRY',
        errorMessage: 'Image is too blurry. Please hold the camera steady and refocus.',
      };
    }

    // 6. Crop Face region with 15% padding for embedding recognition
    const padX = Math.round(primaryFace.width * 0.15);
    const padY = Math.round(primaryFace.height * 0.15);
    const cropLeft = Math.max(0, primaryFace.xMin - padX);
    const cropTop = Math.max(0, primaryFace.yMin - padY);
    const cropWidth = Math.min(quality.width - cropLeft, primaryFace.width + padX * 2);
    const cropHeight = Math.min(quality.height - cropTop, primaryFace.height + padY * 2);

    const primaryFaceCropBuffer = await sharp(buffer)
      .extract({ left: cropLeft, top: cropTop, width: cropWidth, height: cropHeight })
      .resize(112, 112, { fit: 'fill' })
      .removeAlpha()
      .raw()
      .toBuffer();

    return {
      faces: nmsFilteredFaces,
      faceCount: 1,
      quality,
      primaryFaceCropBuffer,
    };
  }

  /**
   * Applies Non-Maximum Suppression (NMS) to eliminate duplicate face bounding boxes
   */
  private applyNMS(boxes: BoundingBox[], iouThreshold = 0.35): BoundingBox[] {
    const sorted = [...boxes].sort((a, b) => b.confidence - a.confidence);
    const selected: BoundingBox[] = [];

    for (const current of sorted) {
      let keep = true;
      for (const chosen of selected) {
        if (this.calculateIoU(current, chosen) > iouThreshold) {
          keep = false;
          break;
        }
      }
      if (keep) {
        selected.push(current);
      }
    }

    return selected;
  }

  private calculateIoU(boxA: BoundingBox, boxB: BoundingBox): number {
    const xA = Math.max(boxA.xMin, boxB.xMin);
    const yA = Math.max(boxA.yMin, boxB.yMin);
    const xB = Math.min(boxA.xMax, boxB.xMax);
    const yB = Math.min(boxA.yMax, boxB.yMax);

    const interArea = Math.max(0, xB - xA) * Math.max(0, yB - yA);
    const boxAArea = boxA.width * boxA.height;
    const boxBArea = boxB.width * boxB.height;
    const unionArea = boxAArea + boxBArea - interArea;

    return unionArea > 0 ? interArea / unionArea : 0;
  }
}

export const faceDetectionService = new FaceDetectionService();
