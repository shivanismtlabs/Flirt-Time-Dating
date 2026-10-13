import { DataTypes, Model, Optional } from 'sequelize';
import { sequelize } from '../config/database';

export type ConnectionRequestStatus = 'pending' | 'accepted' | 'rejected' | 'cancelled';

export interface ConnectionRequestAttributes {
  id: string;
  requesterId: string;
  targetUserId: string;
  status: ConnectionRequestStatus;
  message?: string | null;
  reason?: string | null;
  momentId?: string | null;
  respondedAt?: Date | null;
  createdAt?: Date;
  updatedAt?: Date;
}

export interface ConnectionRequestCreationAttributes
  extends Optional<
    ConnectionRequestAttributes,
    'id' | 'status' | 'message' | 'reason' | 'momentId' | 'respondedAt' | 'createdAt' | 'updatedAt'
  > {}

export class ConnectionRequest
  extends Model<ConnectionRequestAttributes, ConnectionRequestCreationAttributes>
  implements ConnectionRequestAttributes
{
  declare id: string;
  declare requesterId: string;
  declare targetUserId: string;
  declare status: ConnectionRequestStatus;
  declare message: string | null;
  declare reason: string | null;
  declare momentId: string | null;
  declare respondedAt: Date | null;

  declare readonly createdAt: Date;
  declare readonly updatedAt: Date;

  // Associations
  declare requester?: any;
  declare targetUser?: any;
}

ConnectionRequest.init(
  {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
    },
    requesterId: {
      type: DataTypes.UUID,
      allowNull: false,
      references: {
        model: 'users',
        key: 'id',
      },
      onDelete: 'CASCADE',
    },
    targetUserId: {
      type: DataTypes.UUID,
      allowNull: false,
      references: {
        model: 'users',
        key: 'id',
      },
      onDelete: 'CASCADE',
    },
    status: {
      type: DataTypes.ENUM('pending', 'accepted', 'rejected', 'cancelled'),
      allowNull: false,
      defaultValue: 'pending',
    },
    message: {
      type: DataTypes.STRING(500),
      allowNull: true,
    },
    reason: {
      type: DataTypes.STRING(150),
      allowNull: true,
    },
    momentId: {
      type: DataTypes.UUID,
      allowNull: true,
    },
    respondedAt: {
      type: DataTypes.DATE,
      allowNull: true,
    },
  },
  {
    sequelize,
    tableName: 'connection_requests',
    timestamps: true,
    indexes: [
      {
        fields: ['requesterId', 'targetUserId'],
      },
      {
        fields: ['targetUserId', 'status'],
      },
      {
        fields: ['status'],
      },
    ],
  }
);
