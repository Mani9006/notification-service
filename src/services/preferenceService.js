/**
 * User preference service managing notification settings,
 * channel preferences, quiet hours, and category filters.
 */

'use strict';

const { UserPreference, DEFAULT_PREFERENCES } = require('../models/UserPreference');
const { logger } = require('../utils/logger');

// In-memory preference store
const preferenceStore = new Map();

/**
 * Get or create preferences for a user
 */
const getPreferences = (userId) => {
  let pref = preferenceStore.get(userId);
  if (!pref) {
    pref = UserPreference.createDefault(userId);
    preferenceStore.set(userId, pref);
    logger.debug(`Created default preferences for user ${userId}`);
  }
  return { success: true, preferences: pref };
};

/**
 * Create preferences for a user (explicit)
 */
const createPreferences = (userId, data = {}) => {
  if (preferenceStore.has(userId)) {
    return { success: false, error: 'Preferences already exist for this user' };
  }

  try {
    const pref = new UserPreference({ ...data, userId });
    pref.validate();
    preferenceStore.set(userId, pref);
    logger.info(`Preferences created for user ${userId}`);
    return { success: true, preferences: pref };
  } catch (error) {
    logger.error(`Preference creation failed: ${error.message}`);
    return { success: false, error: error.message };
  }
};

/**
 * Update user preferences
 */
const updatePreferences = (userId, updates) => {
  const result = getPreferences(userId);
  if (!result.success) return result;

  try {
    const pref = result.preferences;
    pref.update(updates);
    pref.validate();

    logger.info(`Preferences updated for user ${userId}`);
    return { success: true, preferences: pref };
  } catch (error) {
    logger.error(`Preference update failed: ${error.message}`);
    return { success: false, error: error.message };
  }
};

/**
 * Reset preferences to defaults
 */
const resetPreferences = (userId) => {
  const pref = UserPreference.createDefault(userId);
  preferenceStore.set(userId, pref);
  logger.info(`Preferences reset to defaults for user ${userId}`);
  return { success: true, preferences: pref };
};

/**
 * Delete user preferences
 */
const deletePreferences = (userId) => {
  const removed = preferenceStore.delete(userId);
  if (!removed) {
    return { success: false, error: 'Preferences not found' };
  }
  logger.info(`Preferences deleted for user ${userId}`);
  return { success: true };
};

/**
 * Enable/disable a channel
 */
const toggleChannel = (userId, channel, enabled) => {
  const result = getPreferences(userId);
  if (!result.success) return result;

  const pref = result.preferences;
  const updates = {};

  switch (channel) {
    case 'in_app':
      updates.inApp = { ...pref.inApp, enabled };
      break;
    case 'email':
      updates.email = { ...pref.email, enabled };
      break;
    case 'push':
      updates.push = { ...pref.push, enabled };
      break;
    default:
      return { success: false, error: `Unknown channel: ${channel}` };
  }

  pref.update(updates);
  return { success: true, preferences: pref };
};

/**
 * Set quiet hours
 */
const setQuietHours = (userId, quietHoursData) => {
  const result = getPreferences(userId);
  if (!result.success) return result;

  const pref = result.preferences;
  pref.update({ quietHours: quietHoursData });
  return { success: true, preferences: pref };
};

/**
 * Toggle quiet hours
 */
const toggleQuietHours = (userId, enabled) => {
  const result = getPreferences(userId);
  if (!result.success) return result;

  const pref = result.preferences;
  pref.update({
    quietHours: { ...pref.quietHours, enabled },
  });
  return { success: true, preferences: pref };
};

/**
 * Configure batching settings
 */
const setBatching = (userId, batchingData) => {
  const result = getPreferences(userId);
  if (!result.success) return result;

  const pref = result.preferences;
  pref.update({ batching: batchingData });
  return { success: true, preferences: pref };
};

/**
 * Mute notifications for a duration
 */
const muteUser = (userId, durationMinutes = null) => {
  const result = getPreferences(userId);
  if (!result.success) return result;

  const pref = result.preferences;
  let muteUntil = null;

  if (durationMinutes) {
    muteUntil = new Date(Date.now() + durationMinutes * 60000).toISOString();
  }

  pref.update({ muteUntil });
  return { success: true, preferences: pref, muted: durationMinutes !== null };
};

/**
 * Unmute notifications
 */
const unmuteUser = (userId) => {
  return muteUser(userId, null);
};

/**
 * Block a sender
 */
const blockSender = (userId, senderId) => {
  const result = getPreferences(userId);
  if (!result.success) return result;

  const pref = result.preferences;
  const blockedSenders = [...pref.blockedSenders];
  if (!blockedSenders.includes(senderId)) {
    blockedSenders.push(senderId);
  }

  pref.update({ blockedSenders });
  return { success: true, preferences: pref };
};

/**
 * Unblock a sender
 */
const unblockSender = (userId, senderId) => {
  const result = getPreferences(userId);
  if (!result.success) return result;

  const pref = result.preferences;
  const blockedSenders = pref.blockedSenders.filter((id) => id !== senderId);

  pref.update({ blockedSenders });
  return { success: true, preferences: pref };
};

/**
 * Update category settings
 */
const updateCategorySettings = (userId, category, settings) => {
  const result = getPreferences(userId);
  if (!result.success) return result;

  const pref = result.preferences;
  const categories = {
    ...pref.categories,
    [category]: {
      ...pref.categories[category],
      ...settings,
    },
  };

  pref.update({ categories });
  return { success: true, preferences: pref };
};

/**
 * Check if a notification should be delivered based on preferences
 */
const shouldDeliver = (userId, notification) => {
  const result = getPreferences(userId);
  if (!result.success) return true; // Default to deliver

  return result.preferences.shouldDeliver(notification);
};

/**
 * Get preference summary for a user
 */
const getPreferenceSummary = (userId) => {
  const result = getPreferences(userId);
  if (!result.success) return result;

  const pref = result.preferences;

  return {
    success: true,
    summary: {
      userId,
      channels: {
        in_app: pref.inApp,
        email: pref.email,
        push: pref.push,
      },
      quietHours: pref.quietHours,
      isInQuietHours: pref.isInQuietHours(),
      isMuted: pref.isMuted(),
      batching: pref.batching,
      blockedSendersCount: pref.blockedSenders.length,
    },
  };
};

/**
 * Get all preferences (admin)
 */
const getAllPreferences = (options = {}) => {
  const { page = 1, limit = 50, search = null } = options;

  let results = Array.from(preferenceStore.values());

  if (search) {
    results = results.filter((p) => p.userId.includes(search));
  }

  const total = results.length;
  const start = (page - 1) * limit;
  const paginated = results.slice(start, start + limit);

  return {
    preferences: paginated,
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
    },
  };
};

/**
 * Reset store (for testing)
 */
const resetStore = () => {
  preferenceStore.clear();
};

module.exports = {
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
  shouldDeliver,
  getPreferenceSummary,
  getAllPreferences,
  resetStore,
};
