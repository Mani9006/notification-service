/**
 * Input validation middleware using Joi schemas
 * with custom validators for notifications, preferences, and templates.
 */

'use strict';

const Joi = require('joi');
const { logger } = require('../utils/logger');

// Custom Joi extensions
const customJoi = Joi.extend({
  type: 'isoDate',
  base: Joi.string(),
  messages: {
    'isoDate.invalid': 'Must be a valid ISO 8601 date string',
  },
  validate(value, helpers) {
    const isoRegex = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})?$/;
    if (!isoRegex.test(value)) {
      return { value, errors: helpers.error('isoDate.invalid') };
    }
    return { value };
  },
});

/**
 * Notification creation schema
 */
const notificationCreateSchema = Joi.object({
  userId: Joi.string().min(1).max(100).required()
    .description('Target user ID'),

  title: Joi.string().min(1).max(200).required()
    .description('Notification title'),

  body: Joi.string().min(1).max(5000).required()
    .description('Notification body content'),

  channel: Joi.string().valid('in_app', 'email', 'push').default('in_app')
    .description('Delivery channel'),

  priority: Joi.string().valid('low', 'normal', 'high', 'urgent').default('normal')
    .description('Notification priority'),

  category: Joi.string().max(50).default('general')
    .description('Notification category'),

  templateId: Joi.string().max(100).allow(null).default(null)
    .description('Template ID to use'),

  templateData: Joi.object().default({})
    .description('Template variable data'),

  metadata: Joi.object().default({})
    .description('Additional metadata'),

  tags: Joi.array().items(Joi.string().max(30)).max(10).default([])
    .description('Notification tags'),

  scheduledFor: Joi.string().isoDate().allow(null).default(null)
    .description('ISO datetime for scheduled delivery'),

  expiresAt: Joi.string().isoDate().allow(null).default(null)
    .description('ISO datetime when notification expires'),

  actionUrl: Joi.string().uri().max(500).allow(null).default(null)
    .description('Action URL'),

  icon: Joi.string().max(200).allow(null).default(null)
    .description('Icon URL or identifier'),
}).options({ stripUnknown: true });

/**
 * Bulk notification creation schema
 */
const bulkNotificationSchema = Joi.object({
  notifications: Joi.array().items(notificationCreateSchema).min(1).max(100).required()
    .description('Array of notifications to create'),

  batchOptions: Joi.object({
    continueOnError: Joi.boolean().default(true),
    rateLimit: Joi.number().min(1).max(100).default(50),
  }).default({ continueOnError: true }),
}).options({ stripUnknown: true });

/**
 * Notification update schema
 */
const notificationUpdateSchema = Joi.object({
  title: Joi.string().min(1).max(200),
  body: Joi.string().min(1).max(5000),
  priority: Joi.string().valid('low', 'normal', 'high', 'urgent'),
  status: Joi.string().valid(
    'pending', 'queued', 'delivering', 'delivered', 'read',
    'failed', 'retrying', 'cancelled', 'scheduled'
  ),
  metadata: Joi.object(),
  tags: Joi.array().items(Joi.string()),
}).options({ stripUnknown: true }).min(1);

/**
 * Notification filter/query schema
 */
const notificationQuerySchema = Joi.object({
  status: Joi.string().valid(
    'pending', 'queued', 'delivering', 'delivered', 'read',
    'failed', 'retrying', 'cancelled', 'scheduled'
  ),

  channel: Joi.string().valid('in_app', 'email', 'push'),

  priority: Joi.string().valid('low', 'normal', 'high', 'urgent'),

  category: Joi.string().max(50),

  isRead: Joi.boolean(),

  search: Joi.string().max(200)
    .description('Search in title and body'),

  fromDate: Joi.string().isoDate()
    .description('Filter notifications created after this date'),

  toDate: Joi.string().isoDate()
    .description('Filter notifications created before this date'),

  tags: Joi.string()
    .description('Comma-separated list of tags'),

  page: Joi.number().integer().min(1).default(1),

  limit: Joi.number().integer().min(1).max(100).default(20),

  sortBy: Joi.string().valid('createdAt', 'updatedAt', 'priority', 'title').default('createdAt'),

  sortOrder: Joi.string().valid('asc', 'desc').default('desc'),
}).options({ stripUnknown: true });

/**
 * Preference update schema
 */
const preferenceUpdateSchema = Joi.object({
  inApp: Joi.object({
    enabled: Joi.boolean(),
    sound: Joi.boolean(),
    desktopPopup: Joi.boolean(),
    showPreview: Joi.boolean(),
  }).optional(),

  email: Joi.object({
    enabled: Joi.boolean(),
    digestFrequency: Joi.string().valid('immediate', 'hourly', 'daily', 'weekly'),
    onlyPriority: Joi.array().items(Joi.string().valid('low', 'normal', 'high', 'urgent')).allow(null),
  }).optional(),

  push: Joi.object({
    enabled: Joi.boolean(),
    sound: Joi.boolean(),
    vibration: Joi.boolean(),
    badgeCount: Joi.boolean(),
  }).optional(),

  quietHours: Joi.object({
    enabled: Joi.boolean(),
    start: Joi.string().pattern(/^([01]\d|2[0-3]):([0-5]\d)$/),
    end: Joi.string().pattern(/^([01]\d|2[0-3]):([0-5]\d)$/),
    timezone: Joi.string().max(50),
    allowUrgent: Joi.boolean(),
  }).optional(),

  batching: Joi.object({
    enabled: Joi.boolean(),
    intervalMinutes: Joi.number().integer().min(1).max(1440),
    maxPerBatch: Joi.number().integer().min(1).max(50),
    byCategory: Joi.object().pattern(Joi.string(), Joi.boolean()),
  }).optional(),

  categories: Joi.object().pattern(Joi.string(), Joi.object({
    enabled: Joi.boolean(),
    channels: Joi.array().items(Joi.string().valid('in_app', 'email', 'push')),
  })).optional(),

  blockedSenders: Joi.array().items(Joi.string()).optional(),
  muteUntil: Joi.string().isoDate().allow(null).optional(),
}).options({ stripUnknown: true }).min(1);

/**
 * Template creation schema
 */
const templateCreateSchema = Joi.object({
  name: Joi.string().min(1).max(100).required(),
  description: Joi.string().max(500).allow('').default(''),
  channel: Joi.string().valid('in_app', 'email', 'push').default('in_app'),
  category: Joi.string().max(50).default('general'),
  content: Joi.object({
    subject: Joi.string().max(500).default('{{title}}'),
    body: Joi.string().max(5000).required(),
    html: Joi.string().allow(null).default(null),
    actionUrl: Joi.string().uri().allow(null).default(null),
    actionLabel: Joi.string().max(50).default('View'),
  }).required(),
  variables: Joi.object().pattern(Joi.string(), Joi.object({
    type: Joi.string().valid('string', 'number', 'boolean', 'date', 'url', 'email').default('string'),
    required: Joi.boolean().default(false),
    default: Joi.any().allow(null).default(null),
    description: Joi.string().allow('').default(''),
  })).default({}),
  conditions: Joi.array().items(Joi.object({
    if: Joi.string().required(),
    then: Joi.string().allow(null).default(null),
    else: Joi.string().allow(null).default(null),
  })).default([]),
  localizations: Joi.object().pattern(Joi.string(), Joi.object({
    subject: Joi.string(),
    body: Joi.string(),
    html: Joi.string().allow(null),
    actionLabel: Joi.string(),
  })).default({}),
  tags: Joi.array().items(Joi.string().max(30)).default([]),
  isActive: Joi.boolean().default(true),
}).options({ stripUnknown: true });

/**
 * Template update schema
 */
const templateUpdateSchema = Joi.object({
  name: Joi.string().min(1).max(100),
  description: Joi.string().max(500),
  channel: Joi.string().valid('in_app', 'email', 'push'),
  category: Joi.string().max(50),
  content: Joi.object({
    subject: Joi.string().max(500),
    body: Joi.string().max(5000),
    html: Joi.string().allow(null),
    actionUrl: Joi.string().uri().allow(null),
    actionLabel: Joi.string().max(50),
  }),
  variables: Joi.object(),
  conditions: Joi.array(),
  localizations: Joi.object(),
  tags: Joi.array().items(Joi.string()),
  isActive: Joi.boolean(),
}).options({ stripUnknown: true }).min(1);

/**
 * Schedule notification schema
 */
const scheduleSchema = Joi.object({
  scheduledFor: Joi.string().isoDate().required()
    .description('ISO datetime for scheduled delivery'),

  timezone: Joi.string().max(50).default('UTC')
    .description('Timezone for the schedule'),

  recurring: Joi.object({
    enabled: Joi.boolean().default(false),
    frequency: Joi.string().valid('minutely', 'hourly', 'daily', 'weekly', 'monthly').required(),
    interval: Joi.number().integer().min(1).max(365).default(1),
    daysOfWeek: Joi.array().items(Joi.number().integer().min(0).max(6)),
    endDate: Joi.string().isoDate().allow(null),
    maxOccurrences: Joi.number().integer().min(1).max(1000).allow(null),
  }).optional(),
}).options({ stripUnknown: true });

/**
 * Generic validation middleware factory
 */
const validate = (schema, property = 'body') => {
  return (req, res, next) => {
    try {
      const data = property === 'body' ? req.body :
        property === 'query' ? req.query :
          property === 'params' ? req.params : req[property];

      const { error, value } = schema.validate(data);

      if (error) {
        const details = error.details.map((d) => ({
          field: d.path.join('.'),
          message: d.message,
          value: d.context?.value,
        }));

        logger.warn(`Validation failed: ${error.message}`);
        return res.status(400).json({
          success: false,
          error: 'Validation failed',
          code: 'VALIDATION_ERROR',
          details,
        });
      }

      // Replace with validated value (includes defaults, stripUnknown)
      req[property] = value;
      next();
    } catch (err) {
      logger.error(`Validator middleware error: ${err.message}`);
      return res.status(500).json({
        success: false,
        error: 'Validation system error',
        code: 'VALIDATION_SYSTEM_ERROR',
      });
    }
  };
};

/**
 * Validate request body
 */
const validateBody = (schema) => validate(schema, 'body');

/**
 * Validate query params
 */
const validateQuery = (schema) => validate(schema, 'query');

/**
 * Validate URL params
 */
const validateParams = (schema) => validate(schema, 'params');

/**
 * UUID param validator
 */
const uuidParamSchema = Joi.object({
  id: Joi.string().pattern(/^[a-zA-Z0-9_-]+$/).required(),
});

module.exports = {
  // Schemas
  notificationCreateSchema,
  bulkNotificationSchema,
  notificationUpdateSchema,
  notificationQuerySchema,
  preferenceUpdateSchema,
  templateCreateSchema,
  templateUpdateSchema,
  scheduleSchema,
  uuidParamSchema,

  // Middleware
  validate,
  validateBody,
  validateQuery,
  validateParams,
};
