/**
 * Unit tests for WebSocket modules
 */

'use strict';

const { RoomManager } = require('../src/websocket/rooms');
const { PubSubEngine } = require('../src/utils/pubsub');

describe('WebSocket - RoomManager', () => {
  let manager;

  beforeEach(() => {
    manager = new RoomManager();
  });

  describe('addUserSocket', () => {
    test('should register user socket', () => {
      manager.addUserSocket('user1', 'socket1');

      expect(manager.isUserOnline('user1')).toBe(true);
      expect(manager.getConnectionCount()).toBe(1);
      expect(manager.getUserSockets('user1').has('socket1')).toBe(true);
    });

    test('should handle multiple sockets per user', () => {
      manager.addUserSocket('user1', 'socket1');
      manager.addUserSocket('user1', 'socket2');

      expect(manager.isUserOnline('user1')).toBe(true);
      expect(manager.getUserSockets('user1').size).toBe(2);
      expect(manager.getConnectionCount()).toBe(2);
      expect(manager.getOnlineUserCount()).toBe(1);
    });

    test('should store metadata', () => {
      manager.addUserSocket('user1', 'socket1', { browser: 'Chrome' });

      const meta = manager.socketMeta.get('socket1');
      expect(meta).toBeDefined();
      expect(meta.browser).toBe('Chrome');
    });
  });

  describe('removeSocket', () => {
    test('should remove socket', () => {
      manager.addUserSocket('user1', 'socket1');
      manager.removeSocket('socket1');

      expect(manager.isUserOnline('user1')).toBe(false);
      expect(manager.getConnectionCount()).toBe(0);
    });

    test('should remove socket from rooms', () => {
      manager.addUserSocket('user1', 'socket1');
      manager.joinRoom('room1', 'socket1');

      manager.removeSocket('socket1');

      expect(manager.getRoomMembers('room1').has('socket1')).toBe(false);
    });
  });

  describe('getUserBySocket', () => {
    test('should return user id', () => {
      manager.addUserSocket('user1', 'socket1');
      expect(manager.getUserBySocket('socket1')).toBe('user1');
    });

    test('should return null for unknown socket', () => {
      expect(manager.getUserBySocket('unknown')).toBeNull();
    });
  });

  describe('rooms', () => {
    test('should create room', () => {
      manager.createRoom('room1', 'Test room');
      expect(manager.getRooms()).toContain('room1');
    });

    test('should add socket to room', () => {
      manager.addUserSocket('user1', 'socket1');
      manager.joinRoom('room1', 'socket1');

      expect(manager.getRoomMembers('room1').has('socket1')).toBe(true);
    });

    test('should remove socket from room', () => {
      manager.addUserSocket('user1', 'socket1');
      manager.joinRoom('room1', 'socket1');
      manager.leaveRoom('room1', 'socket1');

      expect(manager.getRoomMembers('room1').has('socket1')).toBe(false);
    });

    test('should leave all rooms', () => {
      manager.addUserSocket('user1', 'socket1');
      manager.joinRoom('room1', 'socket1');
      manager.joinRoom('room2', 'socket1');

      manager.leaveAllRooms('socket1');

      expect(manager.getRoomMembers('room1').size).toBe(0);
      expect(manager.getRoomMembers('room2').size).toBe(0);
    });

    test('should get room info', () => {
      manager.addUserSocket('user1', 'socket1');
      manager.addUserSocket('user2', 'socket2');
      manager.joinRoom('room1', 'socket1');
      manager.joinRoom('room1', 'socket2');

      const info = manager.getRoomInfo('room1');
      expect(info.name).toBe('room1');
      expect(info.memberCount).toBe(2);
    });
  });

  describe('getOnlineUsers', () => {
    test('should list online users', () => {
      manager.addUserSocket('user1', 'socket1');
      manager.addUserSocket('user2', 'socket2');

      const users = manager.getOnlineUsers();
      expect(users.length).toBe(2);
      expect(users.map((u) => u.userId)).toContain('user1');
      expect(users.map((u) => u.userId)).toContain('user2');
    });

    test('should count sockets per user', () => {
      manager.addUserSocket('user1', 'socket1');
      manager.addUserSocket('user1', 'socket2');

      const users = manager.getOnlineUsers();
      expect(users[0].socketCount).toBe(2);
    });
  });

  describe('getStats', () => {
    test('should return stats', () => {
      manager.addUserSocket('user1', 'socket1');
      manager.addUserSocket('user1', 'socket2');
      manager.addUserSocket('user2', 'socket3');
      manager.createRoom('room1');
      manager.joinRoom('room1', 'socket1');

      const stats = manager.getStats();
      expect(stats.totalConnections).toBe(3);
      expect(stats.onlineUsers).toBe(2);
      expect(stats.totalRooms).toBe(1);
    });
  });

  describe('reset', () => {
    test('should clear all data', () => {
      manager.addUserSocket('user1', 'socket1');
      manager.joinRoom('room1', 'socket1');

      manager.reset();

      expect(manager.getConnectionCount()).toBe(0);
      expect(manager.getOnlineUserCount()).toBe(0);
      expect(manager.getRooms().length).toBe(0);
    });
  });
});

describe('PubSubEngine', () => {
  let pubsub;

  beforeEach(() => {
    pubsub = new PubSubEngine();
  });

  describe('subscribe and publish', () => {
    test('should deliver message to subscriber', (done) => {
      const handler = jest.fn((payload, message) => {
        expect(payload).toEqual({ data: 'hello' });
        expect(message.topic).toBe('test.topic');
        done();
      });

      pubsub.subscribe('test.topic', handler);
      pubsub.publish('test.topic', { data: 'hello' });
    });

    test('should deliver to multiple subscribers', () => {
      const handler1 = jest.fn();
      const handler2 = jest.fn();

      pubsub.subscribe('test.topic', handler1);
      pubsub.subscribe('test.topic', handler2);
      pubsub.publish('test.topic', { data: 'hello' });

      expect(handler1).toHaveBeenCalledTimes(1);
      expect(handler2).toHaveBeenCalledTimes(1);
    });

    test('should not deliver to wrong topic', () => {
      const handler = jest.fn();

      pubsub.subscribe('topic.a', handler);
      pubsub.publish('topic.b', { data: 'hello' });

      expect(handler).not.toHaveBeenCalled();
    });

    test('should support once subscription', () => {
      const handler = jest.fn();

      pubsub.subscribe('test.topic', handler, { once: true });
      pubsub.publish('test.topic', { data: 'first' });
      pubsub.publish('test.topic', { data: 'second' });

      expect(handler).toHaveBeenCalledTimes(1);
    });
  });

  describe('pattern subscriptions', () => {
    test('should match wildcard patterns', () => {
      const handler = jest.fn();

      pubsub.subscribePattern('user.*', handler);
      pubsub.publish('user.123', { data: 'hello' });
      pubsub.publish('user.456', { data: 'world' });
      pubsub.publish('order.123', { data: 'no' });

      expect(handler).toHaveBeenCalledTimes(2);
    });
  });

  describe('unsubscribe', () => {
    test('should remove subscriber', () => {
      const handler = jest.fn();

      const unsubscribe = pubsub.subscribe('test.topic', handler);
      unsubscribe();

      pubsub.publish('test.topic', { data: 'hello' });

      expect(handler).not.toHaveBeenCalled();
    });
  });

  describe('history', () => {
    test('should store message history', () => {
      pubsub.publish('test.topic', { data: 1 });
      pubsub.publish('test.topic', { data: 2 });
      pubsub.publish('test.topic', { data: 3 });

      const history = pubsub.getHistory('test.topic', 2);
      expect(history.length).toBe(2);
    });
  });

  describe('namespace', () => {
    test('should create isolated namespace', (done) => {
      const ns1 = pubsub.namespace('app1');
      const ns2 = pubsub.namespace('app2');

      const handler1 = jest.fn();
      const handler2 = jest.fn();

      ns1.subscribe('events', handler1);
      ns2.subscribe('events', handler2);

      ns1.publish('events', { from: 'app1' });

      // handler1 should receive, handler2 should not
      setTimeout(() => {
        expect(handler1).toHaveBeenCalledTimes(1);
        expect(handler2).not.toHaveBeenCalled();
        done();
      }, 50);
    });
  });

  describe('getStats', () => {
    test('should return stats', () => {
      pubsub.subscribe('topic.a', () => {});
      pubsub.subscribe('topic.b', () => {});
      pubsub.publish('topic.a', { data: 1 });
      pubsub.publish('topic.a', { data: 2 });

      const stats = pubsub.getStats();
      expect(stats.totalTopics).toBe(2);
      expect(stats.totalMessages).toBe(2);
    });
  });

  describe('error handling', () => {
    test('should not crash on handler error', () => {
      const badHandler = jest.fn(() => {
        throw new Error('Handler error');
      });
      const goodHandler = jest.fn();

      pubsub.subscribe('test.topic', badHandler);
      pubsub.subscribe('test.topic', goodHandler);

      // Should not throw
      expect(() => {
        pubsub.publish('test.topic', { data: 'test' });
      }).not.toThrow();

      expect(badHandler).toHaveBeenCalled();
      expect(goodHandler).toHaveBeenCalled();
    });

    test('should reject non-function handler', () => {
      expect(() => {
        pubsub.subscribe('test', 'not a function');
      }).toThrow(TypeError);
    });
  });

  describe('flush', () => {
    test('should clear all data', () => {
      pubsub.subscribe('topic.a', () => {});
      pubsub.publish('topic.a', { data: 1 });

      pubsub.flush();

      const stats = pubsub.getStats();
      expect(stats.totalTopics).toBe(0);
      expect(stats.totalMessages).toBe(0);
    });
  });
});
