import express, { Application } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import routes from './routes';
import { notFoundHandler, errorHandler } from './middlewares/error.middleware';
import { sequelize } from './config/database';
import { authenticate } from './middlewares/auth.middleware';
import { handleUploadSelfie } from './middlewares/upload.middleware';
import {
  uploadFaceVerification,
  getGestureVerificationInfo,
} from './controllers/faceVerification.controller';

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

// Direct root aliases for gesture endpoints (backward compatibility with legacy clients)
app.get(['/gesture-upload', '/gesture'], authenticate, getGestureVerificationInfo);
app.post(['/gesture-upload', '/gesture'], authenticate, handleUploadSelfie, uploadFaceVerification);

// Error Handling Middlewares
app.use(notFoundHandler);
app.use(errorHandler);

export default app;
