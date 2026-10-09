import express, { Application } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import routes from './routes';
import { notFoundHandler, errorHandler } from './middlewares/error.middleware';
import { sequelize } from './config/database';

const app: Application = express();

// Security and utility middlewares
app.use(helmet());
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

if (process.env.NODE_ENV !== 'test') {
  app.use(morgan('dev'));
}

// Health check endpoint (supports /health, /api/health, and /api/v1/health for reverse proxy compatibility)
app.get(['/health', '/api/health', '/api/v1/health'], async (_req, res) => {
  let dbStatus = 'disconnected';
  try {
    await sequelize.authenticate();
    dbStatus = 'connected';
  } catch (err) {
    dbStatus = 'error';
  }

  return res.status(200).json({
    status: 'UP',
    timestamp: new Date().toISOString(),
    database: dbStatus,
    environment: process.env.NODE_ENV || 'development',
  });
});

// API Routes (supports /api and /api/v1)
app.use('/api', routes);
app.use('/api/v1', routes);

// Error Handling Middlewares
app.use(notFoundHandler);
app.use(errorHandler);

export default app;
