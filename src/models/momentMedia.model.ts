import { Model, DataTypes, Optional } from 'sequelize';
import { sequelize } from '../config/database';

export interface MomentMediaAttributes {
  id: string;
  momentId: string;
  mediaUrl: string;
  mediaType: 'image';
  displayOrder: number;
  createdAt?: Date;
  updatedAt?: Date;
}

export interface MomentMediaCreationAttributes
  extends Optional<MomentMediaAttributes, 'id' | 'mediaType' | 'displayOrder' | 'createdAt' | 'updatedAt'> {}

export class MomentMedia
  extends Model<MomentMediaAttributes, MomentMediaCreationAttributes>
  implements MomentMediaAttributes {
  declare public id: string;
  declare public momentId: string;
  declare public mediaUrl: string;
  declare public mediaType: 'image';
  declare public displayOrder: number;

  declare public readonly createdAt: Date;
  declare public readonly updatedAt: Date;
}

MomentMedia.init(
  {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
    },
    momentId: {
      type: DataTypes.UUID,
      allowNull: false,
      references: {
        model: 'moments',
        key: 'id',
      },
      onDelete: 'CASCADE',
      onUpdate: 'CASCADE',
    },
    mediaUrl: {
      type: DataTypes.STRING(500),
      allowNull: false,
    },
    mediaType: {
      type: DataTypes.STRING(20),
      defaultValue: 'image',
      allowNull: false,
    },
    displayOrder: {
      type: DataTypes.INTEGER,
      defaultValue: 0,
      allowNull: false,
    },
  },
  {
    sequelize,
    tableName: 'moment_media',
    timestamps: true,
    indexes: [
      {
        fields: ['momentId', 'displayOrder'],
        name: 'idx_moment_media_order',
      },
    ],
  }
);
