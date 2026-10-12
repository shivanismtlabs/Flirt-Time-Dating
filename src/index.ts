import dns from 'dns';
import app from './app';
import { env } from './config/env';
import { connectDatabase } from './config/database';
import { initDb } from './models';
import { emailProvider } from './services/email.service';

// Prefer IPv4 for outbound network calls to avoid IPv6 timeouts on AWS EC2 & cloud instances
if (dns.setDefaultResultOrder) {
  dns.setDefaultResultOrder('ipv4first');
}

const startServer = async () => {
  console.log('🚀 Starting Node.js Express server...');

  // 1. Connect to PostgreSQL
  const dbConnected = await connectDatabase();
  if (dbConnected) {
    // 2. Synchronize Sequelize models if DB is connected
    try {
      await initDb();
    } catch (err) {
      console.warn('⚠️ Could not sync models with DB.');
    }
  } else {
    console.warn('⚠️ Server running without active DB connection. Update .env credentials to connect.');
  }

  // 3. Verify Email Provider (SMTP) connectivity
  if (emailProvider.verifyConnection) {
    const emailStatus = await emailProvider.verifyConnection();
    if (emailStatus.ready) {
      console.log('📧 Email provider (SMTP) connected & verified successfully.');
    } else {
      console.warn(`⚠️ Email provider (SMTP) check: ${emailStatus.error}`);
    }
  }

  // 4. Listen on specified PORT
  const server = app.listen(env.PORT, () => {
    console.log(`==================================================`);
    console.log(`🌐 Server running in ${env.NODE_ENV} mode on port ${env.PORT}`);
    console.log(`🔗 Health check: http://localhost:${env.PORT}/health`);
    console.log(`🔗 API Base: http://localhost:${env.PORT}/api`);
    console.log(`==================================================`);
  });

  // Graceful shutdown handling
  const shutdown = () => {
    console.log('⚡ Received shutdown signal. Closing server...');
    server.close(() => {
      console.log('👋 HTTP server closed.');
      process.exit(0);
    });
  };

  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
};

startServer();
