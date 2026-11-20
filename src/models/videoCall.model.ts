import { Model, DataTypes, Optional } from 'sequelize';
import { sequelize } from '../config/database';

export type CallType = 'video' | 'audio';

export type VideoCallStatus =
  | 'ringing'
  | 'accepted'
  | 'rejected'
  | 'missed'
  | 'ended'
  | 'failed';

export const VIDEO_CALL_STATUSES: VideoCallStatus[] = [
  'ringing',
  'accepted',
  'rejected',
  'missed',
  'ended',
  'failed',
];

export interface VideoCallAttributes {
  id: string;
  callerId: string;
  calleeId: string;
  conversationId?: string | null;
  channelName: string;
  callerUid: number;
  calleeUid: number;
  status: VideoCallStatus;
  callType?: CallType;
  startedAt?: Date | null;
  acceptedAt?: Date | null;
  endedAt?: Date | null;
  expiresAt: Date;
  endedBy?: string | null;
  createdAt?: Date;
  updatedAt?: Date;
}

export interface VideoCallCreationAttributes
  extends Optional<
    VideoCallAttributes,
    | 'id'
    | 'conversationId'
    | 'status'
    | 'callType'
    | 'startedAt'
    | 'acceptedAt'
    | 'endedAt'
    | 'endedBy'
    | 'createdAt'
    | 'updatedAt'
  > {}

export class VideoCall
  extends Model<VideoCallAttributes, VideoCallCreationAttributes>
  implements VideoCallAttributes
{
  declare public id: string;
  declare public callerId: string;
  declare public calleeId: string;
  declare public conversationId: string | null;
  declare public channelName: string;
  declare public callerUid: number;
  declare public calleeUid: number;
  declare public status: VideoCallStatus;
  declare public callType: CallType;
  declare public startedAt: Date | null;
  declare public acceptedAt: Date | null;
  declare public endedAt: Date | null;
  declare public expiresAt: Date;
  declare public endedBy: string | null;

  declare public readonly createdAt: Date;
  declare public readonly updatedAt: Date;

  declare public caller?: any;
  declare public callee?: any;
  declare public conversation?: any;
  declare public terminator?: any;
}

VideoCall.init(
  {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
    },
    callerId: {
      type: DataTypes.UUID,
      allowNull: false,
      references: {
        model: 'users',
        key: 'id',
      },
      onDelete: 'CASCADE',
      onUpdate: 'CASCADE',
    },
    calleeId: {
      type: DataTypes.UUID,
      allowNull: false,
      references: {
        model: 'users',
        key: 'id',
      },
      onDelete: 'CASCADE',
      onUpdate: 'CASCADE',
    },
    conversationId: {
      type: DataTypes.UUID,
      allowNull: true,
      references: {
        model: 'conversations',
        key: 'id',
      },
      onDelete: 'SET NULL',
      onUpdate: 'CASCADE',
    },
    channelName: {
      type: DataTypes.STRING(100),
      allowNull: false,
      unique: true,
    },
    callerUid: {
      type: DataTypes.INTEGER,
      allowNull: false,
    },
    calleeUid: {
      type: DataTypes.INTEGER,
      allowNull: false,
    },
    callType: {
      type: DataTypes.STRING(20),
      allowNull: false,
      defaultValue: 'video',
      validate: {
        isIn: [['video', 'audio']],
      },
    },
    status: {
      type: DataTypes.STRING(30),
      allowNull: false,
      defaultValue: 'ringing',
      validate: {
        isIn: [VIDEO_CALL_STATUSES],
      },
    },
    startedAt: {
      type: DataTypes.DATE,
      allowNull: true,
    },
    acceptedAt: {
      type: DataTypes.DATE,
      allowNull: true,
    },
    endedAt: {
      type: DataTypes.DATE,
      allowNull: true,
    },
    expiresAt: {
      type: DataTypes.DATE,
      allowNull: false,
    },
    endedBy: {
      type: DataTypes.UUID,
      allowNull: true,
      references: {
        model: 'users',
        key: 'id',
      },
      onDelete: 'SET NULL',
      onUpdate: 'CASCADE',
    },
  },
  {
    sequelize,
    tableName: 'video_calls',
    timestamps: true,
    indexes: [
      {
        fields: ['callerId'],
        name: 'idx_video_calls_caller_id',
      },
      {
        fields: ['calleeId'],
        name: 'idx_video_calls_callee_id',
      },
      {
        fields: ['status', 'expiresAt'],
        name: 'idx_video_calls_status_expires',
      },
      {
        unique: true,
        fields: ['channelName'],
        name: 'idx_video_calls_channel_name',
      },
      {
        fields: ['conversationId'],
        name: 'idx_video_calls_conversation_id',
      },
    ],
  }
);
