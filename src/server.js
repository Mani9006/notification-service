/**
 * Real-time Notification Service
 * Entry point that initializes Express, Socket.IO, routes, middleware,
 * and background services.
 */

'use strict';

require('dotenv').config();

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const config = require('./config');
const { logger } = require('./utils/logger');
const { rateLimiter } = require('./middleware/rateLimiter');
const { initializeWebSocket } = require('./websocket/handler');
const { startScheduler, stopScheduler } = require('./services/schedulerService');
const { cleanupOldNotifications } = require('./services/deliveryService');
const { trackEvent, subscribe } = require('./services/analyticsService');

// Route imports
const notificationRoutes = require('./routes/notifications');
const preferenceRoutes = require('./routes/preferences');
const templateRoutes = require('./routes/templates');
const analyticsRoutes = require('./routes/analytics');

// Create Express app
const app = express();
const server = http.createServer(app);

// Create Socket.IO server
const io = new Server(server, {
  cors: {
    origin: config.websocket.corsOrigin,
    methods: ['GET', 'POST'],
    credentials: true,
  },
  pingInterval: config.websocket.pingInterval,
  pingTimeout: config.websocket.pingTimeout,
  transports: ['websocket', 'polling'],
});

// Make io accessible to routes
app.set('io', io);

// Middleware
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true, limit: '1mb' }));

// Request logging
app.use((req, res, next) => {
  req.requestId = `${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
  res.set('X-Request-Id', req.requestId);
  logger.debug(`${req.method} ${req.path} - ${req.requestId}`);
  next();
});

// Health check (before auth)
app.get('/health', (req, res) => {
  res.status(200).json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    version: require('../package.json').version,
  });
});

// Root endpoint
app.get('/', (req, res) => {
  res.status(200).json({
    name: 'Real-time Notification Service',
    version: require('../package.json').version,
    description: 'Multi-channel notification delivery with WebSockets',
    endpoints: {
      notifications: '/api/notifications',
      preferences: '/api/preferences',
      templates: '/api/templates',
      analytics: '/api/analytics',
      health: '/health',
      websocket: '/socket.io/',
    },
  });
});

// Global rate limiting
app.use(rateLimiter({
  windowMs: config.rateLimit.windowMs,
  maxRequests: config.rateLimit.maxRequests,
}));

// API routes
app.use('/api/notifications', notificationRoutes);
app.use('/api/preferences', preferenceRoutes);
app.use('/api/templates', templateRoutes);
app.use('/api/analytics', analyticsRoutes);

// Initialize WebSocket handlers
initializeWebSocket(io);

// Error handling middleware
app.use((err, req, res, next) => {
  logger.error(`Unhandled error: ${err.message}`, {
    requestId: req.requestId,
    stack: err.stack,
  });

  if (res.headersSent) {
    return next(err);
  }

  res.status(err.statusCode || 500).json({
    success: false,
    error: config.nodeEnv === 'production' ? 'Internal server error' : err.message,
    code: err.code || 'INTERNAL_ERROR',
    requestId: req.requestId,
  });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({
    success: false,
    error: `Route ${req.method} ${req.path} not found`,
    code: 'ROUTE_NOT_FOUND',
  });
});

// Graceful shutdown
const gracefulShutdown = (signal) => {
  logger.info(`Received ${signal}. Starting graceful shutdown...`);

  stopScheduler();

  server.close(() => {
    logger.info('HTTP server closed');
    io.close(() => {
      logger.info('WebSocket server closed');
      process.exit(0);
    });
  });

  // Force exit after timeout
  setTimeout(() => {
    logger.error('Forced shutdown after timeout');
    process.exit(1);
  }, 30000);
};

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

process.on('uncaughtException', (error) => {
  logger.error(`Uncaught exception: ${error.message}`, { stack: error.stack });
  gracefulShutdown('uncaughtException');
});

process.on('unhandledRejection', (reason, promise) => {
  logger.error('Unhandled rejection', { reason });
});

// Start server
const start = () => {
  const port = config.port;
  const host = config.host;

  server.listen(port, host, () => {
    logger.info(`Notification Service running on http://${host}:${port}`);
    logger.info(`Environment: ${config.nodeEnv}`);
    logger.info(`WebSocket endpoint: ws://${host}:${port}`);
    logger.info(`Health check: http://${host}:${port}/health`);

    // Start scheduler
    startScheduler();

    // Schedule periodic cleanup
    setInterval(() => {
      try {
        const result = cleanupOldNotifications();
        if (result.removed > 0) {
          logger.info(`Periodic cleanup: ${result.removed} notifications removed`);
        }
      } catch (error) {
        logger.error(`Cleanup error: ${error.message}`);
      }
    }, 3600000); // Every hour
  });

  return { app, server, io };
};

// Auto-start if not in test mode
if (config.nodeEnv !== 'test') {
  start();
}

module.exports = { app, server, io, start };
