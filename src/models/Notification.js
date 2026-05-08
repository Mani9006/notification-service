/**
 * Notification model representing a notification entity with
 * full lifecycle state management and validation.
 */

'use strict';

const { v4: uuidv4 } = require('uuid');
const config = require('../config');

/**
 * Valid notification statuses
 */
const NotificationStatus = Object.freeze({
  PENDING: 'pending',
  QUEUED: 'queued',
  DELIVERING: 'delivering',
  DELIVERED: 'delivered',
  READ: 'read',
  FAILED: 'failed',
  RETRYING: 'retrying',
  CANCELLED: 'cancelled',
  SCHEDULED: 'scheduled',
});

/**
 * Valid notification channels
 */
const NotificationChannel = Object.freeze({
  IN_APP: 'in_app',
  EMAIL: 'email',
  PUSH: 'push',
});

/**
 * Priority levels
 */
const Priority = Object.freeze({
  LOW: 'low',
  NORMAL: 'normal',
  HIGH: 'high',
  URGENT: 'urgent',
});

/**
 * Notification model class
 */
class Notification {
  constructor(data = {}) {
    this.id = data.id || `notif_${uuidv4()}`;
    this.userId = data.userId || null;
    this.title = data.title || '';
    this.body = data.body || '';
    this.channel = data.channel || NotificationChannel.IN_APP;
    this.priority = data.priority || Priority.NORMAL;
    this.status = data.status || NotificationStatus.PENDING;
    this.templateId = data.templateId || null;
    this.templateData = data.templateData || {};

    // Timestamps
    this.createdAt = data.createdAt || new Date().toISOString();
    this.updatedAt = data.updatedAt || this.createdAt;
    this.scheduledFor = data.scheduledFor || null;
    this.deliveredAt = data.deliveredAt || null;
    this.readAt = data.readAt || null;
    this.expiresAt = data.expiresAt || this.calculateExpiry();

    // Metadata
    this.metadata = data.metadata || {};
    this.tags = data.tags || [];
    this.category = data.category || 'general';

    // Delivery tracking
    this.retryCount = data.retryCount || 0;
    this.maxRetries = data.maxRetries || config.retry.maxAttempts;
    this.deliveryAttempts = data.deliveryAttempts || [];
    this.lastError = data.lastError || null;

    // Read status
    this.isRead = data.isRead || false;
    this.readBy = data.readBy || null;

    // Batch info
    this.batchId = data.batchId || null;
  }

  /**
   * Calculate expiry timestamp based on TTL
   */
  calculateExpiry() {
    const ttlMs = (config.notification.defaultTtlHours || 72) * 3600000;
    return new Date(Date.now() + ttlMs).toISOString();
  }

  /**
   * Validate the notification data
   */
  validate() {
    const errors = [];

    if (!this.userId || typeof this.userId !== 'string') {
      errors.push('userId is required and must be a string');
    }

    if (!this.title || this.title.trim().length === 0) {
      errors.push('title is required');
    }

    if (!this.body || this.body.trim().length === 0) {
      errors.push('body is required');
    }

    if (!Object.values(NotificationChannel).includes(this.channel)) {
      errors.push(`Invalid channel: ${this.channel}`);
    }

    if (!Object.values(Priority).includes(this.priority)) {
      errors.push(`Invalid priority: ${this.priority}`);
    }

    if (!Object.values(NotificationStatus).includes(this.status)) {
      errors.push(`Invalid status: ${this.status}`);
    }

    if (this.title && this.title.length > 200) {
      errors.push('title must not exceed 200 characters');
    }

    if (this.body && this.body.length > 5000) {
      errors.push('body must not exceed 5000 characters');
    }

    if (errors.length > 0) {
      const validationError = new Error('Validation failed: ' + errors.join('; '));
      validationError.name = 'ValidationError';
      validationError.errors = errors;
      throw validationError;
    }

    return true;
  }

  /**
   * Mark as queued for delivery
   */
  markQueued() {
    this.status = NotificationStatus.QUEUED;
    this.updatedAt = new Date().toISOString();
    return this;
  }

  /**
   * Mark as currently delivering
   */
  markDelivering() {
    this.status = NotificationStatus.DELIVERING;
    this.updatedAt = new Date().toISOString();
    return this;
  }

  /**
   * Mark as successfully delivered
   */
  markDelivered() {
    this.status = NotificationStatus.DELIVERED;
    this.deliveredAt = new Date().toISOString();
    this.updatedAt = new Date().toISOString();
    return this;
  }

  /**
   * Mark as read
   */
  markRead(readerId) {
    this.isRead = true;
    this.readAt = new Date().toISOString();
    this.readBy = readerId || this.userId;
    this.status = NotificationStatus.READ;
    this.updatedAt = new Date().toISOString();
    return this;
  }

  /**
   * Mark as unread (for re-notification scenarios)
   */
  markUnread() {
    this.isRead = false;
    this.readAt = null;
    this.readBy = null;
    this.status = this.deliveredAt ? NotificationStatus.DELIVERED : NotificationStatus.PENDING;
    this.updatedAt = new Date().toISOString();
    return this;
  }

  /**
   * Record a delivery attempt
   */
  recordAttempt(success, error = null) {
    this.deliveryAttempts.push({
      timestamp: new Date().toISOString(),
      success,
      error: error ? error.message : null,
      attemptNumber: this.deliveryAttempts.length + 1,
    });

    if (!success) {
      this.retryCount++;
      this.lastError = error ? error.message : 'Unknown error';
    }

    this.updatedAt = new Date().toISOString();
    return this;
  }

  /**
   * Mark as failed
   */
  markFailed(error) {
    this.status = NotificationStatus.FAILED;
    this.lastError = error ? error.message : 'Unknown error';
    this.recordAttempt(false, error);
    this.updatedAt = new Date().toISOString();
    return this;
  }

  /**
   * Mark as retrying
   */
  markRetrying() {
    this.status = NotificationStatus.RETRYING;
    this.updatedAt = new Date().toISOString();
    return this;
  }

  /**
   * Mark as scheduled
   */
  markScheduled(scheduleTime) {
    this.status = NotificationStatus.SCHEDULED;
    this.scheduledFor = scheduleTime;
    this.updatedAt = new Date().toISOString();
    return this;
  }

  /**
   * Mark as cancelled
   */
  markCancelled(reason = 'User cancelled') {
    this.status = NotificationStatus.CANCELLED;
    this.lastError = reason;
    this.updatedAt = new Date().toISOString();
    return this;
  }

  /**
   * Check if the notification is expired
   */
  isExpired() {
    return this.expiresAt && new Date(this.expiresAt) < new Date();
  }

  /**
   * Check if the notification can be retried
   */
  canRetry() {
    return (
      this.retryCount < this.maxRetries &&
      this.status !== NotificationStatus.CANCELLED &&
      this.status !== NotificationStatus.READ &&
      !this.isExpired()
    );
  }

  /**
   * Check if the notification is scheduled
   */
  isScheduled() {
    return this.status === NotificationStatus.SCHEDULED && this.scheduledFor !== null;
  }

  /**
   * Check if the scheduled time has been reached
   */
  isScheduleDue() {
    if (!this.isScheduled()) return false;
    return new Date(this.scheduledFor) <= new Date();
  }

  /**
   * Serialize to JSON
   */
  toJSON() {
    return {
      id: this.id,
      userId: this.userId,
      title: this.title,
      body: this.body,
      channel: this.channel,
      priority: this.priority,
      status: this.status,
      templateId: this.templateId,
      templateData: this.templateData,
      createdAt: this.createdAt,
      updatedAt: this.updatedAt,
      scheduledFor: this.scheduledFor,
      deliveredAt: this.deliveredAt,
      readAt: this.readAt,
      expiresAt: this.expiresAt,
      metadata: this.metadata,
      tags: this.tags,
      category: this.category,
      retryCount: this.retryCount,
      maxRetries: this.maxRetries,
      isRead: this.isRead,
      batchId: this.batchId,
      deliveryAttempts: this.deliveryAttempts,
      lastError: this.lastError,
    };
  }

  /**
   * Create from JSON data
   */
  static fromJSON(data) {
    return new Notification(data);
  }
}

module.exports = {
  Notification,
  NotificationStatus,
  NotificationChannel,
  Priority,
};
