'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    // 1. Add nullable conversationId column linking to conversations table
    await queryInterface.addColumn('user_reports', 'conversationId', {
      type: Sequelize.UUID,
      allowNull: true,
      references: {
        model: 'conversations',
        key: 'id',
      },
      onUpdate: 'CASCADE',
      onDelete: 'SET NULL',
    });

    // 2. Add indexing for query and lookup performance
    await queryInterface.addIndex('user_reports', ['conversationId'], {
      name: 'idx_user_reports_conversation_id',
    });

    await queryInterface.addIndex('user_reports', ['reporterId', 'conversationId'], {
      name: 'idx_user_reports_reporter_conversation',
    });
  },

  async down(queryInterface, Sequelize) {
    await queryInterface.removeIndex('user_reports', 'idx_user_reports_reporter_conversation');
    await queryInterface.removeIndex('user_reports', 'idx_user_reports_conversation_id');
    await queryInterface.removeColumn('user_reports', 'conversationId');
  },
};
