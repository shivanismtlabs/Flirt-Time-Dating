'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('video_calls', {
      id: {
        type: Sequelize.UUID,
        defaultValue: Sequelize.UUIDV4,
        primaryKey: true,
        allowNull: false,
      },
      callerId: {
        type: Sequelize.UUID,
        allowNull: false,
        references: {
          model: 'users',
          key: 'id',
        },
        onDelete: 'CASCADE',
        onUpdate: 'CASCADE',
      },
      calleeId: {
        type: Sequelize.UUID,
        allowNull: false,
        references: {
          model: 'users',
          key: 'id',
        },
        onDelete: 'CASCADE',
        onUpdate: 'CASCADE',
      },
      conversationId: {
        type: Sequelize.UUID,
        allowNull: true,
        references: {
          model: 'conversations',
          key: 'id',
        },
        onDelete: 'SET NULL',
        onUpdate: 'CASCADE',
      },
      channelName: {
        type: Sequelize.STRING(100),
        allowNull: false,
        unique: true,
      },
      callerUid: {
        type: Sequelize.INTEGER,
        allowNull: false,
      },
      calleeUid: {
        type: Sequelize.INTEGER,
        allowNull: false,
      },
      status: {
        type: Sequelize.STRING(30),
        allowNull: false,
        defaultValue: 'ringing',
      },
      startedAt: {
        type: Sequelize.DATE,
        allowNull: true,
      },
      acceptedAt: {
        type: Sequelize.DATE,
        allowNull: true,
      },
      endedAt: {
        type: Sequelize.DATE,
        allowNull: true,
      },
      expiresAt: {
        type: Sequelize.DATE,
        allowNull: false,
      },
      endedBy: {
        type: Sequelize.UUID,
        allowNull: true,
        references: {
          model: 'users',
          key: 'id',
        },
        onDelete: 'SET NULL',
        onUpdate: 'CASCADE',
      },
      createdAt: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.fn('NOW'),
      },
      updatedAt: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.fn('NOW'),
      },
    });

    await queryInterface.addIndex('video_calls', ['callerId'], {
      name: 'idx_video_calls_caller_id',
    });
    await queryInterface.addIndex('video_calls', ['calleeId'], {
      name: 'idx_video_calls_callee_id',
    });
    await queryInterface.addIndex('video_calls', ['status', 'expiresAt'], {
      name: 'idx_video_calls_status_expires',
    });
    await queryInterface.addIndex('video_calls', ['channelName'], {
      unique: true,
      name: 'idx_video_calls_channel_name',
    });
    await queryInterface.addIndex('video_calls', ['conversationId'], {
      name: 'idx_video_calls_conversation_id',
    });
  },

  async down(queryInterface) {
    await queryInterface.dropTable('video_calls');
  },
};
