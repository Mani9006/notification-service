/**
 * Retry utility with configurable exponential backoff,
 * jitter, circuit breaker pattern, and per-strategy customization.
 */

'use strict';

const { logger } = require('./logger');
const config = require('../config');

/**
 * Calculate delay with exponential backoff and optional jitter
 */
const calculateDelay = (attempt, options = {}) => {
  const baseDelay = options.baseDelayMs || config.retry.baseDelayMs;
  const maxDelay = options.maxDelayMs || config.retry.maxDelayMs;
  const multiplier = options.backoffMultiplier || config.retry.backoffMultiplier;
  const jitter = options.jitter !== undefined ? options.jitter : true;

  // Exponential: base * multiplier^attempt
  let delay = baseDelay * Math.pow(multiplier, attempt - 1);

  // Cap at max
  delay = Math.min(delay, maxDelay);

  // Apply jitter (random 0-30%)
  if (jitter) {
    const jitterFactor = 1 - (Math.random() * 0.3);
    delay = Math.floor(delay * jitterFactor);
  }

  return delay;
};

/**
 * Sleep helper for async delay
 */
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Check if an error is retryable
 */
const isRetryableError = (error, options = {}) => {
  const nonRetryableCodes = options.nonRetryableCodes || [
    'ENOTFOUND',
    'EACCES',
    'EPERM',
    'EINVALID',
  ];

  // Network errors are generally retryable
  if (error.code && nonRetryableCodes.includes(error.code)) {
    return false;
  }

  // 4xx client errors are not retryable
  if (error.statusCode && error.statusCode >= 400 && error.statusCode < 500) {
    return false;
  }

  // Validation errors
  if (error.name === 'ValidationError') {
    return false;
  }

  return true;
};

/**
 * Circuit breaker for preventing repeated retries on failing services
 */
class CircuitBreaker {
  constructor(name, options = {}) {
    this.name = name;
    this.failureThreshold = options.failureThreshold || 5;
    this.recoveryTimeout = options.recoveryTimeout || 30000;
    this.state = 'CLOSED'; // CLOSED, OPEN, HALF_OPEN
    this.failureCount = 0;
    this.lastFailureTime = null;
    this.successCount = 0;
    this.halfOpenSuccessThreshold = options.halfOpenSuccessThreshold || 2;
  }

  /**
   * Check if the circuit allows requests
   */
  canExecute() {
    if (this.state === 'CLOSED') {
      return true;
    }

    if (this.state === 'OPEN') {
      const timeSinceFailure = Date.now() - this.lastFailureTime;
      if (timeSinceFailure >= this.recoveryTimeout) {
        this.state = 'HALF_OPEN';
        this.failureCount = 0;
        logger.info(`Circuit breaker '${this.name}' entering HALF_OPEN`);
        return true;
      }
      return false;
    }

    // HALF_OPEN: allow limited requests
    return true;
  }

  /**
   * Record a successful execution
   */
  recordSuccess() {
    if (this.state === 'HALF_OPEN') {
      this.successCount++;
      if (this.successCount >= this.halfOpenSuccessThreshold) {
        this.closeCircuit();
      }
    } else {
      this.failureCount = 0;
    }
  }

  /**
   * Record a failed execution
   */
  recordFailure() {
    this.failureCount++;
    this.lastFailureTime = Date.now();

    if (this.state === 'HALF_OPEN') {
      this.openCircuit();
      return;
    }

    if (this.failureCount >= this.failureThreshold) {
      this.openCircuit();
    }
  }

  openCircuit() {
    this.state = 'OPEN';
    this.successCount = 0;
    logger.warn(`Circuit breaker '${this.name}' OPENED after ${this.failureCount} failures`);
  }

  closeCircuit() {
    this.state = 'CLOSED';
    this.failureCount = 0;
    this.successCount = 0;
    logger.info(`Circuit breaker '${this.name}' CLOSED`);
  }

  getStats() {
    return {
      name: this.name,
      state: this.state,
      failureCount: this.failureCount,
      successCount: this.successCount,
      lastFailureTime: this.lastFailureTime,
    };
  }
}

// Global circuit breaker registry
const circuitBreakers = new Map();

/**
 * Get or create a circuit breaker
 */
const getCircuitBreaker = (name, options) => {
  if (!circuitBreakers.has(name)) {
    circuitBreakers.set(name, new CircuitBreaker(name, options));
  }
  return circuitBreakers.get(name);
};

/**
 * Execute a function with retry logic
 */
const withRetry = async (fn, options = {}) => {
  const maxAttempts = options.maxAttempts || config.retry.maxAttempts;
  const context = options.context || 'retry';
  const useCircuitBreaker = options.circuitBreaker || false;
  const cbName = options.circuitBreakerName || context;

  let cb = null;
  if (useCircuitBreaker) {
    cb = getCircuitBreaker(cbName);
    if (!cb.canExecute()) {
      throw new Error(`Circuit breaker '${cbName}' is OPEN`);
    }
  }

  let lastError;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const result = await fn();

      if (cb) {
        cb.recordSuccess();
      }

      if (attempt > 1) {
        logger.info(`${context} succeeded on attempt ${attempt}`);
      }

      return result;
    } catch (error) {
      lastError = error;

      if (!isRetryableError(error, options)) {
        if (cb) cb.recordFailure();
        throw error;
      }

      if (cb) cb.recordFailure();

      if (attempt === maxAttempts) {
        logger.error(`${context} failed after ${maxAttempts} attempts: ${error.message}`);
        throw error;
      }

      const delay = calculateDelay(attempt, options);
      logger.warn(`${context} attempt ${attempt}/${maxAttempts} failed: ${error.message}. Retrying in ${delay}ms`);
      await sleep(delay);
    }
  }

  throw lastError;
};

/**
 * Reset all circuit breakers (useful in testing)
 */
const resetCircuitBreakers = () => {
  circuitBreakers.forEach((cb) => cb.closeCircuit());
  logger.info('All circuit breakers reset');
};

/**
 * Get stats for all circuit breakers
 */
const getCircuitBreakerStats = () => {
  return Array.from(circuitBreakers.entries()).map(([name, cb]) => ({
    name,
    ...cb.getStats(),
  }));
};

module.exports = {
  withRetry,
  calculateDelay,
  CircuitBreaker,
  getCircuitBreaker,
  resetCircuitBreakers,
  getCircuitBreakerStats,
  isRetryableError,
  sleep,
};
