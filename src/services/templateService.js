/**
 * Template management service for CRUD operations,
 * rendering, and template analytics.
 */

'use strict';

const { Template } = require('../models/Template');
const { logger } = require('../utils/logger');
const { pubsub } = require('../utils/pubsub');

// In-memory template store
const templateStore = new Map();

/**
 * Create a new template
 */
const createTemplate = (data) => {
  try {
    const template = new Template(data);
    template.validate();

    // Check for duplicate name
    for (const existing of templateStore.values()) {
      if (existing.name === template.name && existing.channel === template.channel) {
        throw new Error(`Template "${template.name}" already exists for channel "${template.channel}"`);
      }
    }

    templateStore.set(template.id, template);

    pubsub.publish('templates:created', {
      templateId: template.id,
      name: template.name,
    });

    logger.info(`Template created: ${template.name} (${template.id})`);
    return { success: true, template };
  } catch (error) {
    logger.error(`Template creation failed: ${error.message}`);
    return { success: false, error: error.message };
  }
};

/**
 * Get a template by ID
 */
const getTemplate = (id) => {
  const template = templateStore.get(id);
  if (!template) {
    return { success: false, error: 'Template not found' };
  }
  return { success: true, template };
};

/**
 * List templates with filtering and pagination
 */
const listTemplates = (options = {}) => {
  const {
    channel = null,
    category = null,
    isActive = null,
    search = null,
    tags = null,
    page = 1,
    limit = 20,
    sortBy = 'createdAt',
    sortOrder = 'desc',
  } = options;

  let results = Array.from(templateStore.values());

  if (channel) results = results.filter((t) => t.channel === channel);
  if (category) results = results.filter((t) => t.category === category);
  if (isActive !== null) results = results.filter((t) => t.isActive === isActive);
  if (search) {
    const s = search.toLowerCase();
    results = results.filter((t) =>
      (t.name && t.name.toLowerCase().includes(s)) ||
      (t.description && t.description.toLowerCase().includes(s))
    );
  }
  if (tags) {
    const tagList = tags.split(',').map((t) => t.trim().toLowerCase());
    results = results.filter((t) =>
      tagList.some((tag) => t.tags.map((tg) => tg.toLowerCase()).includes(tag))
    );
  }

  // Sort
  results.sort((a, b) => {
    const aVal = a[sortBy] || '';
    const bVal = b[sortBy] || '';
    if (sortOrder === 'desc') {
      return String(bVal).localeCompare(String(aVal));
    }
    return String(aVal).localeCompare(String(bVal));
  });

  const total = results.length;
  const start = (page - 1) * limit;
  const paginated = results.slice(start, start + limit);

  return {
    templates: paginated,
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
      hasNext: start + limit < total,
      hasPrev: page > 1,
    },
  };
};

/**
 * Update a template
 */
const updateTemplate = (id, updates) => {
  const template = templateStore.get(id);
  if (!template) {
    return { success: false, error: 'Template not found' };
  }

  try {
    template.update(updates);

    pubsub.publish('templates:updated', {
      templateId: template.id,
      name: template.name,
    });

    logger.info(`Template updated: ${template.name} (${template.id})`);
    return { success: true, template };
  } catch (error) {
    logger.error(`Template update failed: ${error.message}`);
    return { success: false, error: error.message };
  }
};

/**
 * Delete a template
 */
const deleteTemplate = (id) => {
  const template = templateStore.get(id);
  if (!template) {
    return { success: false, error: 'Template not found' };
  }

  templateStore.delete(id);

  pubsub.publish('templates:deleted', {
    templateId: id,
    name: template.name,
  });

  logger.info(`Template deleted: ${template.name} (${id})`);
  return { success: true };
};

/**
 * Render a template with data
 */
const renderTemplate = (id, data = {}, options = {}) => {
  const result = getTemplate(id);
  if (!result.success) {
    return result;
  }

  try {
    const rendered = result.template.render(data, options);
    return {
      success: true,
      rendered,
      template: {
        id: result.template.id,
        name: result.template.name,
        version: result.template.version,
        channel: result.template.channel,
      },
    };
  } catch (error) {
    logger.error(`Template render failed: ${error.message}`);
    return { success: false, error: error.message };
  }
};

/**
 * Preview a template (render without storing)
 */
const previewTemplate = (templateData, data = {}) => {
  try {
    const template = new Template(templateData);
    template.validate();
    const rendered = template.render(data, { locale: templateData.locale });
    return { success: true, rendered };
  } catch (error) {
    return { success: false, error: error.message };
  }
};

/**
 * Clone a template
 */
const cloneTemplate = (id, overrides = {}) => {
  const result = getTemplate(id);
  if (!result.success) {
    return result;
  }

  const original = result.template;
  const cloned = new Template({
    ...original.toJSON(),
    ...overrides,
    id: undefined, // Will generate new ID
    name: overrides.name || `${original.name} (Copy)`,
    version: '1.0.0',
    useCount: 0,
    lastUsedAt: null,
  });

  templateStore.set(cloned.id, cloned);
  logger.info(`Template cloned: ${original.name} -> ${cloned.name} (${cloned.id})`);
  return { success: true, template: cloned };
};

/**
 * Get template usage statistics
 */
const getTemplateStats = () => {
  const templates = Array.from(templateStore.values());
  const total = templates.length;
  const active = templates.filter((t) => t.isActive).length;
  const inactive = total - active;

  const byChannel = {};
  const byCategory = {};

  for (const t of templates) {
    byChannel[t.channel] = (byChannel[t.channel] || 0) + 1;
    byCategory[t.category] = (byCategory[t.category] || 0) + 1;
  }

  const mostUsed = [...templates]
    .sort((a, b) => b.useCount - a.useCount)
    .slice(0, 10)
    .map((t) => ({ id: t.id, name: t.name, useCount: t.useCount }));

  return {
    total,
    active,
    inactive,
    byChannel,
    byCategory,
    mostUsed,
  };
};

/**
 * Reset store (for testing)
 */
const resetStore = () => {
  templateStore.clear();
};

module.exports = {
  createTemplate,
  getTemplate,
  listTemplates,
  updateTemplate,
  deleteTemplate,
  renderTemplate,
  previewTemplate,
  cloneTemplate,
  getTemplateStats,
  resetStore,
};
