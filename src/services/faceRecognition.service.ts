import path from 'path';
import fs from 'fs';
import * as ort from 'onnxruntime-node';

export interface FaceComparisonResult {
  similarityScore: number;
  isMatch: boolean;
  threshold: number;
  embeddingDimension: number;
}

export class FaceRecognitionService {
  private sfaceSession: ort.InferenceSession | null = null;
  private isInitializing: boolean = false;
  private readonly modelPath: string;
  public static readonly DEFAULT_SIMILARITY_THRESHOLD = 0.65;

  constructor() {
    this.modelPath = path.resolve(
      __dirname,
      '../assets/models/face_recognition_sface_2021dec.onnx'
    );
  }

  /**
   * Initializes or gets the cached ONNX session for SFace
   */
  public async getSession(): Promise<ort.InferenceSession> {
    if (this.sfaceSession) {
      return this.sfaceSession;
    }

    if (this.isInitializing) {
      while (this.isInitializing) {
        await new Promise((res) => setTimeout(res, 50));
      }
      if (this.sfaceSession) return this.sfaceSession;
    }

    this.isInitializing = true;
    try {
      if (!fs.existsSync(this.modelPath)) {
        throw new Error(`SFace ONNX model not found at ${this.modelPath}`);
      }
      this.sfaceSession = await ort.InferenceSession.create(this.modelPath, {
        executionProviders: ['cpu'],
        graphOptimizationLevel: 'all',
      });
      return this.sfaceSession;
    } finally {
      this.isInitializing = false;
    }
  }

  /**
   * Extracts 128-dimensional unit-normalized feature embedding from a 112x112 RGB face buffer
   */
  public async extractEmbedding(faceCrop112x112Buffer: Buffer): Promise<Float32Array> {
    const session = await this.getSession();

    // SFace input shape: [1, 3, 112, 112] float32 NCHW
    const OrtFloat32 = (new ort.Tensor('float32', [0], [1])).data.constructor as Float32ArrayConstructor;
    const floatData = new OrtFloat32(1 * 3 * 112 * 112);
    for (let c = 0; c < 3; c++) {
      for (let h = 0; h < 112; h++) {
        for (let w = 0; w < 112; w++) {
          const rawIdx = (h * 112 + w) * 3 + c;
          const tensorIdx = c * (112 * 112) + (h * 112 + w);
          floatData[tensorIdx] = faceCrop112x112Buffer[rawIdx];
        }
      }
    }

    const inputTensor = new ort.Tensor('float32', floatData, [1, 3, 112, 112]);
    const results = await session.run({ data: inputTensor });

    const rawEmbedding = results.fc1.data as Float32Array;

    // L2 Normalize embedding to unit length
    let normSq = 0;
    for (let i = 0; i < rawEmbedding.length; i++) {
      normSq += rawEmbedding[i] * rawEmbedding[i];
    }
    const norm = Math.sqrt(normSq) || 1e-12;

    const normalizedEmbedding = new Float32Array(rawEmbedding.length);
    for (let i = 0; i < rawEmbedding.length; i++) {
      normalizedEmbedding[i] = rawEmbedding[i] / norm;
    }

    return normalizedEmbedding;
  }

  /**
   * Calculates cosine similarity between two normalized face embeddings
   */
  public calculateCosineSimilarity(emb1: Float32Array, emb2: Float32Array): number {
    if (emb1.length !== emb2.length) {
      throw new Error(`Embedding dimensions do not match: ${emb1.length} vs ${emb2.length}`);
    }

    let dot = 0;
    for (let i = 0; i < emb1.length; i++) {
      dot += emb1[i] * emb2[i];
    }

    // Clamp between -1.0 and 1.0
    return Math.max(-1.0, Math.min(1.0, dot));
  }

  /**
   * Compares two 112x112 face crops and determines if they represent the same person
   */
  public async compareFaces(
    selfieCrop: Buffer,
    referenceCrop: Buffer,
    threshold = FaceRecognitionService.DEFAULT_SIMILARITY_THRESHOLD
  ): Promise<FaceComparisonResult> {
    const [emb1, emb2] = await Promise.all([
      this.extractEmbedding(selfieCrop),
      this.extractEmbedding(referenceCrop),
    ]);

    const similarity = this.calculateCosineSimilarity(emb1, emb2);
    const isMatch = similarity >= threshold;

    return {
      similarityScore: Math.round(similarity * 1000) / 1000,
      isMatch,
      threshold,
      embeddingDimension: emb1.length,
    };
  }
}

export const faceRecognitionService = new FaceRecognitionService();
