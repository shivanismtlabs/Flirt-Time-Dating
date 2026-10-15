import { Model, DataTypes, Optional } from 'sequelize';
import { sequelize } from '../config/database';

export const OTP_PURPOSES = {
  AUTH: 'auth',
  PROFILE_EMAIL_CHANGE: 'profile_email_change',
  PROFILE_PHONE_CHANGE: 'profile_phone_change',
} as const;

export type OtpPurpose = typeof OTP_PURPOSES[keyof typeof OTP_PURPOSES] | string;

export interface EmailVerificationAttributes {
  id: string;
  userId?: string | null;
  email: string;
  purpose?: string;
  otpHash: string;
  expiresAt: Date;
  isConsumed: boolean;
  isVerified: boolean;
  attempts: number;
  maxAttempts: number;
  resendCount: number;
  maxResends: number;
  lastResentAt?: Date | null;
  consumedAt?: Date | null;
  createdAt?: Date;
  updatedAt?: Date;
}

export interface EmailVerificationCreationAttributes
  extends Optional<
    EmailVerificationAttributes,
    | 'id'
    | 'userId'
    | 'purpose'
    | 'isConsumed'
    | 'isVerified'
    | 'attempts'
    | 'maxAttempts'
    | 'resendCount'
    | 'maxResends'
    | 'lastResentAt'
    | 'consumedAt'
  > {}

export class EmailVerification
  extends Model<EmailVerificationAttributes, EmailVerificationCreationAttributes>
  implements EmailVerificationAttributes
{
  declare public id: string;
  declare public userId: string | null;
  declare public email: string;
  declare public purpose: string;
  declare public otpHash: string;
  declare public expiresAt: Date;
  declare public isConsumed: boolean;
  declare public isVerified: boolean;
  declare public attempts: number;
  declare public maxAttempts: number;
  declare public resendCount: number;
  declare public maxResends: number;
  declare public lastResentAt: Date | null;
  declare public consumedAt: Date | null;

  declare public readonly createdAt: Date;
  declare public readonly updatedAt: Date;

  // Never leak sensitive data (OTP hash) when serializing
  public toJSON(): Omit<EmailVerificationAttributes, 'otpHash'> {
    const values = { ...this.get() };
    delete (values as any).otpHash;
    return values;
  }
}

EmailVerification.init(
  {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
    },
    userId: {
      type: DataTypes.UUID,
      allowNull: true,
    },
    email: {
      type: DataTypes.STRING(100),
      allowNull: false,
    },
    purpose: {
      type: DataTypes.STRING(50),
      allowNull: false,
      defaultValue: 'auth',
    },
    otpHash: {
      type: DataTypes.STRING(255),
      allowNull: false,
    },
    expiresAt: {
      type: DataTypes.DATE,
      allowNull: false,
    },
    isConsumed: {
      type: DataTypes.BOOLEAN,
      defaultValue: false,
      allowNull: false,
    },
    isVerified: {
      type: DataTypes.BOOLEAN,
      defaultValue: false,
      allowNull: false,
    },
    attempts: {
      type: DataTypes.INTEGER,
      defaultValue: 0,
      allowNull: false,
    },
    maxAttempts: {
      type: DataTypes.INTEGER,
      defaultValue: 5,
      allowNull: false,
    },
    resendCount: {
      type: DataTypes.INTEGER,
      defaultValue: 0,
      allowNull: false,
    },
    maxResends: {
      type: DataTypes.INTEGER,
      defaultValue: 3,
      allowNull: false,
    },
    lastResentAt: {
      type: DataTypes.DATE,
      allowNull: true,
    },
    consumedAt: {
      type: DataTypes.DATE,
      allowNull: true,
    },
  },
  {
    sequelize,
    tableName: 'email_verifications',
    timestamps: true,
    indexes: [
      {
        fields: ['email'],
      },
      {
        fields: ['userId'],
      },
      {
        fields: ['purpose'],
      },
      {
        fields: ['expiresAt'],
      },
      {
        fields: ['isConsumed'],
      },
    ],
  }
);
