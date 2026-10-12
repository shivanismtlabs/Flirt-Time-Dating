'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    try {
      await queryInterface.addIndex('user_interests', ['interestId'], {
        name: 'user_interests_interest_id_idx',
      });
    } catch (err) {
      // Index may already exist in some environments
      console.warn('Note: user_interests_interest_id_idx creation warning:', err.message);
    }
  },

  async down(queryInterface, Sequelize) {
    try {
      await queryInterface.removeIndex('user_interests', 'user_interests_interest_id_idx');
    } catch (err) {
      console.warn('Note: user_interests_interest_id_idx removal warning:', err.message);
    }
  },
};
