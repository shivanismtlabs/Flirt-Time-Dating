import { Model, DataTypes, Optional } from 'sequelize';
import { sequelize } from '../config/database';

export interface UserPhotoAttributes {
  id: string;
  userId: string;
  imageUrl: string;
  isPrimary: boolean;
  displayOrder: number;
  status: 'pending' | 'approved' | 'rejected';
  createdAt?: Date;
  updatedAt?: Date;
}

export interface UserPhotoCreationAttributes
  extends Optional<UserPhotoAttributes, 'id' | 'isPrimary' | 'displayOrder' | 'status'> {}

export class UserPhoto extends Model<UserPhotoAttributes, UserPhotoCreationAttributes>
  implements UserPhotoAttributes {
  declare public id: string;
  declare public userId: string;
  declare public imageUrl: string;
  declare public isPrimary: boolean;
  declare public displayOrder: number;
  declare public status: 'pending' | 'approved' | 'rejected';

  declare public readonly createdAt: Date;
  declare public readonly updatedAt: Date;
}

UserPhoto.init(
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
      onDelete: 'CASCADE',
      onUpdate: 'CASCADE',
    },
    imageUrl: {
      type: DataTypes.STRING(500),
      allowNull: false,
    },
    isPrimary: {
      type: DataTypes.BOOLEAN,
      defaultValue: false,
      allowNull: false,
    },
    displayOrder: {
      type: DataTypes.INTEGER,
      defaultValue: 0,
      allowNull: false,
    },
    status: {
      type: DataTypes.STRING(50),
      defaultValue: 'approved',
      allowNull: false,
    },
  },
  {
    sequelize,
    tableName: 'user_photos',
    timestamps: true,
  }
);
