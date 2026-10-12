import { Model, DataTypes, Optional } from 'sequelize';
import { sequelize } from '../config/database';

export interface InterestAttributes {
  id: string;
  name: string;
  icon?: string | null;
  category?: string | null;
  isActive: boolean;
  createdAt?: Date;
  updatedAt?: Date;
}

export interface InterestCreationAttributes
  extends Optional<InterestAttributes, 'id' | 'icon' | 'category' | 'isActive'> {}

export class Interest extends Model<InterestAttributes, InterestCreationAttributes>
  implements InterestAttributes {
  declare public id: string;
  declare public name: string;
  declare public icon: string | null;
  declare public category: string | null;
  declare public isActive: boolean;

  declare public readonly createdAt: Date;
  declare public readonly updatedAt: Date;
}

Interest.init(
  {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
    },
    name: {
      type: DataTypes.STRING(100),
      allowNull: false,
      unique: true,
    },
    icon: {
      type: DataTypes.STRING(50),
      allowNull: true,
    },
    category: {
      type: DataTypes.STRING(50),
      allowNull: true,
      defaultValue: 'General',
    },
    isActive: {
      type: DataTypes.BOOLEAN,
      defaultValue: true,
      allowNull: false,
    },
  },
  {
    sequelize,
    tableName: 'interests',
    timestamps: true,
  }
);
