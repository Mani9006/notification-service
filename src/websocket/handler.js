/**
 * WebSocket event handler for Socket.IO connections.
 * Manages authentication, room joining, notification delivery,
 * and bidirectional communication.
 */

'use strict';

const { roomManager } = require('./rooms');
const { pubsub } = require('../utils/pubsub');
const { logger } = require('../utils/logger');
const { authenticate } = require('../middleware/auth');
const { wsConnectionLimiter } = require('../middleware/rateLimiter');
const { getUnreadCount, markAsRead } = require('../services/deliveryService');
const { trackEvent } = require('../services/analyticsService');

/**
 * Authentication middleware for Socket.IO
 */
const wsAuthMiddleware = (socket, next) => {
  try {
    // Extract auth info from handshake
    const token = socket.handshake.auth?.token || socket.handshake.query?.token;
    const apiKey = socket.handshake.auth?.apiKey || socket.handshake.headers?.['x-api-key'];
    const userId = socket.handshake.auth?.userId;

    // Development bypass
    if (process.env.NODE_ENV === 'development' && socket.handshake.auth?.devUserId) {
      socket.userId = socket.handshake.auth.devUserId;
      socket.authType = 'dev';
      socket.role = 'user';
      return next();
    }

    // API key auth
    if (apiKey) {
      // Simple API key check (same as REST auth)
      const validKeys = ['dev-api-key-1', 'test-api-key-2'];
      if (validKeys.includes(apiKey)) {
        socket.userId = userId || 'api-user';
        socket.authType = 'api_key';
        socket.role = 'user';
        return next();
      }
      return next(new Error('Invalid API key'));
    }

    // JWT token auth
    if (token) {
      try {
        const jwt = require('jsonwebtoken');
        const config = require('../config');
        const decoded = jwt.verify(token, config.jwt.secret, {
          issuer: config.jwt.issuer,
        });
        socket.userId = decoded.userId || decoded.sub;
        socket.authType = 'jwt';
        socket.role = decoded.role || 'user';
        return next();
      } catch (err) {
        return next(new Error('Invalid or expired token'));
      }
    }

    // Fallback: accept with anonymous user if userId provided
    if (userId) {
      socket.userId = userId;
      socket.authType = 'anonymous';
      socket.role = 'user';
      return next();
    }

    return next(new Error('Authentication required'));
  } catch (error) {
    logger.error(`WS auth error: ${error.message}`);
    return next(new Error('Authentication error'));
  }
};

/**
 * Handle new socket connection
 */
const handleConnection = (io, socket) => {
  const userId = socket.userId;
  const socketId = socket.id;

  logger.info(`WebSocket connected: ${socketId} (user: ${userId})`);

  // Register socket in room manager
  roomManager.addUserSocket(userId, socketId, {
    authType: socket.authType,
    role: socket.role,
    connectedAt: new Date().toISOString(),
    clientInfo: socket.handshake.headers['user-agent'],
  });

  // Join user's personal room
  const userRoom = `user:${userId}`;
  socket.join(userRoom);
  roomManager.joinRoom(userRoom, socketId);

  // Track connection event
  trackEvent('ws_connect', null, { userId, socketId });

  // Send welcome and initial data
  socket.emit('connection:established', {
    socketId: socket.id,
    userId,
    timestamp: new Date().toISOString(),
  });

  // Send unread count
  const unreadCount = getUnreadCount(userId);
  socket.emit('notification:unread_count', { count: unreadCount });

  // Subscribe to user's notification channel via pub/sub
  const unsubscribe = pubsub.subscribe(`user:${userId}`, (payload) => {
    socket.emit('notification:incoming', payload);
  });

  /**
   * Handle notification:read event
   */
  socket.on('notification:read', (data, callback) => {
    try {
      const { notificationId } = data;
      if (!notificationId) {
        return callback && callback({ success: false, error: 'notificationId required' });
      }

      const result = markAsRead(notificationId, userId);
      if (result.success) {
        trackEvent('read', result.notification);

        // Broadcast read receipt to user's other devices
        io.to(`user:${userId}`).emit('notification:read_receipt', {
          notificationId: result.notification.id,
          readAt: result.notification.readAt,
        });

        // Update unread count
        const newCount = getUnreadCount(userId);
        socket.emit('notification:unread_count', { count: newCount });
      }

      callback && callback(result);
    } catch (error) {
      logger.error(`notification:read error: ${error.message}`);
      callback && callback({ success: false, error: error.message });
    }
  });

  /**
   * Handle notification:read_all event
   */
  socket.on('notification:read_all', (data, callback) => {
    try {
      const { notificationIds } = data;
      if (!Array.isArray(notificationIds) || notificationIds.length === 0) {
        return callback && callback({ success: false, error: 'notificationIds array required' });
      }

      const { bulkMarkAsRead } = require('../services/deliveryService');
      const result = bulkMarkAsRead(notificationIds, userId);

      if (result.succeeded > 0) {
        const newCount = getUnreadCount(userId);
        io.to(`user:${userId}`).emit('notification:unread_count', { count: newCount });
      }

      callback && callback(result);
    } catch (error) {
      logger.error(`notification:read_all error: ${error.message}`);
      callback && callback({ success: false, error: error.message });
    }
  });

  /**
   * Handle room:join event
   */
  socket.on('room:join', (data, callback) => {
    try {
      const { room } = data;
      if (!room) {
        return callback && callback({ success: false, error: 'room name required' });
      }

      socket.join(room);
      roomManager.joinRoom(room, socketId);

      logger.debug(`User ${userId} joined room ${room}`);
      socket.to(room).emit('room:member_joined', { room, userId });

      callback && callback({
        success: true,
        room,
        members: roomManager.getRoomMembers(room).size,
      });
    } catch (error) {
      callback && callback({ success: false, error: error.message });
    }
  });

  /**
   * Handle room:leave event
   */
  socket.on('room:leave', (data, callback) => {
    try {
      const { room } = data;
      if (!room) {
        return callback && callback({ success: false, error: 'room name required' });
      }

      socket.leave(room);
      roomManager.leaveRoom(room, socketId);

      logger.debug(`User ${userId} left room ${room}`);
      socket.to(room).emit('room:member_left', { room, userId });

      callback && callback({ success: true, room });
    } catch (error) {
      callback && callback({ success: false, error: error.message });
    }
  });

  /**
   * Handle typing indicator
   */
  socket.on('typing:start', (data) => {
    const { room } = data;
    if (room) {
      socket.to(room).emit('typing:update', { userId, room, typing: true });
    }
  });

  socket.on('typing:stop', (data) => {
    const { room } = data;
    if (room) {
      socket.to(room).emit('typing:update', { userId, room, typing: false });
    }
  });

  /**
   * Handle ping/pong for connection health
   */
  socket.on('ping', (callback) => {
    callback && callback({ pong: true, timestamp: Date.now() });
  });

  /**
   * Handle subscription to topics
   */
  socket.on('subscribe:topic', (data, callback) => {
    try {
      const { topic } = data;
      if (!topic) {
        return callback && callback({ success: false, error: 'topic required' });
      }

      const topicRoom = `topic:${topic}`;
      socket.join(topicRoom);
      roomManager.joinRoom(topicRoom, socketId);

      logger.debug(`User ${userId} subscribed to topic ${topic}`);
      callback && callback({ success: true, topic });
    } catch (error) {
      callback && callback({ success: false, error: error.message });
    }
  });

  socket.on('unsubscribe:topic', (data, callback) => {
    try {
      const { topic } = data;
      if (!topic) {
        return callback && callback({ success: false, error: 'topic required' });
      }

      const topicRoom = `topic:${topic}`;
      socket.leave(topicRoom);
      roomManager.leaveRoom(topicRoom, socketId);

      callback && callback({ success: true, topic });
    } catch (error) {
      callback && callback({ success: false, error: error.message });
    }
  });

  /**
   * Handle disconnect
   */
  socket.on('disconnect', (reason) => {
    logger.info(`WebSocket disconnected: ${socketId} (user: ${userId}, reason: ${reason})`);

    trackEvent('ws_disconnect', null, { userId, socketId, reason });

    // Clean up
    roomManager.removeSocket(socketId);
    unsubscribe();

    // Notify other users in shared rooms
    io.emit('user:offline', { userId });
  });

  /**
   * Handle errors
   */
  socket.on('error', (error) => {
    logger.error(`Socket ${socketId} error: ${error.message}`);
  });
};

/**
 * Initialize Socket.IO handlers
 */
const initializeWebSocket = (io) => {
  // Apply auth middleware
  io.use(wsAuthMiddleware);

  // Apply connection rate limiter
  io.use(wsConnectionLimiter({
    windowMs: 60000,
    maxConnections: 5,
  }));

  // Handle connections
  io.on('connection', (socket) => {
    handleConnection(io, socket);
  });

  logger.info('WebSocket handlers initialized');
};

/**
 * Broadcast to all connected clients
 */
const broadcast = (io, event, data) => {
  io.emit(event, data);
};

/**
 * Send to specific user
 */
const sendToUser = (io, userId, event, data) => {
  io.to(`user:${userId}`).emit(event, data);
};

/**
 * Send to specific room
 */
const sendToRoom = (io, room, event, data) => {
  io.to(room).emit(event, data);
};

module.exports = {
  initializeWebSocket,
  handleConnection,
  wsAuthMiddleware,
  broadcast,
  sendToUser,
  sendToRoom,
};
