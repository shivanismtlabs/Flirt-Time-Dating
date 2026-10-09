import { Model, DataTypes, Optional } from 'sequelize';
import { sequelize } from '../config/database';

export type FaceVerificationStatus = 'approved' | 'rejected' | 'pending_review' | 'action_required';

export interface FaceVerificationAttributes {
  id: string;
  userId: string;
  status: FaceVerificationStatus;
  verificationType: string;
  sourceImage?: string | null;
  processedImage?: string | null;
  faceDetected: boolean;
  faceCount: number;
  qualityScore?: number | null;
  blurScore?: number | null;
  brightnessScore?: number | null;
  similarityScore?: number | null;
  identityMatched?: boolean | null;
  livenessStatus?: string | null;
  reasonCode: string;
  reasonMessage?: string | null;
  rejectionReason?: string | null;
  attempts: number;
  attemptNo: number;
  isLatest: boolean;
  metadata?: Record<string, any> | null;
  createdAt?: Date;
  updatedAt?: Date;
}

export interface FaceVerificationCreationAttributes
  extends Optional<
    FaceVerificationAttributes,
    | 'id'
    | 'status'
    | 'verificationType'
    | 'sourceImage'
    | 'processedImage'
    | 'faceDetected'
    | 'faceCount'
    | 'qualityScore'
    | 'blurScore'
    | 'brightnessScore'
    | 'similarityScore'
    | 'identityMatched'
    | 'livenessStatus'
    | 'reasonMessage'
    | 'rejectionReason'
    | 'attempts'
    | 'attemptNo'
    | 'isLatest'
    | 'metadata'
  > {}

export class FaceVerification
  extends Model<FaceVerificationAttributes, FaceVerificationCreationAttributes>
  implements FaceVerificationAttributes
{
  declare public id: string;
  declare public userId: string;
  declare public status: FaceVerificationStatus;
  declare public verificationType: string;
  declare public sourceImage: string | null;
  declare public processedImage: string | null;
  declare public faceDetected: boolean;
  declare public faceCount: number;
  declare public qualityScore: number | null;
  declare public blurScore: number | null;
  declare public brightnessScore: number | null;
  declare public similarityScore: number | null;
  declare public identityMatched: boolean | null;
  declare public livenessStatus: string | null;
  declare public reasonCode: string;
  declare public reasonMessage: string | null;
  declare public rejectionReason: string | null;
  declare public attempts: number;
  declare public attemptNo: number;
  declare public isLatest: boolean;
  declare public metadata: Record<string, any> | null;

  declare public readonly createdAt: Date;
  declare public readonly updatedAt: Date;
}

FaceVerification.init(
  {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
    },
    userId: {
      type: DataTypes.UUID,
      allowNull: false,
      references: {
        model: 'users',
        key: 'id',
      },
      onUpdate: 'CASCADE',
      onDelete: 'CASCADE',
    },
    status: {
      type: DataTypes.ENUM('approved', 'rejected', 'pending_review', 'action_required'),
      defaultValue: 'action_required',
      allowNull: false,
    },
    verificationType: {
      type: DataTypes.STRING(50),
      defaultValue: 'gesture',
      allowNull: false,
    },
    sourceImage: {
      type: DataTypes.STRING(500),
      allowNull: true,
    },
    processedImage: {
      type: DataTypes.STRING(500),
      allowNull: true,
    },
    faceDetected: {
      type: DataTypes.BOOLEAN,
      defaultValue: false,
      allowNull: false,
    },
    faceCount: {
      type: DataTypes.INTEGER,
      defaultValue: 0,
      allowNull: false,
    },
    qualityScore: {
      type: DataTypes.FLOAT,
      allowNull: true,
    },
    blurScore: {
      type: DataTypes.FLOAT,
      allowNull: true,
    },
    brightnessScore: {
      type: DataTypes.FLOAT,
      allowNull: true,
    },
    similarityScore: {
      type: DataTypes.FLOAT,
      allowNull: true,
    },
    identityMatched: {
      type: DataTypes.BOOLEAN,
      allowNull: true,
    },
    livenessStatus: {
      type: DataTypes.STRING(50),
      defaultValue: 'unavailable_single_frame',
      allowNull: true,
    },
    reasonCode: {
      type: DataTypes.STRING(100),
      allowNull: false,
      defaultValue: 'PENDING_EVALUATION',
    },
    reasonMessage: {
      type: DataTypes.STRING(500),
      allowNull: true,
    },
    rejectionReason: {
      type: DataTypes.STRING(255),
      allowNull: true,
    },
    attempts: {
      type: DataTypes.INTEGER,
      defaultValue: 1,
      allowNull: false,
    },
    attemptNo: {
      type: DataTypes.INTEGER,
      defaultValue: 1,
      allowNull: false,
    },
    isLatest: {
      type: DataTypes.BOOLEAN,
      defaultValue: true,
      allowNull: false,
    },
    metadata: {
      type: DataTypes.JSON,
      allowNull: true,
    },
  },
  {
    sequelize,
    tableName: 'face_verifications',
    timestamps: true,
    indexes: [
      {
        fields: ['userId'],
      },
      {
        fields: ['status'],
      },
      {
        fields: ['isLatest'],
      },
      {
        fields: ['createdAt'],
      },
    ],
  }
);
