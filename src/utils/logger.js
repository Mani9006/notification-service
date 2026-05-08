/**
 * Winston-based logger with structured logging, multiple transports,
 * and environment-aware formatting.
 */

'use strict';

const winston = require('winston');
const path = require('path');
const config = require('../config');

const { combine, timestamp, printf, colorize, errors, json } = winston.format;

// Custom log format for development
const devFormat = printf(({ level, message, timestamp, service, requestId, ...metadata }) => {
  const metaStr = Object.keys(metadata).length ? JSON.stringify(metadata, null, 0) : '';
  const reqPart = requestId ? `[${requestId}] ` : '';
  return `${timestamp} [${service || 'notification'}] ${level}: ${reqPart}${message} ${metaStr}`;
});

// Create logs directory if needed
const logsDir = path.join(process.cwd(), 'logs');

/**
 * Build logger transports based on environment
 */
const buildTransports = () => {
  const transportsList = [];

  // Console transport
  if (config.nodeEnv === 'development') {
    transportsList.push(
      new winston.transports.Console({
        format: combine(
          colorize(),
          timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
          devFormat
        ),
      })
    );
  } else {
    transportsList.push(
      new winston.transports.Console({
        format: combine(
          timestamp(),
          json()
        ),
      })
    );
  }

  // File transports for production
  if (config.nodeEnv === 'production') {
    transportsList.push(
      new winston.transports.File({
        filename: path.join(logsDir, 'error.log'),
        level: 'error',
        maxsize: 5242880, // 5MB
        maxFiles: 5,
      }),
      new winston.transports.File({
        filename: path.join(logsDir, 'combined.log'),
        maxsize: 5242880,
        maxFiles: 5,
      })
    );
  }

  return transportsList;
};

/**
 * Create the main application logger
 */
const createLogger = (serviceName = 'notification-service') => {
  const logger = winston.createLogger({
    level: config.log.level,
    defaultMeta: { service: serviceName, pid: process.pid },
    transports: buildTransports(),
    exitOnError: false,
  });

  // Stream interface for Morgan-like HTTP logging integration
  logger.stream = {
    write: (message) => {
      logger.info(message.trim());
    },
  };

  return logger;
};

// Singleton logger instance
const logger = createLogger();

/**
 * Create a child logger with request context
 */
const createRequestLogger = (requestId) => {
  return logger.child({ requestId });
};

/**
 * Log notification lifecycle events
 */
const logNotificationEvent = (event, notification, metadata = {}) => {
  const logData = {
    event,
    notificationId: notification.id,
    userId: notification.userId,
    channel: notification.channel,
    priority: notification.priority,
    ...metadata,
  };

  if (event === 'delivery_failed' || event === 'retry_failed') {
    logger.warn(`Notification ${event}`, logData);
  } else if (event === 'delivery_success') {
    logger.info(`Notification ${event}`, logData);
  } else {
    logger.debug(`Notification ${event}`, logData);
  }
};

module.exports = {
  logger,
  createLogger,
  createRequestLogger,
  logNotificationEvent,
};
