'use strict';

module.exports = {
  up: async (queryInterface, Sequelize) => {
    const tableInfo = await queryInterface.describeTable('users');
    if (tableInfo.coins) {
      try {
        await queryInterface.changeColumn('users', 'coins', {
          type: Sequelize.INTEGER,
          defaultValue: 0,
          allowNull: false,
        });
      } catch (_err) {
        // Fallback for database engines supporting direct alter column
        try {
          await queryInterface.sequelize.query(
            'ALTER TABLE "users" ALTER COLUMN "coins" SET DEFAULT 0;'
          );
        } catch (_e) {}
      }
    } else {
      await queryInterface.addColumn('users', 'coins', {
        type: Sequelize.INTEGER,
        defaultValue: 0,
        allowNull: false,
      });
    }
  },

  down: async (queryInterface, Sequelize) => {
    const tableInfo = await queryInterface.describeTable('users');
    if (tableInfo.coins) {
      try {
        await queryInterface.changeColumn('users', 'coins', {
          type: Sequelize.INTEGER,
          defaultValue: 500,
          allowNull: false,
        });
      } catch (_err) {
        try {
          await queryInterface.sequelize.query(
            'ALTER TABLE "users" ALTER COLUMN "coins" SET DEFAULT 500;'
          );
        } catch (_e) {}
      }
    }
  },
};
