/**
 * User preference model for notification channel settings,
 * frequency controls, quiet hours, and category-based filtering.
 */

'use strict';

const { v4: uuidv4 } = require('uuid');
const { NotificationChannel, Priority } = require('./Notification');

/**
 * Default preference configuration
 */
const DEFAULT_PREFERENCES = Object.freeze({
  in_app: {
    enabled: true,
    sound: true,
    desktopPopup: true,
    showPreview: true,
  },
  email: {
    enabled: true,
    digestFrequency: 'immediate', // immediate, hourly, daily, weekly
    onlyPriority: null, // null = all, or array of priorities
  },
  push: {
    enabled: true,
    sound: true,
    vibration: true,
    badgeCount: true,
  },
  quietHours: {
    enabled: false,
    start: '22:00',
    end: '08:00',
    timezone: 'UTC',
    allowUrgent: true,
  },
  batching: {
    enabled: false,
    intervalMinutes: 15,
    maxPerBatch: 10,
    byCategory: {},
  },
  categories: {
    general: { enabled: true, channels: ['in_app', 'email', 'push'] },
    system: { enabled: true, channels: ['in_app', 'email', 'push'] },
    marketing: { enabled: true, channels: ['in_app', 'email'] },
    security: { enabled: true, channels: ['in_app', 'email', 'push'] },
    social: { enabled: true, channels: ['in_app', 'push'] },
  },
  blockedSenders: [],
  muteUntil: null,
});

/**
 * Valid digest frequencies
 */
const DigestFrequency = Object.freeze({
  IMMEDIATE: 'immediate',
  HOURLY: 'hourly',
  DAILY: 'daily',
  WEEKLY: 'weekly',
});

/**
 * User preference model
 */
class UserPreference {
  constructor(data = {}) {
    this.id = data.id || `pref_${uuidv4()}`;
    this.userId = data.userId || null;
    this.createdAt = data.createdAt || new Date().toISOString();
    this.updatedAt = data.updatedAt || this.createdAt;

    // Merge with defaults
    const merged = this.mergeWithDefaults(data);
    this.inApp = merged.in_app;
    this.email = merged.email;
    this.push = merged.push;
    this.quietHours = merged.quietHours;
    this.batching = merged.batching;
    this.categories = merged.categories;
    this.blockedSenders = merged.blockedSenders;
    this.muteUntil = merged.muteUntil;
  }

  /**
   * Merge provided data with defaults
   */
  mergeWithDefaults(data) {
    return {
      in_app: { ...DEFAULT_PREFERENCES.in_app, ...(data.inApp || data.in_app || {}) },
      email: { ...DEFAULT_PREFERENCES.email, ...(data.email || {}) },
      push: { ...DEFAULT_PREFERENCES.push, ...(data.push || {}) },
      quietHours: { ...DEFAULT_PREFERENCES.quietHours, ...(data.quietHours || {}) },
      batching: { ...DEFAULT_PREFERENCES.batching, ...(data.batching || {}) },
      categories: { ...DEFAULT_PREFERENCES.categories, ...(data.categories || {}) },
      blockedSenders: data.blockedSenders || DEFAULT_PREFERENCES.blockedSenders,
      muteUntil: data.muteUntil || DEFAULT_PREFERENCES.muteUntil,
    };
  }

  /**
   * Validate preference data
   */
  validate() {
    const errors = [];

    if (!this.userId || typeof this.userId !== 'string') {
      errors.push('userId is required and must be a string');
    }

    // Validate channel booleans
    if (this.inApp && typeof this.inApp.enabled !== 'boolean') {
      errors.push('inApp.enabled must be a boolean');
    }
    if (this.email && typeof this.email.enabled !== 'boolean') {
      errors.push('email.enabled must be a boolean');
    }
    if (this.push && typeof this.push.enabled !== 'boolean') {
      errors.push('push.enabled must be a boolean');
    }

    // Validate digest frequency
    if (this.email && this.email.digestFrequency) {
      const validFrequencies = Object.values(DigestFrequency);
      if (!validFrequencies.includes(this.email.digestFrequency)) {
        errors.push(`Invalid digest frequency: ${this.email.digestFrequency}`);
      }
    }

    // Validate quiet hours
    if (this.quietHours && this.quietHours.enabled) {
      const timeRegex = /^([01]\d|2[0-3]):([0-5]\d)$/;
      if (!timeRegex.test(this.quietHours.start)) {
        errors.push('quietHours.start must be in HH:MM format');
      }
      if (!timeRegex.test(this.quietHours.end)) {
        errors.push('quietHours.end must be in HH:MM format');
      }
    }

    // Validate batching
    if (this.batching && this.batching.enabled) {
      if (typeof this.batching.intervalMinutes !== 'number' || this.batching.intervalMinutes < 1) {
        errors.push('batching.intervalMinutes must be a positive number');
      }
      if (typeof this.batching.maxPerBatch !== 'number' || this.batching.maxPerBatch < 1) {
        errors.push('batching.maxPerBatch must be a positive number');
      }
    }

    if (errors.length > 0) {
      const error = new Error('Preference validation failed: ' + errors.join('; '));
      error.name = 'ValidationError';
      error.errors = errors;
      throw error;
    }

    return true;
  }

  /**
   * Check if a channel is enabled for the user
   */
  isChannelEnabled(channel) {
    switch (channel) {
      case NotificationChannel.IN_APP:
        return this.inApp && this.inApp.enabled;
      case NotificationChannel.EMAIL:
        return this.email && this.email.enabled;
      case NotificationChannel.PUSH:
        return this.push && this.push.enabled;
      default:
        return false;
    }
  }

  /**
   * Check if a category is enabled for a channel
   */
  isCategoryEnabled(category, channel) {
    const catConfig = this.categories[category];
    if (!catConfig) return true; // Default to enabled
    if (!catConfig.enabled) return false;
    if (channel && catConfig.channels && !catConfig.channels.includes(channel)) {
      return false;
    }
    return true;
  }

  /**
   * Check if user is currently in quiet hours
   */
  isInQuietHours() {
    if (!this.quietHours || !this.quietHours.enabled) {
      return false;
    }

    const now = new Date();
    const currentMinutes = now.getUTCHours() * 60 + now.getUTCMinutes();

    const [startH, startM] = this.quietHours.start.split(':').map(Number);
    const [endH, endM] = this.quietHours.end.split(':').map(Number);
    const startMinutes = startH * 60 + startM;
    const endMinutes = endH * 60 + endM;

    if (startMinutes < endMinutes) {
      return currentMinutes >= startMinutes && currentMinutes < endMinutes;
    }
    // Spanning midnight
    return currentMinutes >= startMinutes || currentMinutes < endMinutes;
  }

  /**
   * Check if urgent notifications should bypass quiet hours
   */
  allowsUrgentInQuietHours() {
    return this.quietHours && this.quietHours.allowUrgent;
  }

  /**
   * Check if user is currently muted
   */
  isMuted() {
    if (!this.muteUntil) return false;
    return new Date(this.muteUntil) > new Date();
  }

  /**
   * Check if a sender is blocked
   */
  isBlocked(senderId) {
    return this.blockedSenders.includes(senderId);
  }

  /**
   * Check if batching is enabled
   */
  isBatchingEnabled(category = 'general') {
    if (!this.batching || !this.batching.enabled) return false;
    const catBatch = this.batching.byCategory[category];
    if (catBatch !== undefined) return catBatch;
    return true;
  }

  /**
   * Get batch interval for a category
   */
  getBatchInterval(category = 'general') {
    const defaultInterval = this.batching?.intervalMinutes || 15;
    return defaultInterval;
  }

  /**
   * Check if priority should be sent via email based on preferences
   */
  shouldSendEmailForPriority(priority) {
    if (!this.email || !this.email.enabled) return false;
    if (!this.email.onlyPriority) return true;
    return this.email.onlyPriority.includes(priority);
  }

  /**
   * Determine if a notification should be delivered based on all preferences
   */
  shouldDeliver(notification) {
    // Check mute
    if (this.isMuted()) return false;

    // Check if channel enabled
    if (!this.isChannelEnabled(notification.channel)) return false;

    // Check category
    if (!this.isCategoryEnabled(notification.category, notification.channel)) return false;

    // Check quiet hours
    if (this.isInQuietHours()) {
      if (notification.priority === Priority.URGENT && this.allowsUrgentInQuietHours()) {
        return true;
      }
      return false;
    }

    // Check blocked senders
    if (notification.metadata && notification.metadata.senderId) {
      if (this.isBlocked(notification.metadata.senderId)) return false;
    }

    return true;
  }

  /**
   * Update preferences with partial data
   */
  update(updates) {
    if (updates.inApp) {
      this.inApp = { ...this.inApp, ...updates.inApp };
    }
    if (updates.email) {
      this.email = { ...this.email, ...updates.email };
    }
    if (updates.push) {
      this.push = { ...this.push, ...updates.push };
    }
    if (updates.quietHours) {
      this.quietHours = { ...this.quietHours, ...updates.quietHours };
    }
    if (updates.batching) {
      this.batching = { ...this.batching, ...updates.batching };
    }
    if (updates.categories) {
      this.categories = { ...this.categories, ...updates.categories };
    }
    if (updates.blockedSenders) {
      this.blockedSenders = [...updates.blockedSenders];
    }
    if (updates.muteUntil !== undefined) {
      this.muteUntil = updates.muteUntil;
    }

    this.updatedAt = new Date().toISOString();
    return this;
  }

  /**
   * Serialize to JSON
   */
  toJSON() {
    return {
      id: this.id,
      userId: this.userId,
      inApp: this.inApp,
      email: this.email,
      push: this.push,
      quietHours: this.quietHours,
      batching: this.batching,
      categories: this.categories,
      blockedSenders: this.blockedSenders,
      muteUntil: this.muteUntil,
      createdAt: this.createdAt,
      updatedAt: this.updatedAt,
    };
  }

  /**
   * Create from JSON data
   */
  static fromJSON(data) {
    return new UserPreference(data);
  }

  /**
   * Create default preferences for a user
   */
  static createDefault(userId) {
    return new UserPreference({ userId });
  }
}

module.exports = {
  UserPreference,
  DEFAULT_PREFERENCES,
  DigestFrequency,
};
