/**
 * Analytics REST API routes for metrics, dashboards, and reports.
 */

'use strict';

const express = require('express');
const router = express.Router();

const {
  getDashboard,
  getHourlyMetrics,
  getDailyMetrics,
  getUserEngagement,
  getChannelPerformance,
  getEventStream,
  exportReport,
} = require('../services/analyticsService');

const { getSchedulerStatus } = require('../services/schedulerService');
const { getDeliveryStats } = require('../services/deliveryService');
const { getRateLimitStats } = require('../middleware/rateLimiter');
const { getCircuitBreakerStats } = require('../utils/retry');
const { pubsub } = require('../utils/pubsub');
const { authenticate } = require('../middleware/auth');

router.use(authenticate);

/**
 * @route GET /api/analytics/dashboard
 * @desc Get main analytics dashboard
 */
router.get('/dashboard', (req, res) => {
  try {
    const dashboard = getDashboard();
    return res.status(200).json({
      success: true,
      data: dashboard,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

/**
 * @route GET /api/analytics/hourly
 * @desc Get hourly metrics
 */
router.get('/hourly', (req, res) => {
  try {
    const hours = parseInt(req.query.hours, 10) || 24;
    const metrics = getHourlyMetrics(Math.min(hours, 168));
    return res.status(200).json({
      success: true,
      data: metrics,
      meta: { hours, points: metrics.length },
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

/**
 * @route GET /api/analytics/daily
 * @desc Get daily metrics
 */
router.get('/daily', (req, res) => {
  try {
    const days = parseInt(req.query.days, 10) || 7;
    const metrics = getDailyMetrics(Math.min(days, 90));
    return res.status(200).json({
      success: true,
      data: metrics,
      meta: { days, points: metrics.length },
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

/**
 * @route GET /api/analytics/channel-performance
 * @desc Get channel performance comparison
 */
router.get('/channel-performance', (req, res) => {
  try {
    const performance = getChannelPerformance();
    return res.status(200).json({
      success: true,
      data: performance,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

/**
 * @route GET /api/analytics/user-engagement
 * @desc Get user engagement metrics
 */
router.get('/user-engagement', (req, res) => {
  try {
    const result = getUserEngagement({
      page: parseInt(req.query.page, 10) || 1,
      limit: parseInt(req.query.limit, 10) || 20,
      sortBy: req.query.sortBy || 'totalReceived',
      sortOrder: req.query.sortOrder || 'desc',
    });
    return res.status(200).json({
      success: true,
      data: result.engagement,
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
 * @route GET /api/analytics/events
 * @desc Get recent event stream
 */
router.get('/events', (req, res) => {
  try {
    const count = parseInt(req.query.count, 10) || 50;
    const type = req.query.type || null;
    const events = getEventStream(Math.min(count, 500), type);
    return res.status(200).json({
      success: true,
      data: events,
      meta: { count: events.length },
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

/**
 * @route GET /api/analytics/export
 * @desc Export analytics report
 */
router.get('/export', (req, res) => {
  try {
    const format = req.query.format || 'json';
    const report = exportReport(format, {
      hours: parseInt(req.query.hours, 10) || 24,
      days: parseInt(req.query.days, 10) || 7,
    });

    if (format === 'csv') {
      res.set('Content-Type', 'text/csv');
      res.set('Content-Disposition', 'attachment; filename="analytics.csv"');
      return res.send(report.data);
    }

    return res.status(200).json({
      success: true,
      data: report.data,
      meta: {
        format,
        generatedAt: new Date().toISOString(),
      },
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

/**
 * @route GET /api/analytics/system
 * @desc Get system health and status
 */
router.get('/system', (req, res) => {
  try {
    const scheduler = getSchedulerStatus();
    const delivery = getDeliveryStats();
    const rateLimits = getRateLimitStats();
    const circuitBreakers = getCircuitBreakerStats();
    const pubsubStats = pubsub.getStats();

    const memoryUsage = process.memoryUsage();

    const systemHealth = {
      status: 'healthy',
      uptime: process.uptime(),
      timestamp: new Date().toISOString(),
      version: process.version,
      platform: process.platform,
      memory: {
        used: Math.round(memoryUsage.heapUsed / 1024 / 1024),
        total: Math.round(memoryUsage.heapTotal / 1024 / 1024),
        rss: Math.round(memoryUsage.rss / 1024 / 1024),
        external: Math.round(memoryUsage.external / 1024 / 1024),
      },
      services: {
        scheduler,
        delivery: {
          totalDelivered: delivery.totalDelivered,
          totalFailed: delivery.totalFailed,
          storeSize: delivery.storeSize,
        },
        rateLimits,
        circuitBreakers,
        pubsub: pubsubStats,
      },
    };

    return res.status(200).json({
      success: true,
      data: systemHealth,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

module.exports = router;
