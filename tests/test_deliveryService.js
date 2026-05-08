/**
 * Unit tests for the delivery service
 */

'use strict';

const {
  createAndDeliver,
  bulkDeliver,
  getNotification,
  getUserNotifications,
  markAsRead,
  markAsUnread,
  deleteNotification,
  getUnreadCount,
  resetStore,
} = require('../src/services/deliveryService');

const { resetCircuitBreakers } = require('../src/utils/retry');
const { resetAnalytics } = require('../src/services/analyticsService');

describe('DeliveryService', () => {
  const testUserId = 'user_test_1';

  beforeEach(() => {
    resetStore();
    resetCircuitBreakers();
    resetAnalytics();
  });

  afterEach(() => {
    jest.clearAllTimers();
  });

  describe('createAndDeliver', () => {
    test('should create and deliver in_app notification', async () => {
      const result = await createAndDeliver({
        userId: testUserId,
        title: 'Test Notification',
        body: 'This is a test notification',
        channel: 'in_app',
      });

      expect(result.success).toBe(true);
      expect(result.notification).toBeDefined();
      expect(result.notification.title).toBe('Test Notification');
      expect(result.notification.status).toBe('delivered');
    });

    test('should create and deliver email notification', async () => {
      const result = await createAndDeliver({
        userId: testUserId,
        title: 'Email Test',
        body: 'This is an email notification',
        channel: 'email',
      });

      expect(result.success).toBe(true);
      expect(result.notification.channel).toBe('email');
    }, 10000);

    test('should create and deliver push notification', async () => {
      const result = await createAndDeliver({
        userId: testUserId,
        title: 'Push Test',
        body: 'This is a push notification',
        channel: 'push',
      });

      expect(result.success).toBe(true);
      expect(result.notification.channel).toBe('push');
    }, 10000);

    test('should fail with missing userId', async () => {
      const result = await createAndDeliver({
        title: 'Test',
        body: 'Body',
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('userId');
    });

    test('should fail with missing title', async () => {
      const result = await createAndDeliver({
        userId: testUserId,
        body: 'Body',
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('title');
    });

    test('should fail with missing body', async () => {
      const result = await createAndDeliver({
        userId: testUserId,
        title: 'Title',
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('body');
    });

    test('should respect priority levels', async () => {
      const priorities = ['low', 'normal', 'high', 'urgent'];

      for (const priority of priorities) {
        const result = await createAndDeliver({
          userId: testUserId,
          title: `${priority} priority`,
          body: 'Test body',
          priority,
        });

        expect(result.success).toBe(true);
        expect(result.notification.priority).toBe(priority);
      }
    });

    test('should store notification metadata', async () => {
      const result = await createAndDeliver({
        userId: testUserId,
        title: 'Meta test',
        body: 'Body',
        metadata: { source: 'test', jobId: '123' },
        tags: ['test', 'important'],
      });

      expect(result.success).toBe(true);
      expect(result.notification.metadata).toEqual({
        source: 'test',
        jobId: '123',
      });
      expect(result.notification.tags).toEqual(['test', 'important']);
    });
  });

  describe('getNotification', () => {
    test('should retrieve notification by id', async () => {
      const { notification: created } = await createAndDeliver({
        userId: testUserId,
        title: 'Retrieval test',
        body: 'Body',
      });

      const retrieved = getNotification(created.id);
      expect(retrieved).toBeDefined();
      expect(retrieved.id).toBe(created.id);
    });

    test('should return null for non-existent id', () => {
      const result = getNotification('non_existent_id');
      expect(result).toBeNull();
    });
  });

  describe('getUserNotifications', () => {
    test('should paginate results', async () => {
      for (let i = 0; i < 15; i++) {
        await createAndDeliver({
          userId: testUserId,
          title: `Notification ${i}`,
          body: 'Body',
        });
      }

      const page1 = getUserNotifications(testUserId, { page: 1, limit: 10 });
      expect(page1.notifications.length).toBe(10);
      expect(page1.pagination.total).toBe(15);
      expect(page1.pagination.hasNext).toBe(true);

      const page2 = getUserNotifications(testUserId, { page: 2, limit: 10 });
      expect(page2.notifications.length).toBe(5);
      expect(page2.pagination.hasNext).toBe(false);
    });

    test('should filter by status', async () => {
      await createAndDeliver({ userId: testUserId, title: 'Delivered', body: 'Body' });

      const result = getUserNotifications(testUserId, { status: 'delivered' });
      expect(result.notifications.length).toBeGreaterThan(0);
    });

    test('should filter by priority', async () => {
      await createAndDeliver({
        userId: testUserId,
        title: 'High priority',
        body: 'Body',
        priority: 'high',
      });

      const result = getUserNotifications(testUserId, { priority: 'high' });
      expect(result.notifications.length).toBeGreaterThan(0);
      expect(result.notifications[0].priority).toBe('high');
    });

    test('should search in title and body', async () => {
      await createAndDeliver({
        userId: testUserId,
        title: 'Searchable title',
        body: 'Body text',
      });

      const result = getUserNotifications(testUserId, { search: 'searchable' });
      expect(result.notifications.length).toBeGreaterThan(0);
    });

    test('should filter by tags', async () => {
      await createAndDeliver({
        userId: testUserId,
        title: 'Tagged',
        body: 'Body',
        tags: ['important', 'system'],
      });

      const result = getUserNotifications(testUserId, { tags: 'important' });
      expect(result.notifications.length).toBeGreaterThan(0);
    });

    test('should sort results', async () => {
      await createAndDeliver({ userId: testUserId, title: 'A', body: 'Body' });
      await createAndDeliver({ userId: testUserId, title: 'B', body: 'Body' });

      const asc = getUserNotifications(testUserId, {
        sortBy: 'title',
        sortOrder: 'asc',
      });
      expect(asc.notifications[0].title).toBe('A');

      const desc = getUserNotifications(testUserId, {
        sortBy: 'title',
        sortOrder: 'desc',
      });
      expect(desc.notifications[0].title).toBe('B');
    });
  });

  describe('markAsRead', () => {
    test('should mark notification as read', async () => {
      const { notification: created } = await createAndDeliver({
        userId: testUserId,
        title: 'Read test',
        body: 'Body',
      });

      const result = markAsRead(created.id, testUserId);
      expect(result.success).toBe(true);
      expect(result.notification.isRead).toBe(true);
      expect(result.notification.readAt).toBeDefined();
    });

    test('should return error for non-existent notification', () => {
      const result = markAsRead('fake_id', testUserId);
      expect(result.success).toBe(false);
      expect(result.error).toContain('not found');
    });
  });

  describe('markAsUnread', () => {
    test('should mark notification as unread', async () => {
      const { notification: created } = await createAndDeliver({
        userId: testUserId,
        title: 'Unread test',
        body: 'Body',
      });

      markAsRead(created.id, testUserId);
      const result = markAsUnread(created.id);
      expect(result.success).toBe(true);
      expect(result.notification.isRead).toBe(false);
    });
  });

  describe('deleteNotification', () => {
    test('should delete notification', async () => {
      const { notification: created } = await createAndDeliver({
        userId: testUserId,
        title: 'Delete test',
        body: 'Body',
      });

      const result = deleteNotification(created.id);
      expect(result.success).toBe(true);

      const retrieved = getNotification(created.id);
      expect(retrieved).toBeNull();
    });

    test('should return error for non-existent notification', () => {
      const result = deleteNotification('fake_id');
      expect(result.success).toBe(false);
      expect(result.error).toContain('not found');
    });
  });

  describe('getUnreadCount', () => {
    test('should return correct unread count', async () => {
      for (let i = 0; i < 5; i++) {
        await createAndDeliver({
          userId: testUserId,
          title: `Notification ${i}`,
          body: 'Body',
        });
      }

      const count = getUnreadCount(testUserId);
      expect(count).toBe(5);

      // Mark some as read
      const notifications = getUserNotifications(testUserId, { isRead: false });
      markAsRead(notifications.notifications[0].id, testUserId);

      const newCount = getUnreadCount(testUserId);
      expect(newCount).toBe(4);
    });
  });

  describe('bulkDeliver', () => {
    test('should deliver multiple notifications', async () => {
      const notifications = [
        { userId: testUserId, title: 'Bulk 1', body: 'Body 1' },
        { userId: testUserId, title: 'Bulk 2', body: 'Body 2' },
        { userId: testUserId, title: 'Bulk 3', body: 'Body 3' },
      ];

      const result = await bulkDeliver(notifications);
      expect(result.total).toBe(3);
      expect(result.succeeded).toBe(3);
      expect(result.failed).toBe(0);
    });

    test('should continue on error when configured', async () => {
      const notifications = [
        { userId: testUserId, title: 'OK', body: 'Body' },
        { userId: null, title: null, body: null },
        { userId: testUserId, title: 'OK 2', body: 'Body 2' },
      ];

      const result = await bulkDeliver(notifications, null, { continueOnError: true });
      expect(result.total).toBe(3);
      expect(result.succeeded).toBe(2);
      expect(result.failed).toBe(1);
    });
  });
});
