'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    // 1. Add targetType column (defaults to 'user')
    await queryInterface.addColumn('user_reports', 'targetType', {
      type: Sequelize.STRING(20),
      defaultValue: 'user',
      allowNull: false,
    });

    // 2. Add nullable momentId column linking to moments table
    await queryInterface.addColumn('user_reports', 'momentId', {
      type: Sequelize.UUID,
      allowNull: true,
      references: {
        model: 'moments',
        key: 'id',
      },
      onUpdate: 'CASCADE',
      onDelete: 'CASCADE',
    });

    // 3. Add indexing for performance
    await queryInterface.addIndex('user_reports', ['momentId'], {
      name: 'idx_user_reports_moment_id',
    });

    await queryInterface.addIndex('user_reports', ['reporterId', 'momentId'], {
      name: 'idx_user_reports_reporter_moment',
    });
  },

  async down(queryInterface, Sequelize) {
    await queryInterface.removeIndex('user_reports', 'idx_user_reports_reporter_moment');
    await queryInterface.removeIndex('user_reports', 'idx_user_reports_moment_id');
    await queryInterface.removeColumn('user_reports', 'momentId');
    await queryInterface.removeColumn('user_reports', 'targetType');
  },
};
