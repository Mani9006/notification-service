/**
 * Notification delivery service orchestrating multi-channel delivery,
 * batch processing, retry logic, and real-time WebSocket push.
 */

'use strict';

const { Notification, NotificationStatus, NotificationChannel } = require('../models/Notification');
const { withRetry, isRetryableError } = require('../utils/retry');
const { pubsub } = require('../utils/pubsub');
const { logger, logNotificationEvent } = require('../utils/logger');
const config = require('../config');

/**
 * In-memory notification store (use persistent database in production)
 */
const notificationStore = new Map();

// Delivery stats
const deliveryStats = {
  totalDelivered: 0,
  totalFailed: 0,
  byChannel: { in_app: 0, email: 0, push: 0 },
  byPriority: { low: 0, normal: 0, high: 0, urgent: 0 },
  recent: [],
};

/**
 * Get store size
 */
const getStoreSize = () => notificationStore.size;

/**
 * Store a notification
 */
const storeNotification = (notification) => {
  notificationStore.set(notification.id, notification);
  return notification;
};

/**
 * Get notification by ID
 */
const getNotification = (id) => {
  return notificationStore.get(id) || null;
};

/**
 * Get all notifications for a user with optional filtering
 */
const getUserNotifications = (userId, options = {}) => {
  const {
    status = null,
    channel = null,
    priority = null,
    isRead = null,
    category = null,
    search = null,
    tags = null,
    fromDate = null,
    toDate = null,
    page = 1,
    limit = 20,
    sortBy = 'createdAt',
    sortOrder = 'desc',
  } = options;

  let results = Array.from(notificationStore.values())
    .filter((n) => n.userId === userId);

  if (status) results = results.filter((n) => n.status === status);
  if (channel) results = results.filter((n) => n.channel === channel);
  if (priority) results = results.filter((n) => n.priority === priority);
  if (isRead !== null) results = results.filter((n) => n.isRead === isRead);
  if (category) results = results.filter((n) => n.category === category);
  if (search) {
    const s = search.toLowerCase();
    results = results.filter((n) =>
      (n.title && n.title.toLowerCase().includes(s)) ||
      (n.body && n.body.toLowerCase().includes(s))
    );
  }
  if (tags) {
    const tagList = tags.split(',').map((t) => t.trim().toLowerCase());
    results = results.filter((n) =>
      tagList.some((tag) => n.tags.map((t) => t.toLowerCase()).includes(tag))
    );
  }
  if (fromDate) {
    results = results.filter((n) => new Date(n.createdAt) >= new Date(fromDate));
  }
  if (toDate) {
    results = results.filter((n) => new Date(n.createdAt) <= new Date(toDate));
  }

  // Remove expired
  results = results.filter((n) => !n.isExpired() || n.status === NotificationStatus.READ);

  // Sort
  results.sort((a, b) => {
    const aVal = a[sortBy] || '';
    const bVal = b[sortBy] || '';
    if (sortOrder === 'desc') {
      return String(bVal).localeCompare(String(aVal));
    }
    return String(aVal).localeCompare(String(bVal));
  });

  const total = results.length;
  const start = (page - 1) * limit;
  const paginated = results.slice(start, start + limit);

  return {
    notifications: paginated,
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
      hasNext: start + limit < total,
      hasPrev: page > 1,
    },
  };
};

/**
 * Delivery pipeline for in-app channel
 */
const deliverInApp = async (notification, wsRoom) => {
  try {
    notification.markDelivering();
    notification.recordAttempt(true);
    notification.markDelivered();

    // Publish to pub/sub for real-time delivery
    pubsub.publish(`user:${notification.userId}`, {
      type: 'notification',
      notification: notification.toJSON(),
    });

    // Emit to WebSocket room if available
    if (wsRoom) {
      wsRoom.emit('notification:new', notification.toJSON());
    }

    logNotificationEvent('delivery_success', notification, { channel: NotificationChannel.IN_APP });
    return { success: true, channel: NotificationChannel.IN_APP };
  } catch (error) {
    notification.recordAttempt(false, error);
    logNotificationEvent('delivery_failed', notification, { channel: NotificationChannel.IN_APP, error: error.message });
    return { success: false, error: error.message, channel: NotificationChannel.IN_APP };
  }
};

/**
 * Delivery pipeline for email channel (simulated)
 */
const deliverEmail = async (notification) => {
  return withRetry(
    async () => {
      notification.markDelivering();

      // Simulate email delivery
      const simulateDelay = 50 + Math.random() * 100;
      await new Promise((resolve) => setTimeout(resolve, simulateDelay));

      // Simulate occasional failure
      if (Math.random() < 0.02) {
        throw new Error('SMTP connection timeout');
      }

      notification.recordAttempt(true);
      notification.markDelivered();

      logNotificationEvent('delivery_success', notification, { channel: NotificationChannel.EMAIL });
      return { success: true, channel: NotificationChannel.EMAIL };
    },
    {
      context: `email:${notification.id}`,
      maxAttempts: config.retry.maxAttempts,
      circuitBreaker: true,
      circuitBreakerName: 'email-delivery',
    }
  );
};

/**
 * Delivery pipeline for push channel (simulated)
 */
const deliverPush = async (notification) => {
  return withRetry(
    async () => {
      notification.markDelivering();

      // Simulate push delivery
      const simulateDelay = 30 + Math.random() * 70;
      await new Promise((resolve) => setTimeout(resolve, simulateDelay));

      // Simulate occasional failure
      if (Math.random() < 0.015) {
        throw new Error('Push service unavailable');
      }

      notification.recordAttempt(true);
      notification.markDelivered();

      logNotificationEvent('delivery_success', notification, { channel: NotificationChannel.PUSH });
      return { success: true, channel: NotificationChannel.PUSH };
    },
    {
      context: `push:${notification.id}`,
      maxAttempts: config.retry.maxAttempts,
      circuitBreaker: true,
      circuitBreakerName: 'push-delivery',
    }
  );
};

/**
 * Route notification to appropriate channel delivery
 */
const deliverNotification = async (notification, wsRoom = null) => {
  try {
    notification.validate();
  } catch (error) {
    return { success: false, error: error.message, notification: null };
  }

  if (notification.isExpired()) {
    notification.markFailed(new Error('Notification expired'));
    return { success: false, error: 'Notification expired', notification };
  }

  storeNotification(notification);

  let result;
  try {
    switch (notification.channel) {
      case NotificationChannel.IN_APP:
        result = await deliverInApp(notification, wsRoom);
        break;
      case NotificationChannel.EMAIL:
        result = await deliverEmail(notification);
        break;
      case NotificationChannel.PUSH:
        result = await deliverPush(notification);
        break;
      default:
        result = { success: false, error: `Unknown channel: ${notification.channel}` };
    }

    // Update stats
    if (result.success) {
      deliveryStats.totalDelivered++;
      deliveryStats.byChannel[notification.channel] =
        (deliveryStats.byChannel[notification.channel] || 0) + 1;
      deliveryStats.byPriority[notification.priority] =
        (deliveryStats.byPriority[notification.priority] || 0) + 1;

      deliveryStats.recent.push({
        id: notification.id,
        userId: notification.userId,
        channel: notification.channel,
        priority: notification.priority,
        status: 'delivered',
        timestamp: new Date().toISOString(),
      });

      if (deliveryStats.recent.length > 100) {
        deliveryStats.recent = deliveryStats.recent.slice(-50);
      }

      logNotificationEvent('delivery_complete', notification, result);
    } else {
      deliveryStats.totalFailed++;
      if (notification.canRetry()) {
        notification.markRetrying();
        // Schedule retry
        setTimeout(() => retryDelivery(notification, wsRoom), config.retry.baseDelayMs);
      } else {
        notification.markFailed(new Error(result.error));
      }
    }

    return { success: result.success, error: result.error || null, notification };
  } catch (error) {
    deliveryStats.totalFailed++;
    notification.recordAttempt(false, error);

    if (notification.canRetry() && isRetryableError(error)) {
      notification.markRetrying();
      setTimeout(() => retryDelivery(notification, wsRoom), config.retry.baseDelayMs);
      return { success: false, error: error.message, notification, willRetry: true };
    }

    notification.markFailed(error);
    logNotificationEvent('delivery_failed', notification, { error: error.message });
    return { success: false, error: error.message, notification };
  }
};

/**
 * Retry delivery of a failed notification
 */
const retryDelivery = async (notification, wsRoom = null) => {
  logger.info(`Retrying delivery for notification ${notification.id}, attempt ${notification.retryCount + 1}/${notification.maxRetries}`);

  try {
    const result = await deliverNotification(notification, wsRoom);
    if (result.success) {
      logNotificationEvent('retry_success', notification, { attempt: notification.retryCount });
    } else {
      logNotificationEvent('retry_failed', notification, { attempt: notification.retryCount });
    }
    return result;
  } catch (error) {
    logNotificationEvent('retry_failed', notification, { error: error.message });
    return { success: false, error: error.message, notification };
  }
};

/**
 * Create and deliver a notification in one call
 */
const createAndDeliver = async (data, wsRoom = null) => {
  const notification = new Notification(data);
  return deliverNotification(notification, wsRoom);
};

/**
 * Bulk deliver notifications
 */
const bulkDeliver = async (notificationsData, wsRoom = null, options = {}) => {
  const results = [];
  const errors = [];
  const continueOnError = options.continueOnError !== false;

  for (const data of notificationsData) {
    try {
      const result = await createAndDeliver(data, wsRoom);
      results.push(result);
      if (!result.success) {
        errors.push({ notification: data, error: result.error });
        if (!continueOnError) break;
      }
    } catch (error) {
      errors.push({ notification: data, error: error.message });
      results.push({ success: false, error: error.message, notification: null });
      if (!continueOnError) break;
    }
  }

  return {
    total: notificationsData.length,
    succeeded: results.filter((r) => r.success).length,
    failed: results.filter((r) => !r.success).length,
    results,
    errors: errors.length > 0 ? errors : undefined,
  };
};

/**
 * Mark a notification as read
 */
const markAsRead = (notificationId, readerId) => {
  const notification = notificationStore.get(notificationId);
  if (!notification) {
    return { success: false, error: 'Notification not found' };
  }

  notification.markRead(readerId);
  logNotificationEvent('mark_read', notification, { readerId });

  // Publish read event
  pubsub.publish(`user:${notification.userId}:read`, {
    type: 'read_receipt',
    notificationId: notification.id,
    readBy: readerId,
    readAt: notification.readAt,
  });

  return { success: true, notification };
};

/**
 * Mark multiple notifications as read
 */
const bulkMarkAsRead = (notificationIds, readerId) => {
  const results = [];
  for (const id of notificationIds) {
    results.push(markAsRead(id, readerId));
  }
  return {
    total: notificationIds.length,
    succeeded: results.filter((r) => r.success).length,
    failed: results.filter((r) => !r.success).length,
    results,
  };
};

/**
 * Mark a notification as unread
 */
const markAsUnread = (notificationId) => {
  const notification = notificationStore.get(notificationId);
  if (!notification) {
    return { success: false, error: 'Notification not found' };
  }

  notification.markUnread();
  return { success: true, notification };
};

/**
 * Delete a notification
 */
const deleteNotification = (notificationId) => {
  const exists = notificationStore.has(notificationId);
  if (!exists) {
    return { success: false, error: 'Notification not found' };
  }
  notificationStore.delete(notificationId);
  logger.info(`Notification ${notificationId} deleted`);
  return { success: true };
};

/**
 * Get unread count for a user
 */
const getUnreadCount = (userId) => {
  const count = Array.from(notificationStore.values())
    .filter((n) => n.userId === userId && !n.isRead && n.status === NotificationStatus.DELIVERED)
    .length;
  return count;
};

/**
 * Get delivery stats
 */
const getDeliveryStats = () => {
  return {
    ...deliveryStats,
    storeSize: notificationStore.size,
  };
};

/**
 * Clean up old notifications
 */
const cleanupOldNotifications = (retentionDays = config.notification.retentionDays) => {
  const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000);
  let removed = 0;

  for (const [id, notification] of notificationStore.entries()) {
    if (new Date(notification.createdAt) < cutoff) {
      notificationStore.delete(id);
      removed++;
    }
  }

  logger.info(`Cleanup: removed ${removed} old notifications`);
  return { removed };
};

/**
 * Reset store (for testing)
 */
const resetStore = () => {
  notificationStore.clear();
  deliveryStats.totalDelivered = 0;
  deliveryStats.totalFailed = 0;
  deliveryStats.byChannel = { in_app: 0, email: 0, push: 0 };
  deliveryStats.byPriority = { low: 0, normal: 0, high: 0, urgent: 0 };
  deliveryStats.recent = [];
};

module.exports = {
  // Store operations
  storeNotification,
  getNotification,
  getUserNotifications,
  getStoreSize,
  deleteNotification,

  // Delivery
  deliverNotification,
  createAndDeliver,
  bulkDeliver,
  retryDelivery,

  // Read tracking
  markAsRead,
  bulkMarkAsRead,
  markAsUnread,
  getUnreadCount,

  // Stats & cleanup
  getDeliveryStats,
  cleanupOldNotifications,
  resetStore,

  // Channel deliverers (exposed for testing)
  deliverInApp,
  deliverEmail,
  deliverPush,
};
