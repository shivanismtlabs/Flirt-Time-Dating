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
  coverPicture?: string | null;
  lookingFor?: string | null;
  genderPreference?: string | null;
  religion?: string | null;
  drinking?: string | null;
  education?: string | null;
  height?: string | null;
  sexuality?: string | null;
  smoking?: string | null;
  weight?: string | null;
  eyeColor?: string | null;
  hairColor?: string | null;
  living?: string | null;
  relationship?: string | null;
  children?: string | null;
  city?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  voicePromptUrl?: string | null;
  voicePromptDuration?: number | null;
  coins?: number;
  isSubscribed?: boolean;
  subscriptionExpiresAt?: Date | null;
  activeSubscriptionPlanId?: number | null;
  lastActiveAt?: Date | null;
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
    | 'coverPicture'
    | 'lookingFor'
    | 'genderPreference'
    | 'religion'
    | 'drinking'
    | 'education'
    | 'height'
    | 'sexuality'
    | 'smoking'
    | 'weight'
    | 'eyeColor'
    | 'hairColor'
    | 'living'
    | 'relationship'
    | 'children'
    | 'city'
    | 'latitude'
    | 'longitude'
    | 'voicePromptUrl'
    | 'voicePromptDuration'
    | 'coins'
    | 'isSubscribed'
    | 'subscriptionExpiresAt'
    | 'activeSubscriptionPlanId'
    | 'lastActiveAt'
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
  declare public coverPicture: string | null;
  declare public lookingFor: string | null;
  declare public genderPreference: string | null;
  declare public religion: string | null;
  declare public drinking: string | null;
  declare public education: string | null;
  declare public height: string | null;
  declare public sexuality: string | null;
  declare public smoking: string | null;
  declare public weight: string | null;
  declare public eyeColor: string | null;
  declare public hairColor: string | null;
  declare public living: string | null;
  declare public relationship: string | null;
  declare public children: string | null;
  declare public city: string | null;
  declare public latitude: number | null;
  declare public longitude: number | null;
  declare public voicePromptUrl: string | null;
  declare public voicePromptDuration: number | null;
  declare public coins: number;
  declare public isSubscribed: boolean;
  declare public subscriptionExpiresAt: Date | null;
  declare public activeSubscriptionPlanId: number | null;
  declare public lastActiveAt: Date | null;

  declare public readonly createdAt: Date;
  declare public readonly updatedAt: Date;

  declare public identities?: any[];
  declare public interests?: any[];
  declare public photos?: any[];
  declare public discoveryPreference?: any;

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
    coverPicture: {
      type: DataTypes.STRING(500),
      allowNull: true,
    },
    lookingFor: {
      type: DataTypes.STRING(50),
      allowNull: true,
    },
    genderPreference: {
      type: DataTypes.STRING(50),
      allowNull: true,
    },
    religion: {
      type: DataTypes.STRING(50),
      allowNull: true,
    },
    drinking: {
      type: DataTypes.STRING(50),
      allowNull: true,
    },
    education: {
      type: DataTypes.STRING(100),
      allowNull: true,
    },
    height: {
      type: DataTypes.STRING(50),
      allowNull: true,
    },
    sexuality: {
      type: DataTypes.STRING(50),
      allowNull: true,
    },
    smoking: {
      type: DataTypes.STRING(50),
      allowNull: true,
    },
    weight: {
      type: DataTypes.STRING(50),
      allowNull: true,
    },
    eyeColor: {
      type: DataTypes.STRING(50),
      allowNull: true,
    },
    hairColor: {
      type: DataTypes.STRING(50),
      allowNull: true,
    },
    living: {
      type: DataTypes.STRING(100),
      allowNull: true,
    },
    relationship: {
      type: DataTypes.STRING(50),
      allowNull: true,
    },
    children: {
      type: DataTypes.STRING(100),
      allowNull: true,
    },
    city: {
      type: DataTypes.STRING(100),
      allowNull: true,
      defaultValue: 'Mumbai',
    },
    latitude: {
      type: DataTypes.FLOAT,
      allowNull: true,
    },
    longitude: {
      type: DataTypes.FLOAT,
      allowNull: true,
    },
    voicePromptUrl: {
      type: DataTypes.STRING(500),
      allowNull: true,
    },
    voicePromptDuration: {
      type: DataTypes.INTEGER,
      allowNull: true,
    },
    coins: {
      type: DataTypes.INTEGER,
      defaultValue: 500,
      allowNull: false,
    },
    isSubscribed: {
      type: DataTypes.BOOLEAN,
      defaultValue: false,
      allowNull: false,
      field: 'is_subscribed',
    },
    subscriptionExpiresAt: {
      type: DataTypes.DATE,
      allowNull: true,
      field: 'subscription_expires_at',
    },
    activeSubscriptionPlanId: {
      type: DataTypes.INTEGER,
      allowNull: true,
      field: 'active_subscription_plan_id',
    },
    lastActiveAt: {
      type: DataTypes.DATE,
      allowNull: true,
    },
  },
  {
    sequelize,
    tableName: 'users',
    timestamps: true,
  }
);
