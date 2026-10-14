'use strict';

module.exports = {
  up: async (queryInterface, Sequelize) => {
    const tableInfo = await queryInterface.describeTable('subscription_plans');
    if (!tableInfo.discount) {
      await queryInterface.addColumn('subscription_plans', 'discount', {
        type: Sequelize.STRING(50),
        allowNull: true,
        defaultValue: null,
      });
    }
    if (!tableInfo.is_popular_plan) {
      await queryInterface.addColumn('subscription_plans', 'is_popular_plan', {
        type: Sequelize.BOOLEAN,
        allowNull: false,
        defaultValue: false,
      });
    }
  },

  down: async (queryInterface, Sequelize) => {
    const tableInfo = await queryInterface.describeTable('subscription_plans');
    if (tableInfo.discount) {
      await queryInterface.removeColumn('subscription_plans', 'discount');
    }
    if (tableInfo.is_popular_plan) {
      await queryInterface.removeColumn('subscription_plans', 'is_popular_plan');
    }
  },
};
