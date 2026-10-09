'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    // 1. Add isFaceVerified and faceVerifiedAt to users table if not existing
    const usersTable = await queryInterface.describeTable('users');
    if (!usersTable.isFaceVerified) {
      await queryInterface.addColumn('users', 'isFaceVerified', {
        type: Sequelize.BOOLEAN,
        defaultValue: false,
        allowNull: false,
      });
    }
    if (!usersTable.faceVerifiedAt) {
      await queryInterface.addColumn('users', 'faceVerifiedAt', {
        type: Sequelize.DATE,
        allowNull: true,
      });
    }

    // 2. Create face_verifications table
    await queryInterface.createTable('face_verifications', {
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
      status: {
        type: Sequelize.STRING(50),
        defaultValue: 'action_required',
        allowNull: false,
      },
      verificationType: {
        type: Sequelize.STRING(50),
        defaultValue: 'selfie',
        allowNull: false,
      },
      faceDetected: {
        type: Sequelize.BOOLEAN,
        defaultValue: false,
        allowNull: false,
      },
      faceCount: {
        type: Sequelize.INTEGER,
        defaultValue: 0,
        allowNull: false,
      },
      qualityScore: {
        type: Sequelize.FLOAT,
        allowNull: true,
      },
      blurScore: {
        type: Sequelize.FLOAT,
        allowNull: true,
      },
      brightnessScore: {
        type: Sequelize.FLOAT,
        allowNull: true,
      },
      similarityScore: {
        type: Sequelize.FLOAT,
        allowNull: true,
      },
      identityMatched: {
        type: Sequelize.BOOLEAN,
        allowNull: true,
      },
      livenessStatus: {
        type: Sequelize.STRING(50),
        defaultValue: 'unavailable_single_frame',
        allowNull: true,
      },
      reasonCode: {
        type: Sequelize.STRING(100),
        defaultValue: 'PENDING_EVALUATION',
        allowNull: false,
      },
      reasonMessage: {
        type: Sequelize.STRING(500),
        allowNull: true,
      },
      attempts: {
        type: Sequelize.INTEGER,
        defaultValue: 1,
        allowNull: false,
      },
      metadata: {
        type: Sequelize.JSON,
        allowNull: true,
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

    // 3. Add Indexes
    await queryInterface.addIndex('face_verifications', ['userId'], {
      name: 'face_verifications_user_id_idx',
    });
    await queryInterface.addIndex('face_verifications', ['status'], {
      name: 'face_verifications_status_idx',
    });
    await queryInterface.addIndex('face_verifications', ['createdAt'], {
      name: 'face_verifications_created_at_idx',
    });
  },

  async down(queryInterface) {
    await queryInterface.dropTable('face_verifications');
    const usersTable = await queryInterface.describeTable('users');
    if (usersTable.isFaceVerified) {
      await queryInterface.removeColumn('users', 'isFaceVerified');
    }
    if (usersTable.faceVerifiedAt) {
      await queryInterface.removeColumn('users', 'faceVerifiedAt');
    }
  },
};
