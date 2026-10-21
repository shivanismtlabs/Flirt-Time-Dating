'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    const tableNames = await queryInterface.showAllTables();
    const tableName = tableNames.find(
      (t) => (typeof t === 'string' ? t : t.tableName).toLowerCase() === 'chat_message_pins'
    );

    if (!tableName) {
      await queryInterface.createTable('chat_message_pins', {
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
        pinnedBy: {
          type: Sequelize.UUID,
          allowNull: false,
          references: {
            model: 'users',
            key: 'id',
          },
          onDelete: 'CASCADE',
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

      try {
        await queryInterface.addIndex('chat_message_pins', ['userId', 'conversationId', 'messageId'], {
          unique: true,
          name: 'unique_user_conv_message_pin',
        });
      } catch (_) {}

      try {
        await queryInterface.addIndex('chat_message_pins', ['conversationId'], {
          name: 'idx_chat_message_pins_conversation_id',
        });
      } catch (_) {}

      try {
        await queryInterface.addIndex('chat_message_pins', ['messageId'], {
          name: 'idx_chat_message_pins_message_id',
        });
      } catch (_) {}

      try {
        await queryInterface.addIndex('chat_message_pins', ['userId'], {
          name: 'idx_chat_message_pins_user_id',
        });
      } catch (_) {}
    }
  },

  async down(queryInterface) {
    await queryInterface.dropTable('chat_message_pins');
  },
};
