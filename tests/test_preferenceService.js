/**
 * Unit tests for the preference service
 */

'use strict';

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
  shouldDeliver,
  getPreferenceSummary,
  resetStore,
} = require('../src/services/preferenceService');

describe('PreferenceService', () => {
  const testUserId = 'user_pref_test';

  beforeEach(() => {
    resetStore();
  });

  describe('getPreferences', () => {
    test('should create default preferences for new user', () => {
      const result = getPreferences(testUserId);
      expect(result.success).toBe(true);
      expect(result.preferences).toBeDefined();
      expect(result.preferences.userId).toBe(testUserId);
      expect(result.preferences.inApp.enabled).toBe(true);
      expect(result.preferences.email.enabled).toBe(true);
      expect(result.preferences.push.enabled).toBe(true);
    });

    test('should return existing preferences', () => {
      getPreferences(testUserId);
      const result = getPreferences(testUserId);
      expect(result.success).toBe(true);
      expect(result.preferences.userId).toBe(testUserId);
    });
  });

  describe('createPreferences', () => {
    test('should create preferences with custom values', () => {
      const result = createPreferences(testUserId, {
        inApp: { enabled: false, sound: false },
        email: { enabled: false, digestFrequency: 'daily' },
      });

      expect(result.success).toBe(true);
      expect(result.preferences.inApp.enabled).toBe(false);
      expect(result.preferences.email.digestFrequency).toBe('daily');
    });

    test('should reject duplicate creation', () => {
      createPreferences(testUserId, { inApp: { enabled: false } });
      const result = createPreferences(testUserId, { inApp: { enabled: true } });
      expect(result.success).toBe(false);
      expect(result.error).toContain('already exist');
    });

    test('should validate preferences', () => {
      const result = createPreferences(testUserId, {
        email: { digestFrequency: 'invalid' },
      });
      expect(result.success).toBe(false);
      expect(result.error).toContain('Invalid digest frequency');
    });
  });

  describe('updatePreferences', () => {
    test('should update specific fields', () => {
      const result = updatePreferences(testUserId, {
        inApp: { enabled: false },
        push: { sound: false },
      });

      expect(result.success).toBe(true);
      expect(result.preferences.inApp.enabled).toBe(false);
      expect(result.preferences.push.sound).toBe(false);
      // Other fields should remain defaults
      expect(result.preferences.inApp.desktopPopup).toBe(true);
    });

    test('should update nested objects without overwriting siblings', () => {
      updatePreferences(testUserId, {
        inApp: { enabled: true, sound: true, desktopPopup: true },
      });

      const result = updatePreferences(testUserId, {
        inApp: { sound: false },
      });

      expect(result.preferences.inApp.enabled).toBe(true);
      expect(result.preferences.inApp.sound).toBe(false);
      expect(result.preferences.inApp.desktopPopup).toBe(true);
    });
  });

  describe('resetPreferences', () => {
    test('should reset to defaults', () => {
      updatePreferences(testUserId, {
        inApp: { enabled: false },
        email: { enabled: false },
      });

      const result = resetPreferences(testUserId);
      expect(result.preferences.inApp.enabled).toBe(true);
      expect(result.preferences.email.enabled).toBe(true);
    });
  });

  describe('deletePreferences', () => {
    test('should delete preferences', () => {
      getPreferences(testUserId);
      const result = deletePreferences(testUserId);
      expect(result.success).toBe(true);

      // Should create defaults on next get
      const next = getPreferences(testUserId);
      expect(next.preferences.createdAt).not.toEqual(result.preferences?.createdAt);
    });

    test('should return error for non-existent user', () => {
      const result = deletePreferences('nonexistent');
      expect(result.success).toBe(false);
    });
  });

  describe('toggleChannel', () => {
    test('should enable channel', () => {
      const result = toggleChannel(testUserId, 'email', true);
      expect(result.success).toBe(true);
      expect(result.preferences.email.enabled).toBe(true);
    });

    test('should disable channel', () => {
      toggleChannel(testUserId, 'push', false);
      const result = toggleChannel(testUserId, 'push', false);
      expect(result.preferences.push.enabled).toBe(false);
    });

    test('should handle unknown channel', () => {
      const result = toggleChannel(testUserId, 'sms', true);
      expect(result.success).toBe(false);
      expect(result.error).toContain('Unknown channel');
    });
  });

  describe('quiet hours', () => {
    test('should set quiet hours', () => {
      const result = setQuietHours(testUserId, {
        enabled: true,
        start: '22:00',
        end: '08:00',
        timezone: 'America/New_York',
        allowUrgent: true,
      });

      expect(result.success).toBe(true);
      expect(result.preferences.quietHours.enabled).toBe(true);
      expect(result.preferences.quietHours.start).toBe('22:00');
      expect(result.preferences.quietHours.allowUrgent).toBe(true);
    });

    test('should detect quiet hours', () => {
      setQuietHours(testUserId, {
        enabled: true,
        start: '00:00',
        end: '23:59',
        allowUrgent: false,
      });

      const pref = getPreferences(testUserId).preferences;
      expect(pref.isInQuietHours()).toBe(true);
    });

    test('should toggle quiet hours', () => {
      toggleQuietHours(testUserId, true);
      const onResult = getPreferences(testUserId);
      expect(onResult.preferences.quietHours.enabled).toBe(true);

      toggleQuietHours(testUserId, false);
      const offResult = getPreferences(testUserId);
      expect(offResult.preferences.quietHours.enabled).toBe(false);
    });

    test('should allow urgent in quiet hours', () => {
      setQuietHours(testUserId, {
        enabled: true,
        start: '00:00',
        end: '23:59',
        allowUrgent: true,
      });

      const pref = getPreferences(testUserId).preferences;
      expect(pref.allowsUrgentInQuietHours()).toBe(true);
    });
  });

  describe('setBatching', () => {
    test('should configure batching', () => {
      const result = setBatching(testUserId, {
        enabled: true,
        intervalMinutes: 30,
        maxPerBatch: 20,
      });

      expect(result.success).toBe(true);
      expect(result.preferences.batching.enabled).toBe(true);
      expect(result.preferences.batching.intervalMinutes).toBe(30);
    });

    test('should check if batching enabled for category', () => {
      setBatching(testUserId, {
        enabled: true,
        byCategory: { marketing: true, social: false },
      });

      const pref = getPreferences(testUserId).preferences;
      expect(pref.isBatchingEnabled('marketing')).toBe(true);
      expect(pref.isBatchingEnabled('social')).toBe(false);
    });
  });

  describe('mute', () => {
    test('should mute for duration', () => {
      const result = muteUser(testUserId, 60);
      expect(result.success).toBe(true);
      expect(result.preferences.isMuted()).toBe(true);
      expect(result.muted).toBe(true);
    });

    test('should unmute', () => {
      muteUser(testUserId, 60);
      const result = unmuteUser(testUserId);
      expect(result.preferences.isMuted()).toBe(false);
    });
  });

  describe('blockSender', () => {
    test('should block sender', () => {
      const result = blockSender(testUserId, 'sender_123');
      expect(result.preferences.blockedSenders).toContain('sender_123');
    });

    test('should not duplicate blocked senders', () => {
      blockSender(testUserId, 'sender_123');
      blockSender(testUserId, 'sender_123');
      const pref = getPreferences(testUserId).preferences;
      expect(pref.blockedSenders.filter((s) => s === 'sender_123').length).toBe(1);
    });

    test('should unblock sender', () => {
      blockSender(testUserId, 'sender_123');
      const result = unblockSender(testUserId, 'sender_123');
      expect(result.preferences.blockedSenders).not.toContain('sender_123');
    });
  });

  describe('updateCategorySettings', () => {
    test('should update category settings', () => {
      const result = updateCategorySettings(testUserId, 'marketing', {
        enabled: false,
        channels: ['email'],
      });

      expect(result.success).toBe(true);
      expect(result.preferences.categories.marketing.enabled).toBe(false);
      expect(result.preferences.categories.marketing.channels).toEqual(['email']);
    });
  });

  describe('shouldDeliver', () => {
    test('should allow delivery when all defaults', () => {
      const result = shouldDeliver(testUserId, {
        channel: 'in_app',
        priority: 'normal',
        category: 'general',
      });
      expect(result).toBe(true);
    });

    test('should block disabled channel', () => {
      toggleChannel(testUserId, 'email', false);
      const result = shouldDeliver(testUserId, {
        channel: 'email',
        priority: 'normal',
      });
      expect(result).toBe(false);
    });

    test('should block muted user', () => {
      muteUser(testUserId, 60);
      const result = shouldDeliver(testUserId, {
        channel: 'in_app',
        priority: 'normal',
      });
      expect(result).toBe(false);
    });

    test('should allow urgent during quiet hours', () => {
      setQuietHours(testUserId, {
        enabled: true,
        start: '00:00',
        end: '23:59',
        allowUrgent: true,
      });

      const result = shouldDeliver(testUserId, {
        channel: 'in_app',
        priority: 'urgent',
        category: 'general',
      });
      expect(result).toBe(true);
    });

    test('should block non-urgent during quiet hours', () => {
      setQuietHours(testUserId, {
        enabled: true,
        start: '00:00',
        end: '23:59',
        allowUrgent: false,
      });

      const result = shouldDeliver(testUserId, {
        channel: 'in_app',
        priority: 'normal',
      });
      expect(result).toBe(false);
    });

    test('should block disabled category', () => {
      updateCategorySettings(testUserId, 'marketing', { enabled: false });
      const result = shouldDeliver(testUserId, {
        channel: 'in_app',
        priority: 'normal',
        category: 'marketing',
      });
      expect(result).toBe(false);
    });

    test('should block excluded channel for category', () => {
      updateCategorySettings(testUserId, 'social', {
        enabled: true,
        channels: ['in_app', 'push'],
      });

      const result = shouldDeliver(testUserId, {
        channel: 'email',
        priority: 'normal',
        category: 'social',
      });
      expect(result).toBe(false);
    });

    test('should block from blocked sender', () => {
      blockSender(testUserId, 'bad_sender');
      const result = shouldDeliver(testUserId, {
        channel: 'in_app',
        priority: 'normal',
        metadata: { senderId: 'bad_sender' },
      });
      expect(result).toBe(false);
    });
  });

  describe('getPreferenceSummary', () => {
    test('should return summary', () => {
      const result = getPreferenceSummary(testUserId);
      expect(result.success).toBe(true);
      expect(result.summary.userId).toBe(testUserId);
      expect(result.summary.channels).toBeDefined();
      expect(result.summary.quietHours).toBeDefined();
      expect(typeof result.summary.isInQuietHours).toBe('boolean');
      expect(typeof result.summary.isMuted).toBe('boolean');
    });
  });
});
