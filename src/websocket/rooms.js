/**
 * WebSocket room management for user-scoped notification delivery.
 * Handles user-to-socket mapping, room creation, and broadcast routing.
 */

'use strict';

const { logger } = require('../utils/logger');

/**
 * Room manager for organizing WebSocket connections
 */
class RoomManager {
  constructor() {
    // Map: userId -> Set<socketId>
    this.userSockets = new Map();

    // Map: socketId -> userId
    this.socketUsers = new Map();

    // Named rooms: roomName -> Set<socketId>
    this.rooms = new Map();

    // Socket metadata: socketId -> metadata
    this.socketMeta = new Map();

    // Room metadata: roomName -> { createdAt, description }
    this.roomMeta = new Map();
  }

  /**
   * Register a socket for a user
   */
  addUserSocket(userId, socketId, metadata = {}) {
    if (!this.userSockets.has(userId)) {
      this.userSockets.set(userId, new Set());
    }
    this.userSockets.get(userId).add(socketId);
    this.socketUsers.set(socketId, userId);
    this.socketMeta.set(socketId, {
      connectedAt: new Date().toISOString(),
      ...metadata,
    });

    logger.debug(`Socket ${socketId} registered for user ${userId}`);
    return this;
  }

  /**
   * Remove a socket
   */
  removeSocket(socketId) {
    const userId = this.socketUsers.get(socketId);

    if (userId) {
      const sockets = this.userSockets.get(userId);
      if (sockets) {
        sockets.delete(socketId);
        if (sockets.size === 0) {
          this.userSockets.delete(userId);
        }
      }
      this.socketUsers.delete(socketId);
    }

    // Remove from all rooms
    for (const [roomName, members] of this.rooms.entries()) {
      members.delete(socketId);
      if (members.size === 0) {
        this.rooms.delete(roomName);
        this.roomMeta.delete(roomName);
      }
    }

    this.socketMeta.delete(socketId);
    logger.debug(`Socket ${socketId} removed`);
    return this;
  }

  /**
   * Get user ID for a socket
   */
  getUserBySocket(socketId) {
    return this.socketUsers.get(socketId) || null;
  }

  /**
   * Get all sockets for a user
   */
  getUserSockets(userId) {
    return this.userSockets.get(userId) || new Set();
  }

  /**
   * Check if user has active sockets
   */
  isUserOnline(userId) {
    const sockets = this.userSockets.get(userId);
    return sockets && sockets.size > 0;
  }

  /**
   * Create a named room
   */
  createRoom(roomName, description = '') {
    if (!this.rooms.has(roomName)) {
      this.rooms.set(roomName, new Set());
      this.roomMeta.set(roomName, {
        createdAt: new Date().toISOString(),
        description,
        memberCount: 0,
      });
    }
    return this;
  }

  /**
   * Add socket to a room
   */
  joinRoom(roomName, socketId) {
    this.createRoom(roomName);
    this.rooms.get(roomName).add(socketId);
    this.roomMeta.get(roomName).memberCount = this.rooms.get(roomName).size;
    logger.debug(`Socket ${socketId} joined room ${roomName}`);
    return this;
  }

  /**
   * Remove socket from a room
   */
  leaveRoom(roomName, socketId) {
    const members = this.rooms.get(roomName);
    if (members) {
      members.delete(socketId);
      this.roomMeta.get(roomName).memberCount = members.size;
      if (members.size === 0) {
        this.rooms.delete(roomName);
        this.roomMeta.delete(roomName);
      }
    }
    return this;
  }

  /**
   * Leave all rooms for a socket
   */
  leaveAllRooms(socketId) {
    for (const [roomName] of this.rooms.entries()) {
      this.leaveRoom(roomName, socketId);
    }
    return this;
  }

  /**
   * Get room members
   */
  getRoomMembers(roomName) {
    return this.rooms.get(roomName) || new Set();
  }

  /**
   * Get room list
   */
  getRooms() {
    return Array.from(this.rooms.keys());
  }

  /**
   * Get room info
   */
  getRoomInfo(roomName) {
    const members = this.rooms.get(roomName);
    if (!members) return null;

    return {
      name: roomName,
      memberCount: members.size,
      members: Array.from(members),
      ...this.roomMeta.get(roomName),
    };
  }

  /**
   * Get all online users
   */
  getOnlineUsers() {
    const users = [];
    for (const [userId, sockets] of this.userSockets.entries()) {
      users.push({
        userId,
        socketCount: sockets.size,
      });
    }
    return users;
  }

  /**
   * Get total connection count
   */
  getConnectionCount() {
    return this.socketUsers.size;
  }

  /**
   * Get total online users
   */
  getOnlineUserCount() {
    return this.userSockets.size;
  }

  /**
   * Get stats
   */
  getStats() {
    return {
      totalConnections: this.getConnectionCount(),
      onlineUsers: this.getOnlineUserCount(),
      totalRooms: this.rooms.size,
      rooms: Array.from(this.roomMeta.entries()).map(([name, meta]) => ({
        name,
        memberCount: meta.memberCount,
        createdAt: meta.createdAt,
      })),
    };
  }

  /**
   * Reset (for testing)
   */
  reset() {
    this.userSockets.clear();
    this.socketUsers.clear();
    this.rooms.clear();
    this.socketMeta.clear();
    this.roomMeta.clear();
  }
}

// Singleton
const roomManager = new RoomManager();

module.exports = {
  RoomManager,
  roomManager,
};
