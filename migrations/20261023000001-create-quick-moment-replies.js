'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('quick_moment_replies', {
      id: {
        type: Sequelize.UUID,
        defaultValue: Sequelize.UUIDV4,
        primaryKey: true,
        allowNull: false,
      },
      quickMomentId: {
        type: Sequelize.UUID,
        allowNull: false,
        references: {
          model: 'quick_moments',
          key: 'id',
        },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE',
      },
      userId: {
        type: Sequelize.UUID,
        allowNull: false,
        references: {
          model: 'users',
          key: 'id',
        },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE',
      },
      message: {
        type: Sequelize.TEXT,
        allowNull: false,
      },
      notificationId: {
        type: Sequelize.UUID,
        allowNull: true,
      },
      createdAt: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.NOW,
      },
      updatedAt: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.NOW,
      },
    });

    await queryInterface.addIndex('quick_moment_replies', ['quickMomentId'], {
      name: 'idx_qm_replies_moment_id',
    });
    await queryInterface.addIndex('quick_moment_replies', ['userId'], {
      name: 'idx_qm_replies_user_id',
    });
    await queryInterface.addIndex('quick_moment_replies', ['notificationId'], {
      unique: true,
      name: 'idx_qm_replies_notification_id_unique',
    });
  },

  async down(queryInterface) {
    await queryInterface.dropTable('quick_moment_replies');
  },
};
