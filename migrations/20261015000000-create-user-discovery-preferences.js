'use strict';

module.exports = {
  up: async (queryInterface, Sequelize) => {
    // 1. Ensure lastActiveAt column on users table
    const userTableInfo = await queryInterface.describeTable('users');
    if (!userTableInfo.lastActiveAt && !userTableInfo.last_active_at) {
      await queryInterface.addColumn('users', 'lastActiveAt', {
        type: Sequelize.DATE,
        allowNull: true,
      });
    }

    // 2. Create user_discovery_preferences table
    const tables = await queryInterface.showAllTables();
    const tableNames = tables.map((t) => (typeof t === 'string' ? t : t.tableName || t.name));

    if (!tableNames.includes('user_discovery_preferences')) {
      await queryInterface.createTable('user_discovery_preferences', {
        id: {
          type: Sequelize.UUID,
          defaultValue: Sequelize.UUIDV4,
          primaryKey: true,
        },
        userId: {
          type: Sequelize.UUID,
          allowNull: false,
          unique: true,
          references: {
            model: 'users',
            key: 'id',
          },
          onDelete: 'CASCADE',
          onUpdate: 'CASCADE',
        },
        genders: {
          type: Sequelize.JSON,
          allowNull: false,
          defaultValue: JSON.stringify(['everyone']),
        },
        ageMin: {
          type: Sequelize.INTEGER,
          allowNull: false,
          defaultValue: 18,
        },
        ageMax: {
          type: Sequelize.INTEGER,
          allowNull: false,
          defaultValue: 70,
        },
        maxDistanceKm: {
          type: Sequelize.INTEGER,
          allowNull: true,
          defaultValue: null,
        },
        lookingFor: {
          type: Sequelize.JSON,
          allowNull: false,
          defaultValue: JSON.stringify([]),
        },
        interestIds: {
          type: Sequelize.JSON,
          allowNull: false,
          defaultValue: JSON.stringify([]),
        },
        verifiedOnly: {
          type: Sequelize.BOOLEAN,
          allowNull: false,
          defaultValue: false,
        },
        onlineOnly: {
          type: Sequelize.BOOLEAN,
          allowNull: false,
          defaultValue: false,
        },
        createdAt: {
          type: Sequelize.DATE,
          allowNull: false,
          defaultValue: Sequelize.fn('NOW'),
        },
        updatedAt: {
          type: Sequelize.DATE,
          allowNull: false,
          defaultValue: Sequelize.fn('NOW'),
        },
      });

      await queryInterface.addIndex('user_discovery_preferences', ['userId'], {
        unique: true,
        name: 'unique_user_discovery_preference_user_id',
      });
    }
  },

  down: async (queryInterface) => {
    const tables = await queryInterface.showAllTables();
    const tableNames = tables.map((t) => (typeof t === 'string' ? t : t.tableName || t.name));

    if (tableNames.includes('user_discovery_preferences')) {
      await queryInterface.dropTable('user_discovery_preferences');
    }

    const userTableInfo = await queryInterface.describeTable('users');
    if (userTableInfo.lastActiveAt) {
      await queryInterface.removeColumn('users', 'lastActiveAt');
    }
  },
};
