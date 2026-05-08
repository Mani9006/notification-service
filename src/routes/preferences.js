/**
 * User preference REST API routes for managing notification settings.
 */

'use strict';

const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/auth');
const { rateLimiter } = require('../middleware/rateLimiter');
const { validateBody, validateParams, preferenceUpdateSchema } = require('../middleware/validator');

const {
  getPreferences,
  createPreferences,
  updatePreferences,
  resetPreferences,
  deletePreferences,
  toggleChannel,
  setQuietHours,
  toggleQuietHours,
  setBatching,
  muteUser,
  unmuteUser,
  blockSender,
  unblockSender,
  updateCategorySettings,
  getPreferenceSummary,
  getAllPreferences,
} = require('../services/preferenceService');

router.use(authenticate);

/**
 * @route GET /api/preferences
 * @desc Get preferences for authenticated user
 */
router.get('/', (req, res) => {
  try {
    const result = getPreferences(req.userId);
    return res.status(200).json({
      success: true,
      data: result.preferences.toJSON(),
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

/**
 * @route GET /api/preferences/summary
 * @desc Get preference summary
 */
router.get('/summary', (req, res) => {
  try {
    const result = getPreferenceSummary(req.userId);
    return res.status(200).json({
      success: true,
      data: result.summary,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

/**
 * @route POST /api/preferences
 * @desc Create preferences for authenticated user
 */
router.post('/', validateBody(preferenceUpdateSchema), (req, res) => {
  try {
    const result = createPreferences(req.userId, req.body);
    if (result.success) {
      return res.status(201).json({
        success: true,
        data: result.preferences.toJSON(),
        message: 'Preferences created',
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
});

/**
 * @route PUT /api/preferences
 * @desc Update preferences for authenticated user
 */
router.put('/', validateBody(preferenceUpdateSchema), (req, res) => {
  try {
    const result = updatePreferences(req.userId, req.body);
    if (result.success) {
      return res.status(200).json({
        success: true,
        data: result.preferences.toJSON(),
        message: 'Preferences updated',
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
});

/**
 * @route POST /api/preferences/reset
 * @desc Reset preferences to defaults
 */
router.post('/reset', (req, res) => {
  try {
    const result = resetPreferences(req.userId);
    return res.status(200).json({
      success: true,
      data: result.preferences.toJSON(),
      message: 'Preferences reset to defaults',
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

/**
 * @route DELETE /api/preferences
 * @desc Delete preferences
 */
router.delete('/', (req, res) => {
  try {
    const result = deletePreferences(req.userId);
    if (result.success) {
      return res.status(200).json({
        success: true,
        message: 'Preferences deleted',
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
});

/**
 * @route POST /api/preferences/channel/:channel/toggle
 * @desc Toggle a channel on/off
 */
router.post('/channel/:channel/toggle', (req, res) => {
  try {
    const { channel } = req.params;
    const { enabled } = req.body;

    if (enabled === undefined) {
      return res.status(400).json({
        success: false,
        error: 'enabled field is required',
      });
    }

    const result = toggleChannel(req.userId, channel, enabled);
    if (result.success) {
      return res.status(200).json({
        success: true,
        data: result.preferences.toJSON(),
        message: `Channel ${channel} ${enabled ? 'enabled' : 'disabled'}`,
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
});

/**
 * @route PUT /api/preferences/quiet-hours
 * @desc Set quiet hours
 */
router.put('/quiet-hours', (req, res) => {
  try {
    const result = setQuietHours(req.userId, req.body);
    if (result.success) {
      return res.status(200).json({
        success: true,
        data: result.preferences.toJSON(),
        message: 'Quiet hours updated',
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
});

/**
 * @route POST /api/preferences/quiet-hours/toggle
 * @desc Toggle quiet hours
 */
router.post('/quiet-hours/toggle', (req, res) => {
  try {
    const { enabled } = req.body;
    if (enabled === undefined) {
      return res.status(400).json({
        success: false,
        error: 'enabled field is required',
      });
    }

    const result = toggleQuietHours(req.userId, enabled);
    return res.status(200).json({
      success: true,
      data: result.preferences.toJSON(),
      message: `Quiet hours ${enabled ? 'enabled' : 'disabled'}`,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

/**
 * @route PUT /api/preferences/batching
 * @desc Configure batching settings
 */
router.put('/batching', (req, res) => {
  try {
    const result = setBatching(req.userId, req.body);
    if (result.success) {
      return res.status(200).json({
        success: true,
        data: result.preferences.toJSON(),
        message: 'Batching settings updated',
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
});

/**
 * @route POST /api/preferences/mute
 * @desc Mute notifications
 */
router.post('/mute', (req, res) => {
  try {
    const { durationMinutes } = req.body;
    const result = muteUser(req.userId, durationMinutes);
    return res.status(200).json({
      success: true,
      data: result.preferences.toJSON(),
      message: durationMinutes
        ? `Notifications muted for ${durationMinutes} minutes`
        : 'Notifications unmuted',
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

/**
 * @route POST /api/preferences/unmute
 * @desc Unmute notifications
 */
router.post('/unmute', (req, res) => {
  try {
    const result = unmuteUser(req.userId);
    return res.status(200).json({
      success: true,
      data: result.preferences.toJSON(),
      message: 'Notifications unmuted',
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

/**
 * @route POST /api/preferences/block
 * @desc Block a sender
 */
router.post('/block', (req, res) => {
  try {
    const { senderId } = req.body;
    if (!senderId) {
      return res.status(400).json({
        success: false,
        error: 'senderId is required',
      });
    }

    const result = blockSender(req.userId, senderId);
    return res.status(200).json({
      success: true,
      data: result.preferences.toJSON(),
      message: `Sender ${senderId} blocked`,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

/**
 * @route POST /api/preferences/unblock
 * @desc Unblock a sender
 */
router.post('/unblock', (req, res) => {
  try {
    const { senderId } = req.body;
    if (!senderId) {
      return res.status(400).json({
        success: false,
        error: 'senderId is required',
      });
    }

    const result = unblockSender(req.userId, senderId);
    return res.status(200).json({
      success: true,
      data: result.preferences.toJSON(),
      message: `Sender ${senderId} unblocked`,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

/**
 * @route PUT /api/preferences/category/:category
 * @desc Update category settings
 */
router.put('/category/:category', (req, res) => {
  try {
    const { category } = req.params;
    const result = updateCategorySettings(req.userId, category, req.body);
    if (result.success) {
      return res.status(200).json({
        success: true,
        data: result.preferences.toJSON(),
        message: `Category ${category} updated`,
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
});

/**
 * @route GET /api/preferences/all
 * @desc Get all preferences (admin only)
 */
router.get('/all', (req, res) => {
  try {
    const result = getAllPreferences({
      page: parseInt(req.query.page, 10) || 1,
      limit: parseInt(req.query.limit, 10) || 50,
      search: req.query.search,
    });
    return res.status(200).json({
      success: true,
      data: result.preferences.map((p) => p.toJSON()),
      pagination: result.pagination,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

module.exports = router;
