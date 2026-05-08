/**
 * Authentication middleware supporting JWT tokens, API keys,
 * and mock authentication for development.
 */

'use strict';

const jwt = require('jsonwebtoken');
const config = require('../config');
const { logger } = require('../utils/logger');

// In-memory token blacklist (use Redis in production)
const tokenBlacklist = new Set();

// In-memory API key store (use database in production)
const apiKeys = new Map([
  ['dev-api-key-1', { userId: 'system', role: 'admin', name: 'Development Key' }],
  ['test-api-key-2', { userId: 'tester', role: 'user', name: 'Test Key' }],
]);

/**
 * Extract token from Authorization header
 */
const extractToken = (req) => {
  const authHeader = req.headers.authorization;
  if (!authHeader) return null;

  const parts = authHeader.split(' ');
  if (parts.length === 2 && parts[0].toLowerCase() === 'bearer') {
    return parts[1];
  }

  return null;
};

/**
 * Extract API key from headers
 */
const extractApiKey = (req) => {
  return req.headers['x-api-key'] || req.headers['api-key'] || null;
};

/**
 * JWT authentication middleware
 */
const authenticateJWT = (req, res, next) => {
  try {
    const token = extractToken(req);

    if (!token) {
      return res.status(401).json({
        success: false,
        error: 'Authentication required',
        code: 'NO_TOKEN',
      });
    }

    if (tokenBlacklist.has(token)) {
      return res.status(401).json({
        success: false,
        error: 'Token has been revoked',
        code: 'TOKEN_REVOKED',
      });
    }

    jwt.verify(token, config.jwt.secret, {
      issuer: config.jwt.issuer,
      clockTolerance: 30,
    }, (err, decoded) => {
      if (err) {
        if (err.name === 'TokenExpiredError') {
          return res.status(401).json({
            success: false,
            error: 'Token has expired',
            code: 'TOKEN_EXPIRED',
            expiredAt: err.expiredAt,
          });
        }
        if (err.name === 'JsonWebTokenError') {
          return res.status(401).json({
            success: false,
            error: 'Invalid token',
            code: 'INVALID_TOKEN',
          });
        }
        return res.status(401).json({
          success: false,
          error: 'Token verification failed',
          code: 'TOKEN_VERIFICATION_FAILED',
        });
      }

      req.user = decoded;
      req.user.token = token;
      req.userId = decoded.userId || decoded.sub;
      next();
    });
  } catch (error) {
    logger.error(`Auth middleware error: ${error.message}`);
    return res.status(500).json({
      success: false,
      error: 'Authentication system error',
      code: 'AUTH_ERROR',
    });
  }
};

/**
 * API key authentication middleware
 */
const authenticateApiKey = (req, res, next) => {
  try {
    const apiKey = extractApiKey(req);

    if (!apiKey) {
      return res.status(401).json({
        success: false,
        error: 'API key required',
        code: 'NO_API_KEY',
      });
    }

    const keyData = apiKeys.get(apiKey);
    if (!keyData) {
      return res.status(401).json({
        success: false,
        error: 'Invalid API key',
        code: 'INVALID_API_KEY',
      });
    }

    req.user = {
      userId: keyData.userId,
      role: keyData.role,
      authType: 'api_key',
    };
    req.userId = keyData.userId;
    next();
  } catch (error) {
    logger.error(`API key middleware error: ${error.message}`);
    return res.status(500).json({
      success: false,
      error: 'API key authentication error',
      code: 'AUTH_ERROR',
    });
  }
};

/**
 * Combined authentication (JWT or API key)
 */
const authenticate = (req, res, next) => {
  const token = extractToken(req);
  if (token) {
    return authenticateJWT(req, res, next);
  }

  const apiKey = extractApiKey(req);
  if (apiKey) {
    return authenticateApiKey(req, res, next);
  }

  if (config.nodeEnv === 'development' && req.headers['x-dev-user-id']) {
    req.user = {
      userId: req.headers['x-dev-user-id'],
      role: 'user',
      authType: 'dev',
    };
    req.userId = req.headers['x-dev-user-id'];
    return next();
  }

  return res.status(401).json({
    success: false,
    error: 'Authentication required. Provide JWT token or API key.',
    code: 'UNAUTHENTICATED',
  });
};

/**
 * Role-based authorization middleware
 */
const requireRole = (...roles) => {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        error: 'Authentication required',
        code: 'UNAUTHENTICATED',
      });
    }

    const userRole = req.user.role || 'user';
    if (!roles.includes(userRole)) {
      return res.status(403).json({
        success: false,
        error: `Access denied. Required roles: ${roles.join(', ')}`,
        code: 'FORBIDDEN',
      });
    }

    next();
  };
};

/**
 * Optional authentication (sets user if available)
 */
const optionalAuth = (req, res, next) => {
  const token = extractToken(req);
  if (!token) {
    return next();
  }

  try {
    const decoded = jwt.verify(token, config.jwt.secret, {
      issuer: config.jwt.issuer,
      clockTolerance: 30,
    });
    req.user = decoded;
    req.userId = decoded.userId || decoded.sub;
  } catch {
    // Invalid token, continue without user
  }
  next();
};

/**
 * Generate a JWT token for testing
 */
const generateToken = (payload, options = {}) => {
  return jwt.sign(payload, config.jwt.secret, {
    issuer: config.jwt.issuer,
    expiresIn: options.expiresIn || config.jwt.expiresIn,
    ...options,
  });
};

/**
 * Revoke a token (add to blacklist)
 */
const revokeToken = (token) => {
  tokenBlacklist.add(token);
  logger.info('Token revoked');
  return true;
};

/**
 * Register an API key
 */
const registerApiKey = (key, data) => {
  apiKeys.set(key, data);
};

/**
 * Remove an API key
 */
const removeApiKey = (key) => {
  return apiKeys.delete(key);
};

module.exports = {
  authenticate,
  authenticateJWT,
  authenticateApiKey,
  optionalAuth,
  requireRole,
  generateToken,
  revokeToken,
  registerApiKey,
  removeApiKey,
  extractToken,
  extractApiKey,
};
