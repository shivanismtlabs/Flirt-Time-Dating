'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    try {
      await queryInterface.addColumn('video_calls', 'callType', {
        type: Sequelize.STRING(20),
        allowNull: false,
        defaultValue: 'video',
      });
    } catch (_err) {
      // Column may already exist in synchronized environments
    }
  },

  async down(queryInterface) {
    try {
      await queryInterface.removeColumn('video_calls', 'callType');
    } catch (_err) {
      // Ignore if column doesn't exist
    }
  },
};
