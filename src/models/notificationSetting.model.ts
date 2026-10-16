import { Model, DataTypes, Optional } from 'sequelize';
import { sequelize } from '../config/database';

export interface NotificationSettingAttributes {
  id: string;
  userId: string;
  newMessages: boolean;
  newMatches: boolean;
  likeComments: boolean;
  profileVisits: boolean;
  datingTips: boolean;
  pushNotifications: boolean;
  createdAt?: Date;
  updatedAt?: Date;
}

export interface NotificationSettingCreationAttributes
  extends Optional<
    NotificationSettingAttributes,
    | 'id'
    | 'newMessages'
    | 'newMatches'
    | 'likeComments'
    | 'profileVisits'
    | 'datingTips'
    | 'pushNotifications'
    | 'createdAt'
    | 'updatedAt'
  > {}

export class NotificationSetting
  extends Model<NotificationSettingAttributes, NotificationSettingCreationAttributes>
  implements NotificationSettingAttributes
{
  declare public id: string;
  declare public userId: string;
  declare public newMessages: boolean;
  declare public newMatches: boolean;
  declare public likeComments: boolean;
  declare public profileVisits: boolean;
  declare public datingTips: boolean;
  declare public pushNotifications: boolean;

  declare public readonly createdAt: Date;
  declare public readonly updatedAt: Date;

  declare public user?: any;

  /**
   * Formats settings for API consumers with canonical and frontend-compatible keys
   */
  public toResponseJSON(): Record<string, boolean> {
    return {
      new_messages: this.newMessages,
      new_matches: this.newMatches,
      like_comments: this.likeComments,
      profile_visits: this.profileVisits,
      dating_tips: this.datingTips,
      push_notifications: this.pushNotifications,
    };
  }
}

NotificationSetting.init(
  {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
    },
    userId: {
      type: DataTypes.UUID,
      allowNull: false,
      unique: true,
      references: {
        model: 'users',
        key: 'id',
      },
      onDelete: 'CASCADE',
    },
    newMessages: {
      type: DataTypes.BOOLEAN,
      defaultValue: true,
      allowNull: false,
      field: 'new_messages',
    },
    newMatches: {
      type: DataTypes.BOOLEAN,
      defaultValue: true,
      allowNull: false,
      field: 'new_matches',
    },
    likeComments: {
      type: DataTypes.BOOLEAN,
      defaultValue: true,
      allowNull: false,
      field: 'like_comments',
    },
    profileVisits: {
      type: DataTypes.BOOLEAN,
      defaultValue: true,
      allowNull: false,
      field: 'profile_visits',
    },
    datingTips: {
      type: DataTypes.BOOLEAN,
      defaultValue: false,
      allowNull: false,
      field: 'dating_tips',
    },
    pushNotifications: {
      type: DataTypes.BOOLEAN,
      defaultValue: true,
      allowNull: false,
      field: 'push_notifications',
    },
  },
  {
    sequelize,
    tableName: 'notification_settings',
    timestamps: true,
    indexes: [
      {
        unique: true,
        fields: ['userId'],
      },
    ],
  }
);
