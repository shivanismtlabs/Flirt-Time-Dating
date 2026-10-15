'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    // Add reason column
    await queryInterface.addColumn('connection_requests', 'reason', {
      type: Sequelize.STRING(150),
      allowNull: true,
    });

    // Add momentId column
    await queryInterface.addColumn('connection_requests', 'momentId', {
      type: Sequelize.UUID,
      allowNull: true,
      references: {
        model: 'moments',
        key: 'id',
      },
      onUpdate: 'CASCADE',
      onDelete: 'SET NULL',
    });
  },

  async down(queryInterface) {
    await queryInterface.removeColumn('connection_requests', 'momentId');
    await queryInterface.removeColumn('connection_requests', 'reason');
  },
};
