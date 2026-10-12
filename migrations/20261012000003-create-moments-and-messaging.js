'use strict';

module.exports = {
  up: async (queryInterface, Sequelize) => {
    // 1. Create moments table
    await queryInterface.createTable('moments', {
      id: {
        type: Sequelize.UUID,
        defaultValue: Sequelize.UUIDV4,
        primaryKey: true,
      },
      userId: {
        type: Sequelize.UUID,
        allowNull: false,
        references: {
          model: 'users',
          key: 'id',
        },
        onDelete: 'CASCADE',
        onUpdate: 'CASCADE',
      },
      caption: {
        type: Sequelize.STRING(500),
        allowNull: true,
      },
      audience: {
        type: Sequelize.STRING(50),
        defaultValue: 'everyone',
        allowNull: false,
      },
      status: {
        type: Sequelize.STRING(20),
        defaultValue: 'active',
        allowNull: false,
      },
      publishedAt: {
        allowNull: false,
        type: Sequelize.DATE,
        defaultValue: Sequelize.fn('NOW'),
      },
      expiresAt: {
        allowNull: true,
        type: Sequelize.DATE,
      },
      locationLabel: {
        type: Sequelize.STRING(100),
        allowNull: true,
      },
      createdAt: {
        allowNull: false,
        type: Sequelize.DATE,
        defaultValue: Sequelize.fn('NOW'),
      },
      updatedAt: {
        allowNull: false,
        type: Sequelize.DATE,
        defaultValue: Sequelize.fn('NOW'),
      },
    });

    await queryInterface.addIndex('moments', ['userId'], {
      name: 'idx_moments_user_id',
    });
    await queryInterface.addIndex('moments', ['expiresAt'], {
      name: 'idx_moments_expires_at',
    });
    await queryInterface.addIndex('moments', ['status', 'expiresAt'], {
      name: 'idx_moments_status_expires',
    });

    // 2. Create moment_media table
    await queryInterface.createTable('moment_media', {
      id: {
        type: Sequelize.UUID,
        defaultValue: Sequelize.UUIDV4,
        primaryKey: true,
      },
      momentId: {
        type: Sequelize.UUID,
        allowNull: false,
        references: {
          model: 'moments',
          key: 'id',
        },
        onDelete: 'CASCADE',
        onUpdate: 'CASCADE',
      },
      mediaUrl: {
        type: Sequelize.STRING(500),
        allowNull: false,
      },
      mediaType: {
        type: Sequelize.STRING(20),
        defaultValue: 'image',
        allowNull: false,
      },
      displayOrder: {
        type: Sequelize.INTEGER,
        defaultValue: 0,
        allowNull: false,
      },
      createdAt: {
        allowNull: false,
        type: Sequelize.DATE,
        defaultValue: Sequelize.fn('NOW'),
      },
      updatedAt: {
        allowNull: false,
        type: Sequelize.DATE,
        defaultValue: Sequelize.fn('NOW'),
      },
    });

    await queryInterface.addIndex('moment_media', ['momentId', 'displayOrder'], {
      name: 'idx_moment_media_order',
    });

    // 3. Create moment_reactions table
    await queryInterface.createTable('moment_reactions', {
      id: {
        type: Sequelize.UUID,
        defaultValue: Sequelize.UUIDV4,
        primaryKey: true,
      },
      momentId: {
        type: Sequelize.UUID,
        allowNull: false,
        references: {
          model: 'moments',
          key: 'id',
        },
        onDelete: 'CASCADE',
        onUpdate: 'CASCADE',
      },
      userId: {
        type: Sequelize.UUID,
        allowNull: false,
        references: {
          model: 'users',
          key: 'id',
        },
        onDelete: 'CASCADE',
        onUpdate: 'CASCADE',
      },
      reaction: {
        type: Sequelize.STRING(50),
        allowNull: false,
      },
      createdAt: {
        allowNull: false,
        type: Sequelize.DATE,
        defaultValue: Sequelize.fn('NOW'),
      },
      updatedAt: {
        allowNull: false,
        type: Sequelize.DATE,
        defaultValue: Sequelize.fn('NOW'),
      },
    });

    await queryInterface.addIndex('moment_reactions', ['momentId', 'userId'], {
      unique: true,
      name: 'unique_moment_user_reaction',
    });
    await queryInterface.addIndex('moment_reactions', ['momentId', 'reaction'], {
      name: 'idx_moment_reaction_type',
    });

    // 4. Create conversations table
    await queryInterface.createTable('conversations', {
      id: {
        type: Sequelize.UUID,
        defaultValue: Sequelize.UUIDV4,
        primaryKey: true,
      },
      user1Id: {
        type: Sequelize.UUID,
        allowNull: false,
        references: {
          model: 'users',
          key: 'id',
        },
        onDelete: 'CASCADE',
        onUpdate: 'CASCADE',
      },
      user2Id: {
        type: Sequelize.UUID,
        allowNull: false,
        references: {
          model: 'users',
          key: 'id',
        },
        onDelete: 'CASCADE',
        onUpdate: 'CASCADE',
      },
      lastMessage: {
        type: Sequelize.TEXT,
        allowNull: true,
      },
      lastMessageAt: {
        type: Sequelize.DATE,
        allowNull: true,
      },
      createdAt: {
        allowNull: false,
        type: Sequelize.DATE,
        defaultValue: Sequelize.fn('NOW'),
      },
      updatedAt: {
        allowNull: false,
        type: Sequelize.DATE,
        defaultValue: Sequelize.fn('NOW'),
      },
    });

    await queryInterface.addIndex('conversations', ['user1Id', 'user2Id'], {
      unique: true,
      name: 'unique_user1_user2_conversation',
    });

    // 5. Create chat_messages table
    await queryInterface.createTable('chat_messages', {
      id: {
        type: Sequelize.UUID,
        defaultValue: Sequelize.UUIDV4,
        primaryKey: true,
      },
      conversationId: {
        type: Sequelize.UUID,
        allowNull: false,
        references: {
          model: 'conversations',
          key: 'id',
        },
        onDelete: 'CASCADE',
        onUpdate: 'CASCADE',
      },
      senderId: {
        type: Sequelize.UUID,
        allowNull: false,
        references: {
          model: 'users',
          key: 'id',
        },
        onDelete: 'CASCADE',
        onUpdate: 'CASCADE',
      },
      recipientId: {
        type: Sequelize.UUID,
        allowNull: false,
        references: {
          model: 'users',
          key: 'id',
        },
        onDelete: 'CASCADE',
        onUpdate: 'CASCADE',
      },
      content: {
        type: Sequelize.TEXT,
        allowNull: false,
      },
      messageType: {
        type: Sequelize.STRING(20),
        defaultValue: 'text',
        allowNull: false,
      },
      metadata: {
        type: Sequelize.TEXT,
        allowNull: true,
      },
      isRead: {
        type: Sequelize.BOOLEAN,
        defaultValue: false,
        allowNull: false,
      },
      createdAt: {
        allowNull: false,
        type: Sequelize.DATE,
        defaultValue: Sequelize.fn('NOW'),
      },
      updatedAt: {
        allowNull: false,
        type: Sequelize.DATE,
        defaultValue: Sequelize.fn('NOW'),
      },
    });

    await queryInterface.addIndex('chat_messages', ['conversationId'], {
      name: 'idx_chat_messages_conversation',
    });
    await queryInterface.addIndex('chat_messages', ['recipientId', 'isRead'], {
      name: 'idx_chat_messages_recipient_read',
    });
  },

  down: async (queryInterface, Sequelize) => {
    await queryInterface.dropTable('chat_messages');
    await queryInterface.dropTable('conversations');
    await queryInterface.dropTable('moment_reactions');
    await queryInterface.dropTable('moment_media');
    await queryInterface.dropTable('moments');
  },
};
