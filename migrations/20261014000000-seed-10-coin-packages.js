'use strict';

module.exports = {
  up: async (queryInterface, Sequelize) => {
    try {
      // Lazy load compiled service if running in JS migration context
      const { seedCoinPackages } = require('../dist/services/seedCoinPackage.service');
      await seedCoinPackages(true);
    } catch (err) {
      console.warn('Migration seed note: seedCoinPackage.service executed or deferred to app startup:', err.message);
    }
  },

  down: async (queryInterface, Sequelize) => {
    // Keep coin packages on rollback
  },
};
