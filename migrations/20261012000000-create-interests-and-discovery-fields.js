'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    // 1. Add onboarding preference and discovery fields to users table
    const usersTable = await queryInterface.describeTable('users');
    
    if (!usersTable.lookingFor) {
      await queryInterface.addColumn('users', 'lookingFor', {
        type: Sequelize.STRING(50),
        allowNull: true,
      });
    }

    if (!usersTable.genderPreference) {
      await queryInterface.addColumn('users', 'genderPreference', {
        type: Sequelize.STRING(50),
        allowNull: true,
      });
    }

    if (!usersTable.religion) {
      await queryInterface.addColumn('users', 'religion', {
        type: Sequelize.STRING(50),
        allowNull: true,
      });
    }

    if (!usersTable.city) {
      await queryInterface.addColumn('users', 'city', {
        type: Sequelize.STRING(100),
        allowNull: true,
        defaultValue: 'Mumbai',
      });
    }

    if (!usersTable.latitude) {
      await queryInterface.addColumn('users', 'latitude', {
        type: Sequelize.FLOAT,
        allowNull: true,
      });
    }

    if (!usersTable.longitude) {
      await queryInterface.addColumn('users', 'longitude', {
        type: Sequelize.FLOAT,
        allowNull: true,
      });
    }

    if (!usersTable.voicePromptUrl) {
      await queryInterface.addColumn('users', 'voicePromptUrl', {
        type: Sequelize.STRING(500),
        allowNull: true,
      });
    }

    if (!usersTable.voicePromptDuration) {
      await queryInterface.addColumn('users', 'voicePromptDuration', {
        type: Sequelize.INTEGER,
        allowNull: true,
      });
    }

    // 2. Create interests table
    await queryInterface.createTable('interests', {
      id: {
        type: Sequelize.UUID,
        defaultValue: Sequelize.UUIDV4,
        primaryKey: true,
        allowNull: false,
      },
      name: {
        type: Sequelize.STRING(100),
        allowNull: false,
        unique: true,
      },
      icon: {
        type: Sequelize.STRING(50),
        allowNull: true,
      },
      category: {
        type: Sequelize.STRING(50),
        allowNull: true,
        defaultValue: 'General',
      },
      isActive: {
        type: Sequelize.BOOLEAN,
        defaultValue: true,
        allowNull: false,
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

    // 3. Create user_interests join table
    await queryInterface.createTable('user_interests', {
      id: {
        type: Sequelize.UUID,
        defaultValue: Sequelize.UUIDV4,
        primaryKey: true,
        allowNull: false,
      },
      userId: {
        type: Sequelize.UUID,
        allowNull: false,
        references: {
          model: 'users',
          key: 'id',
        },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE',
      },
      interestId: {
        type: Sequelize.UUID,
        allowNull: false,
        references: {
          model: 'interests',
          key: 'id',
        },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE',
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

    try {
      await queryInterface.addIndex('user_interests', ['userId', 'interestId'], {
        unique: true,
        name: 'user_interests_user_id_interest_id_unique',
      });
    } catch (e) {
      // index might already exist
    }

    // 4. Create user_photos table
    await queryInterface.createTable('user_photos', {
      id: {
        type: Sequelize.UUID,
        defaultValue: Sequelize.UUIDV4,
        primaryKey: true,
        allowNull: false,
      },
      userId: {
        type: Sequelize.UUID,
        allowNull: false,
        references: {
          model: 'users',
          key: 'id',
        },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE',
      },
      imageUrl: {
        type: Sequelize.STRING(500),
        allowNull: false,
      },
      isPrimary: {
        type: Sequelize.BOOLEAN,
        defaultValue: false,
        allowNull: false,
      },
      displayOrder: {
        type: Sequelize.INTEGER,
        defaultValue: 0,
        allowNull: false,
      },
      status: {
        type: Sequelize.STRING(50),
        defaultValue: 'approved',
        allowNull: false,
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
  },

  async down(queryInterface) {
    await queryInterface.dropTable('user_photos');
    await queryInterface.dropTable('user_interests');
    await queryInterface.dropTable('interests');
    await queryInterface.removeColumn('users', 'voicePromptDuration');
    await queryInterface.removeColumn('users', 'voicePromptUrl');
    await queryInterface.removeColumn('users', 'longitude');
    await queryInterface.removeColumn('users', 'latitude');
    await queryInterface.removeColumn('users', 'city');
    await queryInterface.removeColumn('users', 'religion');
    await queryInterface.removeColumn('users', 'genderPreference');
    await queryInterface.removeColumn('users', 'lookingFor');
  },
};
