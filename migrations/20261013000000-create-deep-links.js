'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('deep_links', {
      id: {
        type: Sequelize.UUID,
        defaultValue: Sequelize.UUIDV4,
        primaryKey: true,
        allowNull: false,
      },
      code: {
        type: Sequelize.STRING(32),
        allowNull: false,
        unique: true,
      },
      contentType: {
        type: Sequelize.STRING(30),
        allowNull: false,
      },
      contentId: {
        type: Sequelize.UUID,
        allowNull: false,
      },
      creatorId: {
        type: Sequelize.UUID,
        allowNull: false,
        references: {
          model: 'users',
          key: 'id',
        },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE',
      },
      status: {
        type: Sequelize.STRING(20),
        defaultValue: 'active',
        allowNull: false,
      },
      expiresAt: {
        type: Sequelize.DATE,
        allowNull: true,
        defaultValue: null,
      },
      clicksCount: {
        type: Sequelize.INTEGER,
        defaultValue: 0,
        allowNull: false,
      },
      lastAccessedAt: {
        type: Sequelize.DATE,
        allowNull: true,
        defaultValue: null,
      },
      metadata: {
        type: Sequelize.JSON,
        allowNull: true,
        defaultValue: null,
      },
      createdAt: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.literal('CURRENT_TIMESTAMP'),
      },
      updatedAt: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.literal('CURRENT_TIMESTAMP'),
      },
    });

    // Create indexes
    await queryInterface.addIndex('deep_links', ['code'], {
      unique: true,
      name: 'idx_deep_links_code',
    });

    await queryInterface.addIndex('deep_links', ['contentType', 'contentId', 'creatorId'], {
      name: 'idx_deep_links_content_creator',
    });

    await queryInterface.addIndex('deep_links', ['status', 'expiresAt'], {
      name: 'idx_deep_links_status_expires',
    });

    await queryInterface.addIndex('deep_links', ['creatorId'], {
      name: 'idx_deep_links_creator_id',
    });
  },

  async down(queryInterface) {
    await queryInterface.dropTable('deep_links');
  },
};
