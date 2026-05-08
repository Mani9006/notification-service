/**
 * Rate limiting middleware using sliding window algorithm
 * with per-user tracking, configurable limits, and headers.
 */

'use strict';

const config = require('../config');
const { logger } = require('../utils/logger');

/**
 * Rate limit entry
 */
class RateLimitEntry {
  constructor(userId, windowMs) {
    this.userId = userId;
    this.requests = [];
    this.windowMs = windowMs;
  }

  /**
   * Record a request and clean expired entries
   */
  recordRequest() {
    const now = Date.now();
    const windowStart = now - this.windowMs;

    // Remove expired requests (sliding window)
    this.requests = this.requests.filter((ts) => ts > windowStart);
    this.requests.push(now);
    return this.requests.length;
  }

  /**
   * Get current request count
   */
  getCount() {
    const windowStart = Date.now() - this.windowMs;
    this.requests = this.requests.filter((ts) => ts > windowStart);
    return this.requests.length;
  }

  /**
   * Get time until oldest request expires
   */
  getResetTime() {
    if (this.requests.length === 0) return 0;
    const oldest = Math.min(...this.requests);
    return Math.max(0, oldest + this.windowMs - Date.now());
  }
}

// In-memory rate limit store (use Redis in production)
const rateLimitStore = new Map();

// Notification rate limit store (per-user notification limits)
const notificationRateStore = new Map();

// Batch rate limit store
const batchRateStore = new Map();

/**
 * Cleanup expired entries periodically
 */
const cleanupInterval = setInterval(() => {
  const now = Date.now();
  let cleaned = 0;

  for (const [key, entry] of rateLimitStore.entries()) {
    const windowStart = now - entry.windowMs;
    entry.requests = entry.requests.filter((ts) => ts > windowStart);
    if (entry.requests.length === 0) {
      rateLimitStore.delete(key);
      cleaned++;
    }
  }

  for (const [key, entry] of notificationRateStore.entries()) {
    const windowStart = now - entry.windowMs;
    entry.requests = entry.requests.filter((ts) => ts > windowStart);
    if (entry.requests.length === 0) {
      notificationRateStore.delete(key);
      cleaned++;
    }
  }

  if (cleaned > 0) {
    logger.debug(`Rate limit cleanup: removed ${cleaned} expired entries`);
  }
}, 60000); // Cleanup every minute

cleanupInterval.unref();

/**
 * Get or create rate limit entry
 */
const getOrCreateEntry = (store, key, windowMs) => {
  if (!store.has(key)) {
    store.set(key, new RateLimitEntry(key, windowMs));
  }
  return store.get(key);
};

/**
 * Standard rate limiting middleware
 */
const rateLimiter = (options = {}) => {
  const windowMs = options.windowMs || config.rateLimit.windowMs;
  const maxRequests = options.maxRequests || config.rateLimit.maxRequests;
  const skipSuccessful = options.skipSuccessful || false;
  const keyGenerator = options.keyGenerator || ((req) => {
    return req.userId || req.ip || 'anonymous';
  });
  const store = options.store || rateLimitStore;

  return (req, res, next) => {
    try {
      const key = keyGenerator(req);
      const entry = getOrCreateEntry(store, key, windowMs);
      const count = entry.recordRequest();

      // Set rate limit headers
      res.set('X-RateLimit-Limit', String(maxRequests));
      res.set('X-RateLimit-Remaining', String(Math.max(0, maxRequests - count)));
      res.set('X-RateLimit-Reset', String(Math.ceil(entry.getResetTime() / 1000)));
      res.set('X-RateLimit-Window', String(Math.ceil(windowMs / 1000)));

      if (count > maxRequests) {
        const retryAfter = Math.ceil(entry.getResetTime() / 1000);
        res.set('Retry-After', String(retryAfter));

        logger.warn(`Rate limit exceeded for ${key}: ${count}/${maxRequests}`);
        return res.status(429).json({
          success: false,
          error: 'Rate limit exceeded',
          code: 'RATE_LIMIT_EXCEEDED',
          retryAfter,
          limit: maxRequests,
          window: Math.ceil(windowMs / 1000),
        });
      }

      // If skip successful, we'll decrement on successful response
      if (skipSuccessful) {
        const originalSend = res.send;
        res.send = function(body) {
          if (res.statusCode >= 200 && res.statusCode < 300) {
            // Request succeeded, keep the count
          }
          return originalSend.call(this, body);
        };
      }

      next();
    } catch (error) {
      logger.error(`Rate limiter error: ${error.message}`);
      // Fail open in case of error
      next();
    }
  };
};

/**
 * Per-user notification rate limiter
 * Limits how many notifications a single user can receive
 */
const notificationRateLimiter = (options = {}) => {
  const windowMs = options.notificationWindowMs || config.rateLimit.notificationWindowMs;
  const maxNotifications = options.maxNotifications || config.rateLimit.maxNotificationsPerUser;

  return (req, res, next) => {
    try {
      const userId = req.body.userId || req.params.userId || req.userId;
      if (!userId) {
        return next();
      }

      const key = `notif:${userId}`;
      const entry = getOrCreateEntry(notificationRateStore, key, windowMs);
      const count = entry.recordRequest();

      res.set('X-Notification-RateLimit-Limit', String(maxNotifications));
      res.set('X-Notification-RateLimit-Remaining', String(Math.max(0, maxNotifications - count)));

      if (count > maxNotifications) {
        logger.warn(`Notification rate limit exceeded for user ${userId}`);
        return res.status(429).json({
          success: false,
          error: 'Notification rate limit exceeded for this user',
          code: 'NOTIFICATION_RATE_LIMIT_EXCEEDED',
          userId,
          limit: maxNotifications,
          retryAfter: Math.ceil(entry.getResetTime() / 1000),
        });
      }

      next();
    } catch (error) {
      logger.error(`Notification rate limiter error: ${error.message}`);
      next();
    }
  };
};

/**
 * Batch rate limiter for bulk operations
 */
const batchRateLimiter = (options = {}) => {
  const windowMs = options.windowMs || 60000;
  const maxBatches = options.maxBatches || 10;
  const maxBatchSize = options.maxBatchSize || config.batch.maxSize;

  return (req, res, next) => {
    try {
      const userId = req.userId || req.ip || 'anonymous';
      const key = `batch:${userId}`;
      const entry = getOrCreateEntry(batchRateStore, key, windowMs);
      const count = entry.recordRequest();

      // Validate batch size
      if (req.body && Array.isArray(req.body.notifications)) {
        if (req.body.notifications.length > maxBatchSize) {
          return res.status(400).json({
            success: false,
            error: `Batch size exceeds maximum of ${maxBatchSize}`,
            code: 'BATCH_TOO_LARGE',
            maxBatchSize,
            provided: req.body.notifications.length,
          });
        }
      }

      if (count > maxBatches) {
        return res.status(429).json({
          success: false,
          error: 'Batch operation rate limit exceeded',
          code: 'BATCH_RATE_LIMIT_EXCEEDED',
          retryAfter: Math.ceil(entry.getResetTime() / 1000),
        });
      }

      next();
    } catch (error) {
      logger.error(`Batch rate limiter error: ${error.message}`);
      next();
    }
  };
};

/**
 * WebSocket connection rate limiter
 */
const wsConnectionLimiter = (options = {}) => {
  const windowMs = options.windowMs || 60000;
  const maxConnections = options.maxConnections || 5;
  const connectionsStore = new Map();

  return (socket, next) => {
    try {
      const userId = socket.userId || socket.handshake.address;
      const key = `ws:${userId}`;

      if (!connectionsStore.has(key)) {
        connectionsStore.set(key, { count: 0, timestamps: [] });
      }

      const entry = connectionsStore.get(key);
      const now = Date.now();
      entry.timestamps = entry.timestamps.filter((ts) => now - ts < windowMs);

      if (entry.timestamps.length >= maxConnections) {
        logger.warn(`WS connection limit exceeded for ${userId}`);
        return next(new Error('Connection rate limit exceeded'));
      }

      entry.timestamps.push(now);
      next();
    } catch (error) {
      logger.error(`WS rate limiter error: ${error.message}`);
      next();
    }
  };
};

/**
 * Throttle middleware for expensive operations
 */
const throttle = (options = {}) => {
  const windowMs = options.windowMs || 60000;
  const maxRequests = options.maxRequests || 5;
  const store = new Map();

  return (req, res, next) => {
    const key = `${req.route?.path || req.path}:${req.userId || req.ip}`;
    const entry = getOrCreateEntry(store, key, windowMs);
    const count = entry.recordRequest();

    if (count > maxRequests) {
      return res.status(429).json({
        success: false,
        error: 'Request throttled',
        code: 'THROTTLED',
        retryAfter: Math.ceil(entry.getResetTime() / 1000),
      });
    }
    next();
  };
};

/**
 * Get rate limit stats
 */
const getRateLimitStats = () => {
  return {
    general: {
      totalEntries: rateLimitStore.size,
    },
    notifications: {
      totalEntries: notificationRateStore.size,
    },
    batch: {
      totalEntries: batchRateStore.size,
    },
  };
};

/**
 * Reset all rate limit stores (for testing)
 */
const resetRateLimits = () => {
  rateLimitStore.clear();
  notificationRateStore.clear();
  batchRateStore.clear();
};

module.exports = {
  rateLimiter,
  notificationRateLimiter,
  batchRateLimiter,
  wsConnectionLimiter,
  throttle,
  getRateLimitStats,
  resetRateLimits,
  RateLimitEntry,
};
