/**
 * Redis-like in-memory pub/sub implementation for notification distribution.
 * Supports topic-based messaging, pattern subscriptions, and message persistence.
 */

'use strict';

const { EventEmitter } = require('events');
const { logger } = require('./logger');

/**
 * Message structure for pub/sub events
 */
class PubSubMessage {
  constructor(topic, payload, metadata = {}) {
    this.id = `msg_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
    this.topic = topic;
    this.payload = payload;
    this.timestamp = Date.now();
    this.metadata = metadata;
  }
}

/**
 * In-memory pub/sub engine with topic-based routing
 */
class PubSubEngine extends EventEmitter {
  constructor() {
    super();
    this.subscriptions = new Map();       // topic -> Set<handler>
    this.patternSubscriptions = new Map(); // pattern -> Set<handler>
    this.messageHistory = new Map();       // topic -> Array<message>
    this.maxHistoryPerTopic = 100;
    this.subscriberCount = new Map();      // topic -> count
    this.messageCount = 0;
  }

  /**
   * Subscribe to a topic with a handler function
   */
  subscribe(topic, handler, options = {}) {
    if (typeof handler !== 'function') {
      throw new TypeError('Handler must be a function');
    }

    if (!this.subscriptions.has(topic)) {
      this.subscriptions.set(topic, new Set());
    }

    const handlerEntry = {
      handler,
      once: options.once || false,
      createdAt: Date.now(),
    };

    this.subscriptions.get(topic).add(handlerEntry);
    this.subscriberCount.set(topic, (this.subscriberCount.get(topic) || 0) + 1);

    logger.debug(`Subscribed to topic: ${topic}, total: ${this.subscriberCount.get(topic)}`);
    return () => this.unsubscribe(topic, handlerEntry);
  }

  /**
   * Subscribe to topics matching a glob pattern
   */
  subscribePattern(pattern, handler) {
    if (!this.patternSubscriptions.has(pattern)) {
      this.patternSubscriptions.set(pattern, new Set());
    }

    const entry = { handler, createdAt: Date.now() };
    this.patternSubscriptions.get(pattern).add(entry);

    logger.debug(`Pattern subscription added: ${pattern}`);
    return () => {
      this.patternSubscriptions.get(pattern).delete(entry);
      if (this.patternSubscriptions.get(pattern).size === 0) {
        this.patternSubscriptions.delete(pattern);
      }
    };
  }

  /**
   * Unsubscribe a handler from a topic
   */
  unsubscribe(topic, handlerEntry) {
    if (!this.subscriptions.has(topic)) return false;

    const removed = this.subscriptions.get(topic).delete(handlerEntry);
    if (removed) {
      const currentCount = (this.subscriberCount.get(topic) || 0) - 1;
      this.subscriberCount.set(topic, currentCount);
      if (currentCount <= 0) {
        this.subscriberCount.delete(topic);
        this.subscriptions.delete(topic);
      }
    }
    return removed;
  }

  /**
   * Publish a message to a topic
   */
  publish(topic, payload, metadata = {}) {
    const message = new PubSubMessage(topic, payload, metadata);
    this.messageCount++;

    // Store in history
    this.addToHistory(topic, message);

    // Direct subscriptions
    const subscribers = this.subscriptions.get(topic);
    if (subscribers) {
      subscribers.forEach((entry) => {
        try {
          entry.handler(message.payload, message);
          if (entry.once) {
            this.unsubscribe(topic, entry);
          }
        } catch (err) {
          logger.error(`Pub/sub handler error for topic ${topic}: ${err.message}`);
        }
      });
    }

    // Pattern subscriptions
    this.patternSubscriptions.forEach((handlers, pattern) => {
      if (this.matchPattern(topic, pattern)) {
        handlers.forEach((entry) => {
          try {
            entry.handler(message.payload, message);
          } catch (err) {
            logger.error(`Pattern handler error for ${pattern}: ${err.message}`);
          }
        });
      }
    });

    // Emit on the engine itself
    this.emit(topic, message.payload, message);
    this.emit('message', message);

    return message;
  }

  /**
   * Store message in topic history
   */
  addToHistory(topic, message) {
    if (!this.messageHistory.has(topic)) {
      this.messageHistory.set(topic, []);
    }

    const history = this.messageHistory.get(topic);
    history.push(message);

    // Trim history to max size
    if (history.length > this.maxHistoryPerTopic) {
      this.messageHistory.set(topic, history.slice(-this.maxHistoryPerTopic));
    }
  }

  /**
   * Get message history for a topic
   */
  getHistory(topic, limit = 50) {
    const history = this.messageHistory.get(topic) || [];
    return history.slice(-limit);
  }

  /**
   * Match a topic against a glob-style pattern
   */
  matchPattern(topic, pattern) {
    const regex = new RegExp(
      '^' + pattern.replace(/\*/g, '.*').replace(/\?/g, '.') + '$'
    );
    return regex.test(topic);
  }

  /**
   * Get subscriber stats
   */
  getStats() {
    return {
      totalTopics: this.subscriptions.size,
      totalPatternSubs: this.patternSubscriptions.size,
      totalMessages: this.messageCount,
      topics: Array.from(this.subscriberCount.entries()).map(([topic, count]) => ({
        topic,
        subscribers: count,
      })),
    };
  }

  /**
   * Flush all subscriptions and history
   */
  flush() {
    this.subscriptions.clear();
    this.patternSubscriptions.clear();
    this.messageHistory.clear();
    this.subscriberCount.clear();
    this.messageCount = 0;
    logger.info('Pub/sub engine flushed');
  }

  /**
   * Create a namespaced pub/sub instance
   */
  namespace(ns) {
    const prefix = `${ns}:`;
    return {
      subscribe: (topic, handler, opts) => this.subscribe(prefix + topic, handler, opts),
      publish: (topic, payload, meta) => this.publish(prefix + topic, payload, meta),
      getHistory: (topic, limit) => this.getHistory(prefix + topic, limit),
    };
  }
}

// Singleton instance
const pubsub = new PubSubEngine();

module.exports = {
  PubSubEngine,
  PubSubMessage,
  pubsub,
};
