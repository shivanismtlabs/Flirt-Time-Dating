'use strict';

module.exports = {
  up: async (queryInterface, Sequelize) => {
    try {
      // Lazy load compiled service if running in JS migration context
      const { seed50DiscoveryUsers } = require('../dist/services/seedDiscovery.service');
      await seed50DiscoveryUsers();
    } catch (err) {
      console.warn('Migration seed note: seedDiscovery.service executed or deferred to app startup:', err.message);
    }
  },

  down: async (queryInterface, Sequelize) => {
    // Keep dummy users on rollback or delete if needed
  },
};
