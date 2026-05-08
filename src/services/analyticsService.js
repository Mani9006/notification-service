/**
 * Notification analytics service providing insights,
 * metrics aggregation, and reporting capabilities.
 */

'use strict';

const { logger } = require('../utils/logger');
const { getDeliveryStats } = require('./deliveryService');
const { getTemplateStats } = require('./templateService');
const { getSchedulerStats } = require('./schedulerService');
const { getCircuitBreakerStats } = require('../utils/retry');
const { pubsub } = require('../utils/pubsub');

// In-memory analytics store with time-based buckets
const hourlyBuckets = new Map();
const dailyBuckets = new Map();
const channelHourly = new Map();
const userEngagement = new Map();

// Event log for real-time tracking
const recentEvents = [];
const MAX_EVENTS = 1000;

// Analytics subscribers
const analyticsSubscribers = new Set();

/**
 * Get or create a time bucket
 */
const getOrCreateBucket = (store, key) => {
  if (!store.has(key)) {
    store.set(key, {
      key,
      totalSent: 0,
      totalDelivered: 0,
      totalRead: 0,
      totalFailed: 0,
      byChannel: { in_app: 0, email: 0, push: 0 },
      byPriority: { low: 0, normal: 0, high: 0, urgent: 0 },
      byStatus: {},
      byCategory: {},
      uniqueUsers: new Set(),
      timestamp: new Date().toISOString(),
    });
  }
  return store.get(key);
};

/**
 * Get current hour bucket key
 */
const getHourKey = () => {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}_${String(now.getHours()).padStart(2, '0')}`;
};

/**
 * Get current day bucket key
 */
const getDayKey = () => {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
};

/**
 * Track a notification event
 */
const trackEvent = (eventType, notification, metadata = {}) => {
  const event = {
    id: `evt_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
    type: eventType,
    notificationId: notification?.id,
    userId: notification?.userId,
    channel: notification?.channel,
    priority: notification?.priority,
    category: notification?.category,
    status: notification?.status,
    metadata,
    timestamp: new Date().toISOString(),
  };

  recentEvents.push(event);
  if (recentEvents.length > MAX_EVENTS) {
    recentEvents.shift();
  }

  // Update hourly bucket
  const hourBucket = getOrCreateBucket(hourlyBuckets, getHourKey());
  const dayBucket = getOrCreateBucket(dailyBuckets, getDayKey());

  hourBucket.totalSent++;
  dayBucket.totalSent++;

  if (notification?.channel) {
    hourBucket.byChannel[notification.channel] = (hourBucket.byChannel[notification.channel] || 0) + 1;
    dayBucket.byChannel[notification.channel] = (dayBucket.byChannel[notification.channel] || 0) + 1;
  }

  if (notification?.priority) {
    hourBucket.byPriority[notification.priority] = (hourBucket.byPriority[notification.priority] || 0) + 1;
    dayBucket.byPriority[notification.priority] = (dayBucket.byPriority[notification.priority] || 0) + 1;
  }

  if (notification?.status) {
    hourBucket.byStatus[notification.status] = (hourBucket.byStatus[notification.status] || 0) + 1;
    dayBucket.byStatus[notification.status] = (dayBucket.byStatus[notification.status] || 0) + 1;
  }

  if (notification?.category) {
    hourBucket.byCategory[notification.category] = (hourBucket.byCategory[notification.category] || 0) + 1;
    dayBucket.byCategory[notification.category] = (dayBucket.byCategory[notification.category] || 0) + 1;
  }

  if (notification?.userId) {
    hourBucket.uniqueUsers.add(notification.userId);
    dayBucket.uniqueUsers.add(notification.userId);
  }

  // Update user engagement
  if (notification?.userId) {
    if (!userEngagement.has(notification.userId)) {
      userEngagement.set(notification.userId, {
        userId: notification.userId,
        totalReceived: 0,
        totalRead: 0,
        lastActive: null,
        channels: { in_app: 0, email: 0, push: 0 },
        categories: {},
      });
    }
    const engagement = userEngagement.get(notification.userId);
    engagement.totalReceived++;
    if (notification.channel) {
      engagement.channels[notification.channel] = (engagement.channels[notification.channel] || 0) + 1;
    }
    if (notification.category) {
      engagement.categories[notification.category] = (engagement.categories[notification.category] || 0) + 1;
    }
    engagement.lastActive = new Date().toISOString();
  }

  // Track delivery/read events
  if (eventType === 'delivered') {
    hourBucket.totalDelivered++;
    dayBucket.totalDelivered++;
  } else if (eventType === 'read') {
    hourBucket.totalRead++;
    dayBucket.totalRead++;
    if (notification?.userId) {
      const engagement = userEngagement.get(notification.userId);
      if (engagement) engagement.totalRead++;
    }
  } else if (eventType === 'failed') {
    hourBucket.totalFailed++;
    dayBucket.totalFailed++;
  }

  // Notify subscribers
  analyticsSubscribers.forEach((callback) => {
    try {
      callback(event);
    } catch (err) {
      logger.error(`Analytics subscriber error: ${err.message}`);
    }
  });

  // Publish to pub/sub
  pubsub.publish('analytics:event', event);

  return event;
};

/**
 * Subscribe to analytics events
 */
const subscribe = (callback) => {
  analyticsSubscribers.add(callback);
  return () => analyticsSubscribers.delete(callback);
};

/**
 * Get dashboard overview metrics
 */
const getDashboard = () => {
  const delivery = getDeliveryStats();
  const templates = getTemplateStats();
  const scheduler = getSchedulerStats();
  const circuitBreakers = getCircuitBreakerStats();

  // Calculate read rate
  const totalRead = Array.from(dailyBuckets.values()).reduce((sum, b) => sum + (b.totalRead || 0), 0);
  const totalDelivered = delivery.totalDelivered || 0;
  const readRate = totalDelivered > 0 ? ((totalRead / totalDelivered) * 100).toFixed(2) : 0;

  // Active users (last 24h)
  const last24h = getHourlyMetrics(24);
  const activeUsers24h = new Set();
  last24h.forEach((h) => {
    if (h.uniqueUsers) {
      h.uniqueUsers.forEach((u) => activeUsers24h.add(u));
    }
  });

  return {
    overview: {
      totalDelivered: delivery.totalDelivered,
      totalFailed: delivery.totalFailed,
      readRate: `${readRate}%`,
      activeUsers24h: activeUsers24h.size,
      storeSize: delivery.storeSize,
    },
    byChannel: delivery.byChannel,
    byPriority: delivery.byPriority,
    templates,
    scheduler,
    circuitBreakers,
    recentEvents: recentEvents.slice(-20).map((e) => ({
      type: e.type,
      channel: e.channel,
      timestamp: e.timestamp,
    })),
  };
};

/**
 * Get hourly metrics
 */
const getHourlyMetrics = (hours = 24) => {
  const result = [];
  const now = new Date();

  for (let i = hours - 1; i >= 0; i--) {
    const d = new Date(now.getTime() - i * 3600000);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}_${String(d.getHours()).padStart(2, '0')}`;
    const bucket = hourlyBuckets.get(key);
    if (bucket) {
      result.push({
        hour: key,
        totalSent: bucket.totalSent,
        totalDelivered: bucket.totalDelivered,
        totalRead: bucket.totalRead,
        totalFailed: bucket.totalFailed,
        byChannel: bucket.byChannel,
        byPriority: bucket.byPriority,
        uniqueUsers: bucket.uniqueUsers.size,
      });
    } else {
      result.push({
        hour: key,
        totalSent: 0,
        totalDelivered: 0,
        totalRead: 0,
        totalFailed: 0,
        byChannel: { in_app: 0, email: 0, push: 0 },
        byPriority: { low: 0, normal: 0, high: 0, urgent: 0 },
        uniqueUsers: 0,
      });
    }
  }

  return result;
};

/**
 * Get daily metrics
 */
const getDailyMetrics = (days = 7) => {
  const result = [];
  const now = new Date();

  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(now.getTime() - i * 86400000);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    const bucket = dailyBuckets.get(key);
    if (bucket) {
      result.push({
        date: key,
        totalSent: bucket.totalSent,
        totalDelivered: bucket.totalDelivered,
        totalRead: bucket.totalRead,
        totalFailed: bucket.totalFailed,
        byChannel: bucket.byChannel,
        byPriority: bucket.byPriority,
        byCategory: bucket.byCategory,
        uniqueUsers: bucket.uniqueUsers.size,
      });
    } else {
      result.push({
        date: key,
        totalSent: 0,
        totalDelivered: 0,
        totalRead: 0,
        totalFailed: 0,
        byChannel: { in_app: 0, email: 0, push: 0 },
        byPriority: { low: 0, normal: 0, high: 0, urgent: 0 },
        byCategory: {},
        uniqueUsers: 0,
      });
    }
  }

  return result;
};

/**
 * Get user engagement metrics
 */
const getUserEngagement = (options = {}) => {
  const { page = 1, limit = 20, sortBy = 'totalReceived', sortOrder = 'desc' } = options;

  let results = Array.from(userEngagement.values()).map((e) => ({
    userId: e.userId,
    totalReceived: e.totalReceived,
    totalRead: e.totalRead,
    readRate: e.totalReceived > 0 ? ((e.totalRead / e.totalReceived) * 100).toFixed(2) : 0,
    lastActive: e.lastActive,
    channels: e.channels,
    categories: e.categories,
  }));

  results.sort((a, b) => {
    const aVal = a[sortBy] || 0;
    const bVal = b[sortBy] || 0;
    if (sortOrder === 'desc') return bVal > aVal ? 1 : -1;
    return aVal > bVal ? 1 : -1;
  });

  const total = results.length;
  const start = (page - 1) * limit;
  const paginated = results.slice(start, start + limit);

  return {
    engagement: paginated,
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
    },
  };
};

/**
 * Get channel performance comparison
 */
const getChannelPerformance = () => {
  const delivery = getDeliveryStats();
  const allDaily = Array.from(dailyBuckets.values());

  const channelPerf = {};
  for (const ch of ['in_app', 'email', 'push']) {
    const sent = allDaily.reduce((sum, b) => sum + (b.byChannel[ch] || 0), 0);
    const totalAttempted = delivery.byChannel[ch] || 0;
    const successRate = totalAttempted > 0
      ? ((totalAttempted / (totalAttempted + delivery.totalFailed)) * 100).toFixed(2)
      : 100;

    channelPerf[ch] = {
      totalDelivered: totalAttempted,
      dailyAverage: allDaily.length > 0 ? Math.round(sent / allDaily.length) : 0,
      successRate: `${successRate}%`,
    };
  }

  return channelPerf;
};

/**
 * Get real-time event stream (last N events)
 */
const getEventStream = (count = 50, type = null) => {
  let events = [...recentEvents];

  if (type) {
    events = events.filter((e) => e.type === type);
  }

  return events.slice(-count);
};

/**
 * Export analytics report
 */
const exportReport = (format = 'json', options = {}) => {
  const report = {
    generatedAt: new Date().toISOString(),
    dashboard: getDashboard(),
    hourlyMetrics: getHourlyMetrics(options.hours || 24),
    dailyMetrics: getDailyMetrics(options.days || 7),
    channelPerformance: getChannelPerformance(),
    userEngagement: getUserEngagement(options).engagement,
  };

  if (format === 'csv') {
    // Simple CSV conversion for daily metrics
    const headers = 'date,totalSent,totalDelivered,totalRead,totalFailed,in_app,email,push\n';
    const rows = report.dailyMetrics.map((d) =>
      `${d.date},${d.totalSent},${d.totalDelivered},${d.totalRead},${d.totalFailed},${d.byChannel.in_app},${d.byChannel.email},${d.byChannel.push}`
    ).join('\n');
    return { format: 'csv', data: headers + rows };
  }

  return { format: 'json', data: report };
};

/**
 * Reset all analytics (for testing)
 */
const resetAnalytics = () => {
  hourlyBuckets.clear();
  dailyBuckets.clear();
  channelHourly.clear();
  userEngagement.clear();
  recentEvents.length = 0;
  analyticsSubscribers.clear();
};

module.exports = {
  trackEvent,
  subscribe,
  getDashboard,
  getHourlyMetrics,
  getDailyMetrics,
  getUserEngagement,
  getChannelPerformance,
  getEventStream,
  exportReport,
  resetAnalytics,
};
