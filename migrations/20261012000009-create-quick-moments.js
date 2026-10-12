'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    // 1. Create quick_moments table
    await queryInterface.createTable('quick_moments', {
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
      type: {
        type: Sequelize.STRING(20),
        defaultValue: 'image',
        allowNull: false,
      },
      mediaUrl: {
        type: Sequelize.STRING(1000),
        allowNull: true,
      },
      thumbnailUrl: {
        type: Sequelize.STRING(1000),
        allowNull: true,
      },
      text: {
        type: Sequelize.STRING(1000),
        allowNull: true,
      },
      backgroundColor: {
        type: Sequelize.STRING(50),
        defaultValue: '#2d0b1e',
        allowNull: true,
      },
      textColor: {
        type: Sequelize.STRING(50),
        defaultValue: '#ffffff',
        allowNull: true,
      },
      caption: {
        type: Sequelize.STRING(500),
        allowNull: true,
      },
      locationLabel: {
        type: Sequelize.STRING(150),
        allowNull: true,
      },
      viewsCount: {
        type: Sequelize.INTEGER,
        defaultValue: 0,
        allowNull: false,
      },
      repliesCount: {
        type: Sequelize.INTEGER,
        defaultValue: 0,
        allowNull: false,
      },
      status: {
        type: Sequelize.STRING(20),
        defaultValue: 'active',
        allowNull: false,
      },
      publishedAt: {
        type: Sequelize.DATE,
        defaultValue: Sequelize.NOW,
        allowNull: false,
      },
      expiresAt: {
        type: Sequelize.DATE,
        allowNull: false,
      },
      createdAt: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.NOW,
      },
      updatedAt: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.NOW,
      },
    });

    await queryInterface.addIndex('quick_moments', ['userId'], {
      name: 'idx_quick_moments_user_id',
    });
    await queryInterface.addIndex('quick_moments', ['expiresAt'], {
      name: 'idx_quick_moments_expires_at',
    });
    await queryInterface.addIndex('quick_moments', ['status', 'expiresAt'], {
      name: 'idx_quick_moments_status_expires',
    });

    // 2. Create quick_moment_reactions table
    await queryInterface.createTable('quick_moment_reactions', {
      id: {
        type: Sequelize.UUID,
        defaultValue: Sequelize.UUIDV4,
        primaryKey: true,
        allowNull: false,
      },
      quickMomentId: {
        type: Sequelize.UUID,
        allowNull: false,
        references: {
          model: 'quick_moments',
          key: 'id',
        },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE',
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
      emoji: {
        type: Sequelize.STRING(20),
        allowNull: false,
      },
      createdAt: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.NOW,
      },
      updatedAt: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.NOW,
      },
    });

    await queryInterface.addIndex(
      'quick_moment_reactions',
      ['quickMomentId', 'userId'],
      {
        unique: true,
        name: 'idx_qm_reactions_moment_user_unique',
      }
    );
    await queryInterface.addIndex('quick_moment_reactions', ['quickMomentId'], {
      name: 'idx_qm_reactions_moment_id',
    });

    // 3. Create quick_moment_views table
    await queryInterface.createTable('quick_moment_views', {
      id: {
        type: Sequelize.UUID,
        defaultValue: Sequelize.UUIDV4,
        primaryKey: true,
        allowNull: false,
      },
      quickMomentId: {
        type: Sequelize.UUID,
        allowNull: false,
        references: {
          model: 'quick_moments',
          key: 'id',
        },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE',
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
      createdAt: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.NOW,
      },
      updatedAt: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.NOW,
      },
    });

    await queryInterface.addIndex('quick_moment_views', ['quickMomentId', 'userId'], {
      unique: true,
      name: 'idx_qm_views_moment_user_unique',
    });
  },

  async down(queryInterface) {
    await queryInterface.dropTable('quick_moment_views');
    await queryInterface.dropTable('quick_moment_reactions');
    await queryInterface.dropTable('quick_moments');
  },
};
