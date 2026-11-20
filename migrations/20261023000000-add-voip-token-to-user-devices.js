'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    try {
      await queryInterface.addColumn('user_devices', 'voipToken', {
        type: Sequelize.TEXT,
        allowNull: true,
      });
    } catch (_err) {
      // Column may already exist in synchronized environments
    }

    try {
      await queryInterface.addIndex('user_devices', ['voipToken'], {
        name: 'user_devices_voip_token',
      });
    } catch (_err) {
      // Index may already exist
    }
  },

  async down(queryInterface) {
    try {
      await queryInterface.removeIndex('user_devices', 'user_devices_voip_token');
    } catch (_err) {
      // Ignore if index doesn't exist
    }
    try {
      await queryInterface.removeColumn('user_devices', 'voipToken');
    } catch (_err) {
      // Ignore if column doesn't exist
    }
  },
};
