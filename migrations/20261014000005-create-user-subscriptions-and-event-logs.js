'use strict';

module.exports = {
  up: async (queryInterface, Sequelize) => {
    const isPostgres = queryInterface.sequelize.getDialect() === 'postgres';

    // 1. Ensure user subscription fields on users table
    const userTableInfo = await queryInterface.describeTable('users');

    if (!userTableInfo.is_subscribed && !userTableInfo.isSubscribed) {
      await queryInterface.addColumn('users', 'is_subscribed', {
        type: Sequelize.BOOLEAN,
        allowNull: false,
        defaultValue: false,
      });
    }

    if (!userTableInfo.subscription_expires_at && !userTableInfo.subscriptionExpiresAt) {
      await queryInterface.addColumn('users', 'subscription_expires_at', {
        type: Sequelize.DATE,
        allowNull: true,
      });
    }

    if (!userTableInfo.active_subscription_plan_id && !userTableInfo.activeSubscriptionPlanId) {
      await queryInterface.addColumn('users', 'active_subscription_plan_id', {
        type: Sequelize.INTEGER,
        allowNull: true,
      });
    }

    // 2. Create user_subscriptions table
    const tables = await queryInterface.showAllTables();
    const tableNames = tables.map((t) => (typeof t === 'string' ? t : t.tableName || t.name));

    if (!tableNames.includes('user_subscriptions')) {
      await queryInterface.createTable('user_subscriptions', {
        id: {
          type: Sequelize.UUID,
          defaultValue: Sequelize.UUIDV4,
          primaryKey: true,
        },
        user_id: {
          type: Sequelize.UUID,
          allowNull: false,
          references: {
            model: 'users',
            key: 'id',
          },
          onDelete: 'CASCADE',
          onUpdate: 'CASCADE',
        },
        plan_id: {
          type: Sequelize.INTEGER,
          allowNull: true,
          references: {
            model: 'subscription_plans',
            key: 'id',
          },
          onDelete: 'SET NULL',
          onUpdate: 'CASCADE',
        },
        platform: {
          type: Sequelize.STRING(20),
          allowNull: false,
        },
        product_id: {
          type: Sequelize.STRING(150),
          allowNull: false,
        },
        store_transaction_id: {
          type: Sequelize.STRING(255),
          allowNull: false,
          unique: true,
        },
        original_transaction_id: {
          type: Sequelize.STRING(255),
          allowNull: true,
        },
        purchase_token: {
          type: Sequelize.TEXT,
          allowNull: true,
        },
        status: {
          type: Sequelize.STRING(50),
          allowNull: false,
          defaultValue: 'active',
        },
        is_entitled: {
          type: Sequelize.BOOLEAN,
          allowNull: false,
          defaultValue: false,
        },
        starts_at: {
          type: Sequelize.DATE,
          allowNull: false,
        },
        expires_at: {
          type: Sequelize.DATE,
          allowNull: false,
        },
        grace_period_expires_at: {
          type: Sequelize.DATE,
          allowNull: true,
        },
        auto_renewing: {
          type: Sequelize.BOOLEAN,
          allowNull: false,
          defaultValue: true,
        },
        cancel_reason: {
          type: Sequelize.STRING(100),
          allowNull: true,
        },
        canceled_at: {
          type: Sequelize.DATE,
          allowNull: true,
        },
        price: {
          type: Sequelize.DECIMAL(10, 2),
          allowNull: true,
        },
        currency: {
          type: Sequelize.STRING(10),
          allowNull: false,
          defaultValue: 'USD',
        },
        environment: {
          type: Sequelize.STRING(20),
          allowNull: false,
          defaultValue: 'production',
        },
        acknowledged: {
          type: Sequelize.BOOLEAN,
          allowNull: false,
          defaultValue: false,
        },
        acknowledged_at: {
          type: Sequelize.DATE,
          allowNull: true,
        },
        bonus_coins_credited: {
          type: Sequelize.BOOLEAN,
          allowNull: false,
          defaultValue: false,
        },
        bonus_coins_amount: {
          type: Sequelize.INTEGER,
          allowNull: false,
          defaultValue: 0,
        },
        raw_verification_data: {
          type: isPostgres ? Sequelize.JSONB : Sequelize.JSON,
          allowNull: true,
        },
        latest_event_id: {
          type: Sequelize.STRING(255),
          allowNull: true,
        },
        latest_event_type: {
          type: Sequelize.STRING(100),
          allowNull: true,
        },
        latest_event_timestamp: {
          type: Sequelize.DATE,
          allowNull: true,
        },
        created_at: {
          type: Sequelize.DATE,
          allowNull: false,
          defaultValue: Sequelize.fn('NOW'),
        },
        updated_at: {
          type: Sequelize.DATE,
          allowNull: false,
          defaultValue: Sequelize.fn('NOW'),
        },
      });

      await queryInterface.addIndex('user_subscriptions', ['user_id']);
      await queryInterface.addIndex('user_subscriptions', ['original_transaction_id']);
      await queryInterface.addIndex('user_subscriptions', ['product_id']);
      await queryInterface.addIndex('user_subscriptions', ['status']);
      await queryInterface.addIndex('user_subscriptions', ['is_entitled']);
      await queryInterface.addIndex('user_subscriptions', ['expires_at']);
    }

    // 3. Create subscription_event_logs table
    if (!tableNames.includes('subscription_event_logs')) {
      await queryInterface.createTable('subscription_event_logs', {
        id: {
          type: Sequelize.UUID,
          defaultValue: Sequelize.UUIDV4,
          primaryKey: true,
        },
        platform: {
          type: Sequelize.STRING(20),
          allowNull: false,
        },
        event_id: {
          type: Sequelize.STRING(255),
          allowNull: false,
          unique: true,
        },
        event_type: {
          type: Sequelize.STRING(100),
          allowNull: false,
        },
        subtype: {
          type: Sequelize.STRING(100),
          allowNull: true,
        },
        original_transaction_id: {
          type: Sequelize.STRING(255),
          allowNull: true,
        },
        store_transaction_id: {
          type: Sequelize.STRING(255),
          allowNull: true,
        },
        purchase_token: {
          type: Sequelize.TEXT,
          allowNull: true,
        },
        event_timestamp: {
          type: Sequelize.DATE,
          allowNull: false,
        },
        processed: {
          type: Sequelize.BOOLEAN,
          allowNull: false,
          defaultValue: false,
        },
        processing_result: {
          type: Sequelize.TEXT,
          allowNull: true,
        },
        raw_payload: {
          type: isPostgres ? Sequelize.JSONB : Sequelize.JSON,
          allowNull: true,
        },
        created_at: {
          type: Sequelize.DATE,
          allowNull: false,
          defaultValue: Sequelize.fn('NOW'),
        },
        updated_at: {
          type: Sequelize.DATE,
          allowNull: false,
          defaultValue: Sequelize.fn('NOW'),
        },
      });

      await queryInterface.addIndex('subscription_event_logs', ['platform']);
      await queryInterface.addIndex('subscription_event_logs', ['event_type']);
      await queryInterface.addIndex('subscription_event_logs', ['original_transaction_id']);
      await queryInterface.addIndex('subscription_event_logs', ['event_timestamp']);
    }
  },

  down: async (queryInterface) => {
    await queryInterface.dropTable('subscription_event_logs');
    await queryInterface.dropTable('user_subscriptions');

    try {
      await queryInterface.removeColumn('users', 'active_subscription_plan_id');
      await queryInterface.removeColumn('users', 'subscription_expires_at');
      await queryInterface.removeColumn('users', 'is_subscribed');
    } catch (_e) {}
  },
};
