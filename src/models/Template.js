/**
 * Notification template model supporting variable interpolation,
 * multi-channel content, localization, and conditional rendering.
 */

'use strict';

const { v4: uuidv4 } = require('uuid');

/**
 * Variable types for template validation
 */
const VariableType = Object.freeze({
  STRING: 'string',
  NUMBER: 'number',
  BOOLEAN: 'boolean',
  DATE: 'date',
  URL: 'url',
  EMAIL: 'email',
});

/**
 * Template model class
 */
class Template {
  constructor(data = {}) {
    this.id = data.id || `tmpl_${uuidv4()}`;
    this.name = data.name || '';
    this.description = data.description || '';
    this.version = data.version || '1.0.0';
    this.channel = data.channel || 'in_app';
    this.category = data.category || 'general';

    // Content per channel
    // Only apply defaults if content was not provided at all
    if (data.content) {
      this.content = {
        subject: data.content.subject || '{{title}}',
        body: data.content.body, // No default - body is required
        html: data.content.html || null,
        actionUrl: data.content.actionUrl || null,
        actionLabel: data.content.actionLabel || 'View',
      };
    } else {
      this.content = {
        subject: '{{title}}',
        body: '{{body}}',
        html: null,
        actionUrl: null,
        actionLabel: 'View',
      };
    }

    // Variable definitions
    this.variables = data.variables || {};
    // Example: { "userName": { "type": "string", "required": true }, "count": { "type": "number", "default": 0 } }

    // Conditional blocks
    this.conditions = data.conditions || [];
    // Example: [{ "if": "count > 10", "then": "...", "else": "..." }]

    // Localization
    this.localizations = data.localizations || {};
    // Example: { "es": { "subject": "...", "body": "..." } }

    // Metadata
    this.metadata = data.metadata || {};
    this.tags = data.tags || [];
    this.isActive = data.isActive !== undefined ? data.isActive : true;
    this.createdBy = data.createdBy || null;

    // Timestamps
    this.createdAt = data.createdAt || new Date().toISOString();
    this.updatedAt = data.updatedAt || this.createdAt;
    this.lastUsedAt = data.lastUsedAt || null;
    this.useCount = data.useCount || 0;
  }

  /**
   * Validate template data
   */
  validate() {
    const errors = [];

    if (!this.name || this.name.trim().length === 0) {
      errors.push('name is required');
    }

    if (this.name && this.name.length > 100) {
      errors.push('name must not exceed 100 characters');
    }

    if (!this.content || !this.content.body || this.content.body.trim().length === 0) {
      errors.push('content.body is required');
    }

    // Validate variable definitions
    for (const [varName, varDef] of Object.entries(this.variables)) {
      const validTypes = Object.values(VariableType);
      if (varDef.type && !validTypes.includes(varDef.type)) {
        errors.push(`Variable "${varName}" has invalid type: ${varDef.type}`);
      }
    }

    // Validate conditions
    for (const condition of this.conditions) {
      if (!condition.if) {
        errors.push('Condition must have "if" expression');
      }
    }

    if (errors.length > 0) {
      const error = new Error('Template validation failed: ' + errors.join('; '));
      error.name = 'ValidationError';
      error.errors = errors;
      throw error;
    }

    return true;
  }

  /**
   * Render template with data
   */
  render(data = {}, options = {}) {
    const locale = options.locale || 'default';
    const variables = { ...data };

    // Apply defaults from variable definitions
    for (const [varName, varDef] of Object.entries(this.variables)) {
      if (variables[varName] === undefined && varDef.default !== undefined) {
        variables[varName] = varDef.default;
      }
    }

    // Validate required variables
    for (const [varName, varDef] of Object.entries(this.variables)) {
      if (varDef.required && variables[varName] === undefined) {
        throw new Error(`Required template variable missing: "${varName}"`);
      }
    }

    // Select locale content
    let content = this.content;
    if (locale !== 'default' && this.localizations[locale]) {
      content = { ...content, ...this.localizations[locale] };
    }

    // Interpolate variables
    let subject = this.interpolate(content.subject, variables);
    let body = this.interpolate(content.body, variables);
    let html = content.html ? this.interpolate(content.html, variables) : null;
    let actionUrl = content.actionUrl ? this.interpolate(content.actionUrl, variables) : null;

    // Process conditions
    for (const condition of this.conditions) {
      if (this.evaluateCondition(condition.if, variables)) {
        if (condition.then) {
          body = this.interpolate(condition.then, variables);
        }
      } else if (condition.else) {
        body = this.interpolate(condition.else, variables);
      }
    }

    // Track usage
    this.useCount++;
    this.lastUsedAt = new Date().toISOString();

    return {
      subject,
      body,
      html,
      actionUrl,
      actionLabel: content.actionLabel,
    };
  }

  /**
   * Interpolate variables into a template string
   */
  interpolate(template, variables) {
    if (!template || typeof template !== 'string') return template;

    return template.replace(/\{\{(\w+)\}\}/g, (match, varName) => {
      const value = variables[varName];
      return value !== undefined ? String(value) : match;
    });
  }

  /**
   * Evaluate a simple condition expression
   */
  evaluateCondition(expression, variables) {
    try {
      // Simple expression evaluation: varName operator value
      // e.g., "count > 10", "role == admin"
      const match = expression.match(/^(\w+)\s*(==|!=|>|>=|<|<=)\s*(.+)$/);
      if (!match) {
        // Fallback: check truthiness
        return !!variables[expression];
      }

      const [, varName, operator, rightSide] = match;
      const leftValue = variables[varName];
      let rightValue = rightSide.trim();

      // Remove quotes if present
      if ((rightValue.startsWith('"') && rightValue.endsWith('"')) ||
          (rightValue.startsWith("'") && rightValue.endsWith("'"))) {
        rightValue = rightValue.slice(1, -1);
      } else if (!isNaN(rightValue)) {
        rightValue = Number(rightValue);
      }

      switch (operator) {
        case '==': return leftValue == rightValue;
        case '!=': return leftValue != rightValue;
        case '>': return leftValue > rightValue;
        case '>=': return leftValue >= rightValue;
        case '<': return leftValue < rightValue;
        case '<=': return leftValue <= rightValue;
        default: return false;
      }
    } catch {
      return false;
    }
  }

  /**
   * Get required variable names from template
   */
  getRequiredVariables() {
    const required = [];
    for (const [varName, varDef] of Object.entries(this.variables)) {
      if (varDef.required) {
        required.push(varName);
      }
    }
    return required;
  }

  /**
   * Get all variable names used in template content
   */
  getUsedVariables() {
    const contentStrings = [
      this.content.subject,
      this.content.body,
      this.content.html,
      this.content.actionUrl,
    ].filter(Boolean);

    const variableNames = new Set();
    const regex = /\{\{(\w+)\}\}/g;
    let match;

    for (const str of contentStrings) {
      while ((match = regex.exec(str)) !== null) {
        variableNames.add(match[1]);
      }
    }

    return Array.from(variableNames);
  }

  /**
   * Update template data
   */
  update(data) {
    if (data.name !== undefined) this.name = data.name;
    if (data.description !== undefined) this.description = data.description;
    if (data.content !== undefined) {
      this.content = { ...this.content, ...data.content };
    }
    if (data.variables !== undefined) this.variables = data.variables;
    if (data.conditions !== undefined) this.conditions = data.conditions;
    if (data.localizations !== undefined) this.localizations = data.localizations;
    if (data.tags !== undefined) this.tags = data.tags;
    if (data.isActive !== undefined) this.isActive = data.isActive;
    if (data.channel !== undefined) this.channel = data.channel;
    if (data.category !== undefined) this.category = data.category;
    if (data.metadata !== undefined) this.metadata = data.metadata;

    this.version = this.incrementVersion(this.version);
    this.updatedAt = new Date().toISOString();
    return this;
  }

  /**
   * Increment semantic version
   */
  incrementVersion(currentVersion) {
    const parts = currentVersion.split('.').map(Number);
    parts[2]++; // Increment patch
    if (parts[2] > 99) {
      parts[2] = 0;
      parts[1]++;
    }
    if (parts[1] > 99) {
      parts[1] = 0;
      parts[0]++;
    }
    return parts.join('.');
  }

  /**
   * Check if template is active
   */
  isUsable() {
    return this.isActive;
  }

  /**
   * Add a localization
   */
  addLocalization(locale, content) {
    this.localizations[locale] = content;
    this.updatedAt = new Date().toISOString();
    return this;
  }

  /**
   * Serialize to JSON
   */
  toJSON() {
    return {
      id: this.id,
      name: this.name,
      description: this.description,
      version: this.version,
      channel: this.channel,
      category: this.category,
      content: this.content,
      variables: this.variables,
      conditions: this.conditions,
      localizations: this.localizations,
      metadata: this.metadata,
      tags: this.tags,
      isActive: this.isActive,
      createdBy: this.createdBy,
      createdAt: this.createdAt,
      updatedAt: this.updatedAt,
      lastUsedAt: this.lastUsedAt,
      useCount: this.useCount,
    };
  }

  /**
   * Create from JSON
   */
  static fromJSON(data) {
    return new Template(data);
  }
}

module.exports = {
  Template,
  VariableType,
};
