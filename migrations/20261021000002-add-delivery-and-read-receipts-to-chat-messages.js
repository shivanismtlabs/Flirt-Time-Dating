'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    const tableInfo = await queryInterface.describeTable('chat_messages');

    // 1. Add isDelivered column
    if (!tableInfo.isDelivered) {
      await queryInterface.addColumn('chat_messages', 'isDelivered', {
        type: Sequelize.BOOLEAN,
        allowNull: false,
        defaultValue: false,
      });
    }

    // 2. Add deliveredAt column
    if (!tableInfo.deliveredAt) {
      await queryInterface.addColumn('chat_messages', 'deliveredAt', {
        type: Sequelize.DATE,
        allowNull: true,
      });
    }

    // 3. Add readAt column
    if (!tableInfo.readAt) {
      await queryInterface.addColumn('chat_messages', 'readAt', {
        type: Sequelize.DATE,
        allowNull: true,
      });
    }

    // 4. Backfill existing read messages: if isRead = true, set isDelivered = true, deliveredAt = createdAt, readAt = createdAt
    try {
      await queryInterface.sequelize.query(`
        UPDATE chat_messages
        SET "isDelivered" = true,
            "deliveredAt" = COALESCE("deliveredAt", "createdAt"),
            "readAt" = COALESCE("readAt", "createdAt")
        WHERE "isRead" = true
      `);
    } catch (_) {
      // Dialect fallback for sqlite in test environment
      try {
        await queryInterface.sequelize.query(`
          UPDATE chat_messages
          SET isDelivered = 1,
              deliveredAt = COALESCE(deliveredAt, createdAt),
              readAt = COALESCE(readAt, createdAt)
          WHERE isRead = 1
        `);
      } catch (_) {}
    }

    // 5. Add indexes for efficient receipt lookups and queries
    try {
      await queryInterface.addIndex('chat_messages', ['recipientId', 'isDelivered'], {
        name: 'idx_chat_messages_recipient_deliv',
      });
    } catch (_) {}

    try {
      await queryInterface.addIndex('chat_messages', ['conversationId', 'recipientId', 'isDelivered'], {
        name: 'idx_chat_messages_conv_recipient_deliv',
      });
    } catch (_) {}

    try {
      await queryInterface.addIndex('chat_messages', ['conversationId', 'recipientId', 'isRead'], {
        name: 'idx_chat_messages_conv_recipient_read',
      });
    } catch (_) {}
  },

  async down(queryInterface, Sequelize) {
    try {
      await queryInterface.removeIndex('chat_messages', 'idx_chat_messages_conv_recipient_read');
    } catch (_) {}

    try {
      await queryInterface.removeIndex('chat_messages', 'idx_chat_messages_conv_recipient_deliv');
    } catch (_) {}

    try {
      await queryInterface.removeIndex('chat_messages', 'idx_chat_messages_recipient_deliv');
    } catch (_) {}

    const tableInfo = await queryInterface.describeTable('chat_messages');

    if (tableInfo.readAt) {
      await queryInterface.removeColumn('chat_messages', 'readAt');
    }
    if (tableInfo.deliveredAt) {
      await queryInterface.removeColumn('chat_messages', 'deliveredAt');
    }
    if (tableInfo.isDelivered) {
      await queryInterface.removeColumn('chat_messages', 'isDelivered');
    }
  },
};
