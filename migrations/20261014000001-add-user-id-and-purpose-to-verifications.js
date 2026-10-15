'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    // 1. email_verifications table
    const emailTable = await queryInterface.describeTable('email_verifications').catch(() => null);
    if (emailTable) {
      if (!emailTable.userId) {
        await queryInterface.addColumn('email_verifications', 'userId', {
          type: Sequelize.UUID,
          allowNull: true,
          references: {
            model: 'users',
            key: 'id',
          },
          onUpdate: 'CASCADE',
          onDelete: 'SET NULL',
        });
        await queryInterface.addIndex('email_verifications', ['userId']).catch(() => {});
      }
      if (!emailTable.purpose) {
        await queryInterface.addColumn('email_verifications', 'purpose', {
          type: Sequelize.STRING(50),
          allowNull: false,
          defaultValue: 'auth',
        });
        await queryInterface.addIndex('email_verifications', ['purpose']).catch(() => {});
      }
    }

    // 2. phone_verifications table
    const phoneTable = await queryInterface.describeTable('phone_verifications').catch(() => null);
    if (phoneTable) {
      if (!phoneTable.userId) {
        await queryInterface.addColumn('phone_verifications', 'userId', {
          type: Sequelize.UUID,
          allowNull: true,
          references: {
            model: 'users',
            key: 'id',
          },
          onUpdate: 'CASCADE',
          onDelete: 'SET NULL',
        });
        await queryInterface.addIndex('phone_verifications', ['userId']).catch(() => {});
      }
      if (!phoneTable.purpose) {
        await queryInterface.addColumn('phone_verifications', 'purpose', {
          type: Sequelize.STRING(50),
          allowNull: false,
          defaultValue: 'auth',
        });
        await queryInterface.addIndex('phone_verifications', ['purpose']).catch(() => {});
      }
    }
  },

  async down(queryInterface) {
    // email_verifications
    await queryInterface.removeColumn('email_verifications', 'userId').catch(() => {});
    await queryInterface.removeColumn('email_verifications', 'purpose').catch(() => {});

    // phone_verifications
    await queryInterface.removeColumn('phone_verifications', 'userId').catch(() => {});
    await queryInterface.removeColumn('phone_verifications', 'purpose').catch(() => {});
  },
};
