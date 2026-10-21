'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    // 1. Create conversation_user_states table for per-user archive & delete tracking
    await queryInterface.createTable('conversation_user_states', {
      id: {
        type: Sequelize.UUID,
        defaultValue: Sequelize.UUIDV4,
        primaryKey: true,
        allowNull: false,
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
      isArchived: {
        type: Sequelize.BOOLEAN,
        allowNull: false,
        defaultValue: false,
      },
      archivedAt: {
        type: Sequelize.DATE,
        allowNull: true,
      },
      isDeleted: {
        type: Sequelize.BOOLEAN,
        allowNull: false,
        defaultValue: false,
      },
      deletedAt: {
        type: Sequelize.DATE,
        allowNull: true,
      },
      clearedAt: {
        type: Sequelize.DATE,
        allowNull: true,
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

    await queryInterface.addIndex('conversation_user_states', ['conversationId', 'userId'], {
      unique: true,
      name: 'unique_conversation_user_state',
    });
    await queryInterface.addIndex('conversation_user_states', ['userId', 'isArchived'], {
      name: 'idx_conv_user_states_user_archived',
    });
    await queryInterface.addIndex('conversation_user_states', ['userId', 'isDeleted'], {
      name: 'idx_conv_user_states_user_deleted',
    });

    // 2. Add global deletion columns to conversations table
    await queryInterface.addColumn('conversations', 'isDeletedForEveryone', {
      type: Sequelize.BOOLEAN,
      allowNull: false,
      defaultValue: false,
    });

    await queryInterface.addColumn('conversations', 'deletedForEveryoneAt', {
      type: Sequelize.DATE,
      allowNull: true,
    });

    await queryInterface.addColumn('conversations', 'deletedForEveryoneBy', {
      type: Sequelize.UUID,
      allowNull: true,
      references: {
        model: 'users',
        key: 'id',
      },
      onDelete: 'SET NULL',
      onUpdate: 'CASCADE',
    });
  },

  async down(queryInterface) {
    await queryInterface.removeColumn('conversations', 'deletedForEveryoneBy');
    await queryInterface.removeColumn('conversations', 'deletedForEveryoneAt');
    await queryInterface.removeColumn('conversations', 'isDeletedForEveryone');
    await queryInterface.dropTable('conversation_user_states');
  },
};
