'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('users', 'firstName', {
      type: Sequelize.STRING(50),
      allowNull: true,
    });
    await queryInterface.addColumn('users', 'lastName', {
      type: Sequelize.STRING(50),
      allowNull: true,
    });
    await queryInterface.addColumn('users', 'nickName', {
      type: Sequelize.STRING(50),
      allowNull: true,
    });
    await queryInterface.addColumn('users', 'dateOfBirth', {
      type: Sequelize.DATEONLY,
      allowNull: true,
    });
    await queryInterface.addColumn('users', 'gender', {
      type: Sequelize.STRING(20),
      allowNull: true,
    });
    await queryInterface.addColumn('users', 'about', {
      type: Sequelize.STRING(500),
      allowNull: true,
    });
    await queryInterface.addColumn('users', 'isProfileComplete', {
      type: Sequelize.BOOLEAN,
      defaultValue: false,
      allowNull: false,
    });
  },

  async down(queryInterface) {
    await queryInterface.removeColumn('users', 'firstName');
    await queryInterface.removeColumn('users', 'lastName');
    await queryInterface.removeColumn('users', 'nickName');
    await queryInterface.removeColumn('users', 'dateOfBirth');
    await queryInterface.removeColumn('users', 'gender');
    await queryInterface.removeColumn('users', 'about');
    await queryInterface.removeColumn('users', 'isProfileComplete');
  },
};
