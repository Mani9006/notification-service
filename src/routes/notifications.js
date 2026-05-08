/**
 * Notification REST API routes for CRUD, delivery, and management.
 */

'use strict';

const express = require('express');
const router = express.Router();

const {
  createAndDeliver,
  bulkDeliver,
  getNotification,
  getUserNotifications,
  markAsRead,
  bulkMarkAsRead,
  markAsUnread,
  deleteNotification,
  getUnreadCount,
  getDeliveryStats,
  cleanupOldNotifications,
} = require('../services/deliveryService');

const { scheduleNotification, rescheduleNotification, cancelScheduled, getScheduledNotifications } = require('../services/schedulerService');
const { trackEvent } = require('../services/analyticsService');
const { pubsub } = require('../utils/pubsub');
const { authenticate } = require('../middleware/auth');
const { rateLimiter, notificationRateLimiter, batchRateLimiter } = require('../middleware/rateLimiter');
const Joi = require('joi');
const {
  validateBody,
  validateQuery,
  validateParams,
  notificationCreateSchema,
  bulkNotificationSchema,
  notificationUpdateSchema,
  notificationQuerySchema,
  uuidParamSchema,
  scheduleSchema,
} = require('../middleware/validator');

// Apply auth to all routes
router.use(authenticate);

/**
 * @route POST /api/notifications
 * @desc Create and deliver a notification
 */
router.post(
  '/',
  notificationRateLimiter(),
  validateBody(notificationCreateSchema),
  async (req, res) => {
    try {
      const result = await createAndDeliver({
        ...req.body,
        metadata: {
          ...req.body.metadata,
          senderId: req.userId,
          senderType: req.user?.authType || 'api',
        },
      });

      if (result.success) {
        trackEvent('delivered', result.notification);
        return res.status(201).json({
          success: true,
          data: result.notification.toJSON(),
          message: 'Notification delivered successfully',
        });
      }

      trackEvent('failed', result.notification);
      return res.status(400).json({
        success: false,
        error: result.error,
        notification: result.notification?.toJSON(),
      });
    } catch (error) {
      return res.status(500).json({
        success: false,
        error: error.message,
        code: 'DELIVERY_ERROR',
      });
    }
  }
);

/**
 * @route POST /api/notifications/bulk
 * @desc Create and deliver multiple notifications
 */
router.post(
  '/bulk',
  batchRateLimiter(),
  validateBody(bulkNotificationSchema),
  async (req, res) => {
    try {
      const { notifications, batchOptions } = req.body;
      const results = await bulkDeliver(
        notifications.map((n) => ({
          ...n,
          metadata: {
            ...n.metadata,
            senderId: req.userId,
            batch: true,
          },
        })),
        null,
        batchOptions
      );

      // Track events
      results.results.forEach((r) => {
        if (r.success && r.notification) {
          trackEvent('delivered', r.notification);
        }
      });

      return res.status(201).json({
        success: true,
        data: results,
        message: `Bulk delivery: ${results.succeeded} succeeded, ${results.failed} failed`,
      });
    } catch (error) {
      return res.status(500).json({
        success: false,
        error: error.message,
        code: 'BULK_DELIVERY_ERROR',
      });
    }
  }
);

/**
 * @route POST /api/notifications/schedule
 * @desc Schedule a notification for future delivery
 */
router.post(
  '/schedule',
  validateBody(notificationCreateSchema),
  async (req, res) => {
    try {
      const { scheduledFor, ...notificationData } = req.body;

      if (!scheduledFor) {
        return res.status(400).json({
          success: false,
          error: 'scheduledFor is required for scheduled notifications',
          code: 'MISSING_SCHEDULE_TIME',
        });
      }

      const result = scheduleNotification(
        {
          ...notificationData,
          metadata: {
            ...notificationData.metadata,
            senderId: req.userId,
          },
        },
        scheduledFor
      );

      if (result.success) {
        trackEvent('scheduled', result.notification);
        return res.status(201).json({
          success: true,
          data: result.notification.toJSON(),
          message: `Notification scheduled for ${scheduledFor}`,
        });
      }

      return res.status(400).json({
        success: false,
        error: result.error,
        code: 'SCHEDULE_ERROR',
      });
    } catch (error) {
      return res.status(500).json({
        success: false,
        error: error.message,
        code: 'SCHEDULING_ERROR',
      });
    }
  }
);

/**
 * @route GET /api/notifications
 * @desc Get notifications with filtering and pagination
 */
router.get(
  '/',
  validateQuery(notificationQuerySchema),
  (req, res) => {
    try {
      const userId = req.query.userId || req.userId;
      const result = getUserNotifications(userId, req.query);

      return res.status(200).json({
        success: true,
        data: result.notifications.map((n) => n.toJSON()),
        pagination: result.pagination,
      });
    } catch (error) {
      return res.status(500).json({
        success: false,
        error: error.message,
        code: 'QUERY_ERROR',
      });
    }
  }
);

/**
 * @route GET /api/notifications/unread-count/:userId
 * @desc Get unread notification count for a user
 */
router.get(
  '/unread-count/:userId',
  validateParams(uuidParamSchema),
  (req, res) => {
    try {
      const count = getUnreadCount(req.params.userId);
      return res.status(200).json({
        success: true,
        data: { userId: req.params.userId, unreadCount: count },
      });
    } catch (error) {
      return res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  }
);

/**
 * @route GET /api/notifications/stats
 * @desc Get delivery statistics
 */
router.get('/stats', (req, res) => {
  try {
    const stats = getDeliveryStats();
    return res.status(200).json({
      success: true,
      data: stats,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

/**
 * @route GET /api/notifications/:id
 * @desc Get a single notification by ID
 */
router.get(
  '/:id',
  validateParams(uuidParamSchema),
  (req, res) => {
    try {
      const notification = getNotification(req.params.id);
      if (!notification) {
        return res.status(404).json({
          success: false,
          error: 'Notification not found',
          code: 'NOT_FOUND',
        });
      }

      return res.status(200).json({
        success: true,
        data: notification.toJSON(),
      });
    } catch (error) {
      return res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  }
);

/**
 * @route PATCH /api/notifications/:id/read
 * @desc Mark a notification as read
 */
router.patch(
  '/:id/read',
  validateParams(uuidParamSchema),
  (req, res) => {
    try {
      const result = markAsRead(req.params.id, req.userId);

      if (result.success) {
        trackEvent('read', result.notification);
        return res.status(200).json({
          success: true,
          data: result.notification.toJSON(),
          message: 'Notification marked as read',
        });
      }

      return res.status(404).json({
        success: false,
        error: result.error,
        code: 'NOT_FOUND',
      });
    } catch (error) {
      return res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  }
);

/**
 * @route POST /api/notifications/read-all
 * @desc Mark multiple notifications as read
 */
router.post('/read-all', validateBody(Joi.object({
  notificationIds: Joi.array().items(Joi.string()).min(1).required(),
})), (req, res) => {
  try {
    const result = bulkMarkAsRead(req.body.notificationIds, req.userId);
    return res.status(200).json({
      success: true,
      data: result,
      message: `${result.succeeded} notifications marked as read`,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

/**
 * @route PATCH /api/notifications/:id/unread
 * @desc Mark a notification as unread
 */
router.patch(
  '/:id/unread',
  validateParams(uuidParamSchema),
  (req, res) => {
    try {
      const result = markAsUnread(req.params.id);

      if (result.success) {
        return res.status(200).json({
          success: true,
          data: result.notification.toJSON(),
          message: 'Notification marked as unread',
        });
      }

      return res.status(404).json({
        success: false,
        error: result.error,
        code: 'NOT_FOUND',
      });
    } catch (error) {
      return res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  }
);

/**
 * @route DELETE /api/notifications/:id
 * @desc Delete a notification
 */
router.delete(
  '/:id',
  validateParams(uuidParamSchema),
  (req, res) => {
    try {
      const result = deleteNotification(req.params.id);

      if (result.success) {
        return res.status(200).json({
          success: true,
          message: 'Notification deleted',
        });
      }

      return res.status(404).json({
        success: false,
        error: result.error,
        code: 'NOT_FOUND',
      });
    } catch (error) {
      return res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  }
);

/**
 * @route POST /api/notifications/:id/reschedule
 * @desc Reschedule a notification
 */
router.post(
  '/:id/reschedule',
  validateParams(uuidParamSchema),
  (req, res) => {
    try {
      const { scheduledFor } = req.body;
      if (!scheduledFor) {
        return res.status(400).json({
          success: false,
          error: 'scheduledFor is required',
        });
      }

      const result = rescheduleNotification(req.params.id, scheduledFor);
      if (result.success) {
        return res.status(200).json({
          success: true,
          data: result.notification.toJSON(),
        });
      }

      return res.status(400).json({
        success: false,
        error: result.error,
      });
    } catch (error) {
      return res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  }
);

/**
 * @route POST /api/notifications/:id/cancel
 * @desc Cancel a scheduled notification
 */
router.post(
  '/:id/cancel',
  validateParams(uuidParamSchema),
  (req, res) => {
    try {
      const result = cancelScheduled(req.params.id);
      if (result.success) {
        return res.status(200).json({
          success: true,
          message: 'Scheduled notification cancelled',
          data: result.notification.toJSON(),
        });
      }

      return res.status(404).json({
        success: false,
        error: result.error,
      });
    } catch (error) {
      return res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  }
);

/**
 * @route GET /api/notifications/scheduled/list
 * @desc Get scheduled notifications
 */
router.get('/scheduled/list', (req, res) => {
  try {
    const result = getScheduledNotifications({
      userId: req.query.userId || req.userId,
      page: parseInt(req.query.page, 10) || 1,
      limit: parseInt(req.query.limit, 10) || 20,
    });

    return res.status(200).json({
      success: true,
      data: result.notifications.map((n) => n.toJSON()),
      pagination: result.pagination,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

/**
 * @route POST /api/notifications/cleanup
 * @desc Clean up old notifications
 */
router.post('/cleanup', (req, res) => {
  try {
    const { retentionDays } = req.body;
    const result = cleanupOldNotifications(retentionDays);
    return res.status(200).json({
      success: true,
      data: result,
      message: `${result.removed} old notifications cleaned up`,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

module.exports = router;
