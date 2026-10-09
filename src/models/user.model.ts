import { Model, DataTypes, Optional } from 'sequelize';
import { sequelize } from '../config/database';

export interface UserAttributes {
  id: string;
  username: string;
  email?: string | null;
  phone?: string | null;
  isPhoneVerified?: boolean;
  password?: string | null;
  role: 'user' | 'admin';
  isActive: boolean;
  fullName?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  nickName?: string | null;
  dateOfBirth?: string | null;
  gender?: string | null;
  about?: string | null;
  isProfileComplete?: boolean;
  isFaceVerified?: boolean;
  faceVerifiedAt?: Date | null;
  profilePicture?: string | null;
  createdAt?: Date;
  updatedAt?: Date;
}

export interface UserCreationAttributes
  extends Optional<
    UserAttributes,
    | 'id'
    | 'role'
    | 'isActive'
    | 'email'
    | 'phone'
    | 'isPhoneVerified'
    | 'password'
    | 'username'
    | 'fullName'
    | 'firstName'
    | 'lastName'
    | 'nickName'
    | 'dateOfBirth'
    | 'gender'
    | 'about'
    | 'isProfileComplete'
    | 'isFaceVerified'
    | 'faceVerifiedAt'
    | 'profilePicture'
  > {}

export class User extends Model<UserAttributes, UserCreationAttributes> implements UserAttributes {
  declare public id: string;
  declare public username: string;
  declare public email: string | null;
  declare public phone: string | null;
  declare public isPhoneVerified: boolean;
  declare public password: string | null;
  declare public role: 'user' | 'admin';
  declare public isActive: boolean;

  declare public fullName: string | null;
  declare public firstName: string | null;
  declare public lastName: string | null;
  declare public nickName: string | null;
  declare public dateOfBirth: string | null;
  declare public gender: string | null;
  declare public about: string | null;
  declare public isProfileComplete: boolean;
  declare public isFaceVerified: boolean;
  declare public faceVerifiedAt: Date | null;
  declare public profilePicture: string | null;


  declare public readonly createdAt: Date;
  declare public readonly updatedAt: Date;

  declare public identities?: any[];

  // Omit sensitive data when converting to JSON
  public toJSON(): Omit<UserAttributes, 'password'> {
    const values = { ...this.get() };
    delete values.password;
    return values;
  }
}

User.init(
  {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
    },
    username: {
      type: DataTypes.STRING(50),
      allowNull: false,
      unique: true,
      defaultValue: DataTypes.UUIDV4,
      validate: {
        len: [3, 50],
      },
    },
    email: {
      type: DataTypes.STRING(100),
      allowNull: true,
      unique: true,
      validate: {
        isEmail: true,
      },
    },
    phone: {
      type: DataTypes.STRING(20),
      allowNull: true,
      unique: true,
    },
    isPhoneVerified: {
      type: DataTypes.BOOLEAN,
      defaultValue: false,
      allowNull: false,
    },
    password: {
      type: DataTypes.STRING,
      allowNull: true,
    },
    role: {
      type: DataTypes.ENUM('user', 'admin'),
      defaultValue: 'user',
      allowNull: false,
    },
    isActive: {
      type: DataTypes.BOOLEAN,
      defaultValue: true,
      allowNull: false,
    },
    fullName: {
      type: DataTypes.STRING(100),
      allowNull: true,
    },
    firstName: {
      type: DataTypes.STRING(50),
      allowNull: true,
    },

    lastName: {
      type: DataTypes.STRING(50),
      allowNull: true,
    },
    nickName: {
      type: DataTypes.STRING(50),
      allowNull: true,
    },
    dateOfBirth: {
      type: DataTypes.DATEONLY,
      allowNull: true,
    },
    gender: {
      type: DataTypes.STRING(20),
      allowNull: true,
    },
    about: {
      type: DataTypes.STRING(500),
      allowNull: true,
    },
    isProfileComplete: {
      type: DataTypes.BOOLEAN,
      defaultValue: false,
      allowNull: false,
    },
    isFaceVerified: {
      type: DataTypes.BOOLEAN,
      defaultValue: false,
      allowNull: false,
    },
    faceVerifiedAt: {
      type: DataTypes.DATE,
      allowNull: true,
    },
    profilePicture: {
      type: DataTypes.STRING(500),
      allowNull: true,
    },
  },
  {
    sequelize,
    tableName: 'users',
    timestamps: true,
  }
);
