'use strict';

module.exports = {
  up: async (queryInterface, Sequelize) => {
    // 1. Create coin_purchases table
    const tables = await queryInterface.showAllTables();
    const tableNames = tables.map((t) => (typeof t === 'string' ? t : t.tableName || t.name));

    if (!tableNames.includes('coin_purchases')) {
      await queryInterface.createTable('coin_purchases', {
        id: {
          type: Sequelize.UUID,
          defaultValue: Sequelize.UUIDV4,
          primaryKey: true,
        },
        userId: {
          type: Sequelize.UUID,
          allowNull: false,
          references: {
            model: 'users',
            key: 'id',
          },
          onDelete: 'CASCADE',
          onUpdate: 'CASCADE',
        },
        packageId: {
          type: Sequelize.INTEGER,
          allowNull: true,
          references: {
            model: 'coin_packages',
            key: 'id',
          },
          onDelete: 'SET NULL',
          onUpdate: 'CASCADE',
        },
        platform: {
          type: Sequelize.STRING(20),
          allowNull: false,
        },
        productId: {
          type: Sequelize.STRING(255),
          allowNull: false,
        },
        storeTransactionId: {
          type: Sequelize.STRING(500),
          allowNull: false,
          unique: true,
        },
        purchaseToken: {
          type: Sequelize.TEXT,
          allowNull: true,
        },
        coins: {
          type: Sequelize.INTEGER,
          allowNull: false,
          defaultValue: 0,
        },
        bonusCoins: {
          type: Sequelize.INTEGER,
          allowNull: false,
          defaultValue: 0,
        },
        totalCoins: {
          type: Sequelize.INTEGER,
          allowNull: false,
          defaultValue: 0,
        },
        price: {
          type: Sequelize.DECIMAL(10, 2),
          allowNull: false,
        },
        currency: {
          type: Sequelize.STRING(10),
          allowNull: false,
          defaultValue: 'INR',
        },
        status: {
          type: Sequelize.STRING(30),
          allowNull: false,
          defaultValue: 'completed',
        },
        environment: {
          type: Sequelize.STRING(20),
          allowNull: false,
          defaultValue: 'production',
        },
        rawVerificationData: {
          type: Sequelize.JSON,
          allowNull: true,
        },
        acknowledged: {
          type: Sequelize.BOOLEAN,
          allowNull: false,
          defaultValue: false,
        },
        acknowledgedAt: {
          type: Sequelize.DATE,
          allowNull: true,
        },
        verifiedAt: {
          type: Sequelize.DATE,
          allowNull: false,
          defaultValue: Sequelize.fn('NOW'),
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

      await queryInterface.addIndex('coin_purchases', ['storeTransactionId'], {
        unique: true,
        name: 'coin_purchases_store_transaction_id_unique',
      });
      await queryInterface.addIndex('coin_purchases', ['userId'], {
        name: 'coin_purchases_user_id_idx',
      });
      await queryInterface.addIndex('coin_purchases', ['platform', 'productId'], {
        name: 'coin_purchases_platform_product_idx',
      });
      await queryInterface.addIndex('coin_purchases', ['status'], {
        name: 'coin_purchases_status_idx',
      });
    }

    // 2. Create coin_transactions table (wallet ledger)
    if (!tableNames.includes('coin_transactions')) {
      await queryInterface.createTable('coin_transactions', {
        id: {
          type: Sequelize.UUID,
          defaultValue: Sequelize.UUIDV4,
          primaryKey: true,
        },
        userId: {
          type: Sequelize.UUID,
          allowNull: false,
          references: {
            model: 'users',
            key: 'id',
          },
          onDelete: 'CASCADE',
          onUpdate: 'CASCADE',
        },
        type: {
          type: Sequelize.STRING(50),
          allowNull: false,
        },
        amount: {
          type: Sequelize.INTEGER,
          allowNull: false,
        },
        balanceBefore: {
          type: Sequelize.INTEGER,
          allowNull: false,
        },
        balanceAfter: {
          type: Sequelize.INTEGER,
          allowNull: false,
        },
        referenceId: {
          type: Sequelize.STRING(255),
          allowNull: true,
        },
        referenceType: {
          type: Sequelize.STRING(50),
          allowNull: true,
        },
        description: {
          type: Sequelize.STRING(255),
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

      await queryInterface.addIndex('coin_transactions', ['userId'], {
        name: 'coin_transactions_user_id_idx',
      });
      await queryInterface.addIndex('coin_transactions', ['type'], {
        name: 'coin_transactions_type_idx',
      });
      await queryInterface.addIndex('coin_transactions', ['referenceId'], {
        name: 'coin_transactions_reference_id_idx',
      });
      await queryInterface.addIndex('coin_transactions', ['createdAt'], {
        name: 'coin_transactions_created_at_idx',
      });
    }
  },

  down: async (queryInterface, Sequelize) => {
    await queryInterface.dropTable('coin_transactions');
    await queryInterface.dropTable('coin_purchases');
  },
};
