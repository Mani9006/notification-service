/**
 * Centralized configuration module for the notification service.
 * Supports environment-based overrides with sensible defaults.
 */

'use strict';

const config = {
  // Server
  port: parseInt(process.env.PORT, 10) || 3000,
  host: process.env.HOST || '0.0.0.0',
  nodeEnv: process.env.NODE_ENV || 'development',

  // WebSocket
  websocket: {
    corsOrigin: process.env.WS_CORS_ORIGIN || '*',
    pingInterval: parseInt(process.env.WS_PING_INTERVAL, 10) || 25000,
    pingTimeout: parseInt(process.env.WS_PING_TIMEOUT, 10) || 60000,
  },

  // Rate Limiting
  rateLimit: {
    windowMs: parseInt(process.env.RATE_LIMIT_WINDOW, 10) || 60000, // 1 minute
    maxRequests: parseInt(process.env.RATE_LIMIT_MAX, 10) || 100,
    maxNotificationsPerUser: parseInt(process.env.NOTIF_LIMIT_MAX, 10) || 30,
    notificationWindowMs: parseInt(process.env.NOTIF_LIMIT_WINDOW, 10) || 60000,
  },

  // Retry
  retry: {
    maxAttempts: parseInt(process.env.RETRY_MAX_ATTEMPTS, 10) || 3,
    baseDelayMs: parseInt(process.env.RETRY_BASE_DELAY, 10) || 1000,
    maxDelayMs: parseInt(process.env.RETRY_MAX_DELAY, 10) || 30000,
    backoffMultiplier: parseFloat(process.env.RETRY_MULTIPLIER) || 2,
  },

  // Batch Processing
  batch: {
    maxSize: parseInt(process.env.BATCH_MAX_SIZE, 10) || 50,
    flushIntervalMs: parseInt(process.env.BATCH_FLUSH_INTERVAL, 10) || 5000,
  },

  // Scheduling
  scheduler: {
    checkIntervalMs: parseInt(process.env.SCHEDULER_INTERVAL, 10) || 10000,
    defaultDelayMinutes: parseInt(process.env.SCHEDULER_DEFAULT_DELAY, 10) || 5,
    maxScheduledDays: parseInt(process.env.SCHEDULER_MAX_DAYS, 10) || 30,
  },

  // JWT
  jwt: {
    secret: process.env.JWT_SECRET || 'notification-service-secret-key-change-in-production',
    expiresIn: process.env.JWT_EXPIRES_IN || '24h',
    issuer: process.env.JWT_ISSUER || 'notification-service',
  },

  // Logging
  log: {
    level: process.env.LOG_LEVEL || (process.env.NODE_ENV === 'production' ? 'info' : 'debug'),
    format: process.env.LOG_FORMAT || 'combined',
    maxFiles: parseInt(process.env.LOG_MAX_FILES, 10) || 5,
    maxSize: process.env.LOG_MAX_SIZE || '10m',
  },

  // Notification Defaults
  notification: {
    defaultTtlHours: parseInt(process.env.NOTIF_DEFAULT_TTL, 10) || 72,
    maxBulkCreate: parseInt(process.env.NOTIF_MAX_BULK, 10) || 100,
    retentionDays: parseInt(process.env.NOTIF_RETENTION_DAYS, 10) || 90,
  },

  // Channels
  channels: ['in_app', 'email', 'push'],

  // Priority Levels
  priorities: ['low', 'normal', 'high', 'urgent'],
};

// Validation
const validateConfig = () => {
  if (!config.jwt.secret || config.jwt.secret.length < 16) {
    throw new Error('JWT_SECRET must be at least 16 characters');
  }
  if (config.rateLimit.maxRequests < 1) {
    throw new Error('RATE_LIMIT_MAX must be at least 1');
  }
  if (config.retry.maxAttempts < 1) {
    throw new Error('RETRY_MAX_ATTEMPTS must be at least 1');
  }
};

validateConfig();

module.exports = config;
