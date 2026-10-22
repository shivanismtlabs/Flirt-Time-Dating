'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    const tableNames = await queryInterface.showAllTables();
    const tableName = tableNames.find(
      (t) => (typeof t === 'string' ? t : t.tableName).toLowerCase() === 'conversation_pins'
    );

    if (!tableName) {
      await queryInterface.createTable('conversation_pins', {
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
        await queryInterface.addIndex('conversation_pins', ['userId', 'conversationId'], {
          unique: true,
          name: 'unique_user_conversation_pin',
        });
      } catch (_) {}

      try {
        await queryInterface.addIndex('conversation_pins', ['conversationId'], {
          name: 'idx_conversation_pins_conversation_id',
        });
      } catch (_) {}
    }
  },

  async down(queryInterface) {
    await queryInterface.dropTable('conversation_pins');
  },
};
