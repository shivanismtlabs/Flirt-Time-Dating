'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    // 1. Add profilePicture to users table if not exists
    const usersTable = await queryInterface.describeTable('users');
    if (!usersTable.profilePicture) {
      await queryInterface.addColumn('users', 'profilePicture', {
        type: Sequelize.STRING(500),
        allowNull: true,
      });
    }

    // 2. Add AWS / Laravel verification fields to face_verifications table
    const faceTable = await queryInterface.describeTable('face_verifications');
    if (!faceTable.sourceImage) {
      await queryInterface.addColumn('face_verifications', 'sourceImage', {
        type: Sequelize.STRING(500),
        allowNull: true,
      });
    }
    if (!faceTable.processedImage) {
      await queryInterface.addColumn('face_verifications', 'processedImage', {
        type: Sequelize.STRING(500),
        allowNull: true,
      });
    }
    if (!faceTable.rejectionReason) {
      await queryInterface.addColumn('face_verifications', 'rejectionReason', {
        type: Sequelize.STRING(255),
        allowNull: true,
      });
    }
    if (!faceTable.attemptNo) {
      await queryInterface.addColumn('face_verifications', 'attemptNo', {
        type: Sequelize.INTEGER,
        defaultValue: 1,
        allowNull: false,
      });
    }
    if (!faceTable.isLatest) {
      await queryInterface.addColumn('face_verifications', 'isLatest', {
        type: Sequelize.BOOLEAN,
        defaultValue: true,
        allowNull: false,
      });
    }

    // 3. Add index on isLatest
    try {
      await queryInterface.addIndex('face_verifications', ['isLatest'], {
        name: 'face_verifications_is_latest_idx',
      });
    } catch (e) {
      // Index might already exist
    }
  },

  async down(queryInterface) {
    const usersTable = await queryInterface.describeTable('users');
    if (usersTable.profilePicture) {
      await queryInterface.removeColumn('users', 'profilePicture');
    }

    const faceTable = await queryInterface.describeTable('face_verifications');
    if (faceTable.sourceImage) {
      await queryInterface.removeColumn('face_verifications', 'sourceImage');
    }
    if (faceTable.processedImage) {
      await queryInterface.removeColumn('face_verifications', 'processedImage');
    }
    if (faceTable.rejectionReason) {
      await queryInterface.removeColumn('face_verifications', 'rejectionReason');
    }
    if (faceTable.attemptNo) {
      await queryInterface.removeColumn('face_verifications', 'attemptNo');
    }
    if (faceTable.isLatest) {
      await queryInterface.removeColumn('face_verifications', 'isLatest');
    }
  },
};
