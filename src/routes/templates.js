/**
 * Template REST API routes for CRUD and rendering operations.
 */

'use strict';

const express = require('express');
const router = express.Router();

const {
  createTemplate,
  getTemplate,
  listTemplates,
  updateTemplate,
  deleteTemplate,
  renderTemplate,
  previewTemplate,
  cloneTemplate,
  getTemplateStats,
} = require('../services/templateService');

const { authenticate } = require('../middleware/auth');
const { rateLimiter, throttle } = require('../middleware/rateLimiter');
const {
  validateBody,
  validateQuery,
  validateParams,
  templateCreateSchema,
  templateUpdateSchema,
} = require('../middleware/validator');

const Joi = require('joi');

router.use(authenticate);

/**
 * @route POST /api/templates
 * @desc Create a new template
 */
router.post(
  '/',
  validateBody(templateCreateSchema),
  (req, res) => {
    try {
      const result = createTemplate({
        ...req.body,
        createdBy: req.userId,
      });

      if (result.success) {
        return res.status(201).json({
          success: true,
          data: result.template.toJSON(),
          message: 'Template created',
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
 * @route GET /api/templates
 * @desc List templates with filtering
 */
router.get(
  '/',
  validateQuery(Joi.object({
    channel: Joi.string().valid('in_app', 'email', 'push'),
    category: Joi.string().max(50),
    isActive: Joi.boolean(),
    search: Joi.string().max(200),
    tags: Joi.string(),
    page: Joi.number().integer().min(1).default(1),
    limit: Joi.number().integer().min(1).max(100).default(20),
    sortBy: Joi.string().valid('createdAt', 'updatedAt', 'name', 'useCount').default('createdAt'),
    sortOrder: Joi.string().valid('asc', 'desc').default('desc'),
  })),
  (req, res) => {
    try {
      const result = listTemplates(req.query);
      return res.status(200).json({
        success: true,
        data: result.templates.map((t) => t.toJSON()),
        pagination: result.pagination,
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
 * @route GET /api/templates/stats
 * @desc Get template statistics
 */
router.get('/stats', (req, res) => {
  try {
    const stats = getTemplateStats();
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
 * @route GET /api/templates/:id
 * @desc Get a template by ID
 */
router.get(
  '/:id',
  (req, res) => {
    try {
      const result = getTemplate(req.params.id);
      if (result.success) {
        return res.status(200).json({
          success: true,
          data: result.template.toJSON(),
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
 * @route PUT /api/templates/:id
 * @desc Update a template
 */
router.put(
  '/:id',
  validateBody(templateUpdateSchema),
  (req, res) => {
    try {
      const result = updateTemplate(req.params.id, req.body);
      if (result.success) {
        return res.status(200).json({
          success: true,
          data: result.template.toJSON(),
          message: 'Template updated',
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
 * @route DELETE /api/templates/:id
 * @desc Delete a template
 */
router.delete(
  '/:id',
  (req, res) => {
    try {
      const result = deleteTemplate(req.params.id);
      if (result.success) {
        return res.status(200).json({
          success: true,
          message: 'Template deleted',
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
 * @route POST /api/templates/:id/render
 * @desc Render a template with data
 */
router.post(
  '/:id/render',
  throttle({ windowMs: 60000, maxRequests: 20 }),
  (req, res) => {
    try {
      const { data, locale } = req.body;
      const result = renderTemplate(req.params.id, data, { locale });

      if (result.success) {
        return res.status(200).json({
          success: true,
          data: result.rendered,
          template: result.template,
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
 * @route POST /api/templates/preview
 * @desc Preview a template without saving
 */
router.post(
  '/preview',
  throttle({ windowMs: 60000, maxRequests: 20 }),
  (req, res) => {
    try {
      const { template, data, locale } = req.body;
      const result = previewTemplate(template, data, { locale });

      if (result.success) {
        return res.status(200).json({
          success: true,
          data: result.rendered,
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
 * @route POST /api/templates/:id/clone
 * @desc Clone a template
 */
router.post(
  '/:id/clone',
  (req, res) => {
    try {
      const { name } = req.body;
      const result = cloneTemplate(req.params.id, name ? { name } : {});

      if (result.success) {
        return res.status(201).json({
          success: true,
          data: result.template.toJSON(),
          message: 'Template cloned',
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

module.exports = router;
