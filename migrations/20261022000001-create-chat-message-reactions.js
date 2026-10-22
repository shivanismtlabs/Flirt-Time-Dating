'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    const tableNames = await queryInterface.showAllTables();
    const tableName = tableNames.find(
      (t) => (typeof t === 'string' ? t : t.tableName).toLowerCase() === 'chat_message_reactions'
    );

    if (!tableName) {
      await queryInterface.createTable('chat_message_reactions', {
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
        messageId: {
          type: Sequelize.UUID,
          allowNull: false,
          references: {
            model: 'chat_messages',
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
        emoji: {
          type: Sequelize.STRING(32),
          allowNull: false,
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

      try {
        await queryInterface.addIndex('chat_message_reactions', ['messageId', 'userId'], {
          unique: true,
          name: 'unique_message_user_reaction',
        });
      } catch (_) {}

      try {
        await queryInterface.addIndex('chat_message_reactions', ['conversationId'], {
          name: 'idx_chat_message_reactions_conv_id',
        });
      } catch (_) {}

      try {
        await queryInterface.addIndex('chat_message_reactions', ['messageId'], {
          name: 'idx_chat_message_reactions_message_id',
        });
      } catch (_) {}

      try {
        await queryInterface.addIndex('chat_message_reactions', ['userId'], {
          name: 'idx_chat_message_reactions_user_id',
        });
      } catch (_) {}
    }
  },

  async down(queryInterface) {
    await queryInterface.dropTable('chat_message_reactions');
  },
};
