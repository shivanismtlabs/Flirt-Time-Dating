import { Sequelize } from 'sequelize';
import { env } from './env';

const isTestEnv = process.env.NODE_ENV === 'test';

export const sequelize = isTestEnv
  ? new Sequelize({
      dialect: 'sqlite',
      storage: './test.sqlite',
      logging: false,
      pool: {
        max: 10,
        min: 0,
        idle: 1000,
        acquire: 30000,
      },
    })
  : new Sequelize(env.DB_NAME, env.DB_USER, env.DB_PASSWORD, {
      host: env.DB_HOST,
      port: env.DB_PORT,
      dialect: 'postgres',
      logging: env.DB_LOGGING ? console.log : false,
      pool: {
        max: 10,
        min: 0,
        acquire: 30000,
        idle: 10000,
      },
      dialectOptions: env.DB_SSL
        ? {
            ssl: {
              require: true,
              rejectUnauthorized: false,
            },
          }
        : {},
    });

export const connectDatabase = async (): Promise<boolean> => {
  try {
    await sequelize.authenticate();
    if (!isTestEnv) {
      console.log('✅ PostgreSQL database connection has been established successfully.');
    }
    return true;
  } catch (error: any) {
    if (!isTestEnv) {
      console.error('⚠️ Could not connect to PostgreSQL database:', error.message || error);
      console.warn('⚠️ Please check your PostgreSQL credentials in .env (DB_HOST, DB_USER, DB_PASSWORD, DB_NAME)');
    }
    return false;
  }
};
