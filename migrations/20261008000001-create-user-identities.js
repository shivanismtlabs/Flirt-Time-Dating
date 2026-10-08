'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('user_identities', {
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
      provider: {
        type: Sequelize.STRING(50),
        allowNull: false,
        comment: 'Identity provider (e.g. apple)',
      },
      providerUserId: {
        type: Sequelize.STRING(255),
        allowNull: false,
        comment: 'Provider unique user identifier (Apple sub / Apple user ID)',
      },
      email: {
        type: Sequelize.STRING(100),
        allowNull: true,
        comment: 'User email from provider (may be Apple private relay email)',
      },
      isPrivateEmail: {
        type: Sequelize.BOOLEAN,
        defaultValue: false,
        allowNull: false,
        comment: 'Flag indicating if email is a private relay email',
      },
      createdAt: {
        type: Sequelize.DATE,
        allowNull: false,
      },
      updatedAt: {
        type: Sequelize.DATE,
        allowNull: false,
      },
    });

    await queryInterface.addIndex('user_identities', ['provider', 'providerUserId'], {
      unique: true,
      name: 'user_identities_provider_provider_user_id_unique',
    });

    await queryInterface.addIndex('user_identities', ['userId'], {
      name: 'user_identities_user_id_idx',
    });

    await queryInterface.addIndex('user_identities', ['email'], {
      name: 'user_identities_email_idx',
    });
  },

  async down(queryInterface) {
    await queryInterface.dropTable('user_identities');
  },
};
