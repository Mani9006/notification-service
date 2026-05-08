/**
 * Notification scheduler service for delayed, scheduled,
 * and recurring notifications with cron-like capabilities.
 */

'use strict';

const cron = require('node-cron');
const { Notification } = require('../models/Notification');
const { deliverNotification } = require('./deliveryService');
const { logger } = require('../utils/logger');
const { pubsub } = require('../utils/pubsub');
const config = require('../config');

// Scheduled notification store
const scheduledStore = new Map();

// Recurring job store
const recurringJobs = new Map();

// Scheduler statistics
const schedulerStats = {
  totalScheduled: 0,
  totalDelivered: 0,
  totalCancelled: 0,
  totalExpired: 0,
  totalFailed: 0,
};

// Active scheduler
let schedulerTask = null;
let isRunning = false;

/**
 * Schedule a notification for future delivery
 */
const scheduleNotification = (notificationData, scheduleTime) => {
  try {
    const scheduledFor = new Date(scheduleTime);
    const maxScheduled = new Date(Date.now() + config.scheduler.maxScheduledDays * 86400000);

    if (isNaN(scheduledFor.getTime())) {
      throw new Error('Invalid schedule time');
    }

    if (scheduledFor <= new Date()) {
      throw new Error('Schedule time must be in the future');
    }

    if (scheduledFor > maxScheduled) {
      throw new Error(`Schedule time cannot exceed ${config.scheduler.maxScheduledDays} days in the future`);
    }

    const notification = new Notification({
      ...notificationData,
      status: 'scheduled',
      scheduledFor: scheduledFor.toISOString(),
    });
    notification.validate();

    scheduledStore.set(notification.id, notification);
    schedulerStats.totalScheduled++;

    pubsub.publish('scheduler:scheduled', {
      notificationId: notification.id,
      userId: notification.userId,
      scheduledFor: notification.scheduledFor,
    });

    logger.info(`Notification ${notification.id} scheduled for ${notification.scheduledFor}`);
    return { success: true, notification };
  } catch (error) {
    logger.error(`Scheduling failed: ${error.message}`);
    return { success: false, error: error.message };
  }
};

/**
 * Cancel a scheduled notification
 */
const cancelScheduled = (notificationId) => {
  const notification = scheduledStore.get(notificationId);
  if (!notification) {
    return { success: false, error: 'Scheduled notification not found' };
  }

  notification.markCancelled('User cancelled scheduled notification');
  scheduledStore.delete(notificationId);
  schedulerStats.totalCancelled++;

  pubsub.publish('scheduler:cancelled', {
    notificationId,
    userId: notification.userId,
  });

  logger.info(`Scheduled notification ${notificationId} cancelled`);
  return { success: true, notification };
};

/**
 * Reschedule a notification
 */
const rescheduleNotification = (notificationId, newScheduleTime) => {
  const notification = scheduledStore.get(notificationId);
  if (!notification) {
    return { success: false, error: 'Scheduled notification not found' };
  }

  try {
    const scheduledFor = new Date(newScheduleTime);
    const maxScheduled = new Date(Date.now() + config.scheduler.maxScheduledDays * 86400000);

    if (isNaN(scheduledFor.getTime())) {
      throw new Error('Invalid schedule time');
    }

    if (scheduledFor <= new Date()) {
      throw new Error('New schedule time must be in the future');
    }

    if (scheduledFor > maxScheduled) {
      throw new Error(`Schedule time cannot exceed ${config.scheduler.maxScheduledDays} days in the future`);
    }

    notification.scheduledFor = scheduledFor.toISOString();
    notification.updatedAt = new Date().toISOString();
    notification.status = 'scheduled';

    logger.info(`Notification ${notificationId} rescheduled to ${notification.scheduledFor}`);
    return { success: true, notification };
  } catch (error) {
    return { success: false, error: error.message };
  }
};

/**
 * Get scheduled notifications
 */
const getScheduledNotifications = (options = {}) => {
  const {
    userId = null,
    fromDate = null,
    toDate = null,
    status = 'scheduled',
    page = 1,
    limit = 20,
  } = options;

  let results = Array.from(scheduledStore.values());

  if (userId) results = results.filter((n) => n.userId === userId);
  if (status) results = results.filter((n) => n.status === status);
  if (fromDate) results = results.filter((n) => new Date(n.scheduledFor) >= new Date(fromDate));
  if (toDate) results = results.filter((n) => new Date(n.scheduledFor) <= new Date(toDate));

  // Sort by scheduled time
  results.sort((a, b) => new Date(a.scheduledFor) - new Date(b.scheduledFor));

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
 * Create a recurring notification schedule
 */
const createRecurringSchedule = (scheduleData) => {
  try {
    const { notificationData, recurring } = scheduleData;

    if (!recurring || !recurring.enabled) {
      throw new Error('Recurring settings required');
    }

    if (!recurring.frequency) {
      throw new Error('Frequency is required for recurring schedules');
    }

    const scheduleId = `recur_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;

    // Build cron expression
    let cronExpression;
    switch (recurring.frequency) {
      case 'minutely':
        cronExpression = `*/${recurring.interval || 1} * * * *`;
        break;
      case 'hourly':
        cronExpression = `0 */${recurring.interval || 1} * * *`;
        break;
      case 'daily':
        cronExpression = `0 0 */${recurring.interval || 1} * *`;
        break;
      case 'weekly':
        cronExpression = `0 0 * * ${recurring.daysOfWeek?.join(',') || 0}`;
        break;
      case 'monthly':
        cronExpression = `0 0 1 */${recurring.interval || 1} *`;
        break;
      default:
        throw new Error(`Unsupported frequency: ${recurring.frequency}`);
    }

    let occurrenceCount = 0;
    const maxOccurrences = recurring.maxOccurrences || null;
    const endDate = recurring.endDate ? new Date(recurring.endDate) : null;

    const task = cron.schedule(cronExpression, async () => {
      try {
        // Check max occurrences
        if (maxOccurrences && occurrenceCount >= maxOccurrences) {
          logger.info(`Recurring schedule ${scheduleId} reached max occurrences`);
          task.stop();
          recurringJobs.delete(scheduleId);
          return;
        }

        // Check end date
        if (endDate && new Date() > endDate) {
          logger.info(`Recurring schedule ${scheduleId} reached end date`);
          task.stop();
          recurringJobs.delete(scheduleId);
          return;
        }

        // Create and deliver notification
        const notification = new Notification(notificationData);
        notification.markScheduled(new Date().toISOString());
        const result = await deliverNotification(notification);

        if (result.success) {
          occurrenceCount++;
          schedulerStats.totalDelivered++;
          logger.debug(`Recurring notification ${scheduleId} delivered (occurrence ${occurrenceCount})`);
        } else {
          schedulerStats.totalFailed++;
          logger.warn(`Recurring notification ${scheduleId} failed: ${result.error}`);
        }
      } catch (error) {
        schedulerStats.totalFailed++;
        logger.error(`Recurring schedule ${scheduleId} error: ${error.message}`);
      }
    }, {
      scheduled: false,
    });

    recurringJobs.set(scheduleId, {
      task,
      scheduleId,
      notificationData,
      recurring,
      cronExpression,
      occurrenceCount: 0,
      maxOccurrences,
      endDate,
      createdAt: new Date().toISOString(),
      status: 'active',
    });

    task.start();

    logger.info(`Recurring schedule created: ${scheduleId} (${cronExpression})`);
    return { success: true, scheduleId, cronExpression };
  } catch (error) {
    logger.error(`Create recurring schedule failed: ${error.message}`);
    return { success: false, error: error.message };
  }
};

/**
 * Stop a recurring schedule
 */
const stopRecurringSchedule = (scheduleId) => {
  const job = recurringJobs.get(scheduleId);
  if (!job) {
    return { success: false, error: 'Schedule not found' };
  }

  job.task.stop();
  job.status = 'stopped';

  logger.info(`Recurring schedule ${scheduleId} stopped`);
  return { success: true, scheduleId };
};

/**
 * Resume a recurring schedule
 */
const resumeRecurringSchedule = (scheduleId) => {
  const job = recurringJobs.get(scheduleId);
  if (!job) {
    return { success: false, error: 'Schedule not found' };
  }

  job.task.start();
  job.status = 'active';

  logger.info(`Recurring schedule ${scheduleId} resumed`);
  return { success: true, scheduleId };
};

/**
 * Delete a recurring schedule
 */
const deleteRecurringSchedule = (scheduleId) => {
  const job = recurringJobs.get(scheduleId);
  if (!job) {
    return { success: false, error: 'Schedule not found' };
  }

  job.task.stop();
  job.task.destroy();
  recurringJobs.delete(scheduleId);

  logger.info(`Recurring schedule ${scheduleId} deleted`);
  return { success: true };
};

/**
 * Get recurring schedules
 */
const getRecurringSchedules = () => {
  return Array.from(recurringJobs.values()).map((job) => ({
    scheduleId: job.scheduleId,
    status: job.status,
    cronExpression: job.cronExpression,
    occurrenceCount: job.occurrenceCount,
    maxOccurrences: job.maxOccurrences,
    endDate: job.endDate,
    createdAt: job.createdAt,
  }));
};

/**
 * Process due scheduled notifications (called by the scheduler loop)
 */
const processDueNotifications = async () => {
  const now = new Date();
  const dueNotifications = [];

  for (const [id, notification] of scheduledStore.entries()) {
    if (notification.status === 'scheduled' && new Date(notification.scheduledFor) <= now) {
      dueNotifications.push(notification);
    }

    // Clean up expired/cancelled
    if (notification.status === 'cancelled' || notification.isExpired()) {
      scheduledStore.delete(id);
      if (notification.isExpired()) {
        schedulerStats.totalExpired++;
      }
    }
  }

  // Sort by scheduled time, then priority
  const priorityOrder = { urgent: 0, high: 1, normal: 2, low: 3 };
  dueNotifications.sort((a, b) => {
    const timeDiff = new Date(a.scheduledFor) - new Date(b.scheduledFor);
    if (timeDiff !== 0) return timeDiff;
    return (priorityOrder[a.priority] || 99) - (priorityOrder[b.priority] || 99);
  });

  // Process each due notification
  for (const notification of dueNotifications) {
    try {
      scheduledStore.delete(notification.id);
      const result = await deliverNotification(notification);

      if (result.success) {
        schedulerStats.totalDelivered++;
        pubsub.publish('scheduler:delivered', {
          notificationId: notification.id,
          userId: notification.userId,
        });
      } else {
        schedulerStats.totalFailed++;
      }
    } catch (error) {
      schedulerStats.totalFailed++;
      logger.error(`Failed to process scheduled notification ${notification.id}: ${error.message}`);
    }
  }

  return {
    processed: dueNotifications.length,
    remaining: scheduledStore.size,
  };
};

/**
 * Start the scheduler
 */
const startScheduler = () => {
  if (isRunning) {
    logger.warn('Scheduler already running');
    return { success: false, error: 'Already running' };
  }

  isRunning = true;

  // Run immediately
  processDueNotifications();

  // Set up recurring check
  schedulerTask = setInterval(async () => {
    try {
      const result = await processDueNotifications();
      if (result.processed > 0) {
        logger.info(`Scheduler processed ${result.processed} notifications (${result.remaining} remaining)`);
      }
    } catch (error) {
      logger.error(`Scheduler error: ${error.message}`);
    }
  }, config.scheduler.checkIntervalMs);

  logger.info(`Scheduler started (interval: ${config.scheduler.checkIntervalMs}ms)`);
  return { success: true };
};

/**
 * Stop the scheduler
 */
const stopScheduler = () => {
  if (schedulerTask) {
    clearInterval(schedulerTask);
    schedulerTask = null;
  }
  isRunning = false;

  logger.info('Scheduler stopped');
  return { success: true };
};

/**
 * Get scheduler status
 */
const getSchedulerStatus = () => {
  return {
    isRunning,
    scheduledCount: scheduledStore.size,
    recurringCount: recurringJobs.size,
    stats: { ...schedulerStats },
    nextCheckMs: isRunning ? config.scheduler.checkIntervalMs : null,
  };
};

/**
 * Get scheduler stats
 */
const getSchedulerStats = () => {
  return { ...schedulerStats };
};

/**
 * Reset scheduler (for testing)
 */
const resetScheduler = () => {
  stopScheduler();
  scheduledStore.clear();

  for (const job of recurringJobs.values()) {
    job.task.stop();
    job.task.destroy();
  }
  recurringJobs.clear();

  schedulerStats.totalScheduled = 0;
  schedulerStats.totalDelivered = 0;
  schedulerStats.totalCancelled = 0;
  schedulerStats.totalExpired = 0;
  schedulerStats.totalFailed = 0;
};

module.exports = {
  scheduleNotification,
  cancelScheduled,
  rescheduleNotification,
  getScheduledNotifications,
  createRecurringSchedule,
  stopRecurringSchedule,
  resumeRecurringSchedule,
  deleteRecurringSchedule,
  getRecurringSchedules,
  processDueNotifications,
  startScheduler,
  stopScheduler,
  getSchedulerStatus,
  getSchedulerStats,
  resetScheduler,
};
