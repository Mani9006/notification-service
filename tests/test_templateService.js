/**
 * Unit tests for the template service
 */

'use strict';

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
  resetStore,
} = require('../src/services/templateService');

describe('TemplateService', () => {
  beforeEach(() => {
    resetStore();
  });

  describe('createTemplate', () => {
    test('should create a basic template', () => {
      const result = createTemplate({
        name: 'Welcome Email',
        description: 'Sent to new users',
        channel: 'email',
        content: {
          subject: 'Welcome, {{userName}}!',
          body: 'Hi {{userName}}, welcome to our platform.',
        },
      });

      expect(result.success).toBe(true);
      expect(result.template).toBeDefined();
      expect(result.template.name).toBe('Welcome Email');
      expect(result.template.channel).toBe('email');
      expect(result.template.isActive).toBe(true);
    });

    test('should create template with variables', () => {
      const result = createTemplate({
        name: 'Order Update',
        content: {
          subject: 'Order {{orderId}} Update',
          body: 'Your order status is now: {{status}}',
        },
        variables: {
          orderId: { type: 'string', required: true },
          status: { type: 'string', required: true },
        },
      });

      expect(result.success).toBe(true);
      expect(Object.keys(result.template.variables)).toEqual(['orderId', 'status']);
    });

    test('should reject duplicate template names for same channel', () => {
      createTemplate({
        name: 'Welcome Email',
        channel: 'email',
        content: { subject: 'Welcome', body: 'Hello' },
      });

      const result = createTemplate({
        name: 'Welcome Email',
        channel: 'email',
        content: { subject: 'Welcome 2', body: 'Hello 2' },
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('already exists');
    });

    test('should allow same name for different channels', () => {
      const result1 = createTemplate({
        name: 'Welcome',
        channel: 'email',
        content: { subject: 'Welcome', body: 'Hello' },
      });

      const result2 = createTemplate({
        name: 'Welcome',
        channel: 'in_app',
        content: { subject: 'Welcome', body: 'Hello' },
      });

      expect(result1.success).toBe(true);
      expect(result2.success).toBe(true);
    });

    test('should reject template without name', () => {
      const result = createTemplate({
        content: { subject: 'Test', body: 'Body' },
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('name');
    });

    test('should reject template without body content', () => {
      const result = createTemplate({
        name: 'Empty Template',
        content: { subject: 'Test' },
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('body');
    });

    test('should create template with conditions', () => {
      const result = createTemplate({
        name: 'Conditional Template',
        content: {
          subject: 'Update',
          body: 'You have {{count}} notifications',
        },
        conditions: [
          { if: 'count > 10', then: 'You have many notifications: {{count}}', else: 'You have {{count}} notifications' },
        ],
      });

      expect(result.success).toBe(true);
      expect(result.template.conditions.length).toBe(1);
    });
  });

  describe('getTemplate', () => {
    test('should retrieve template by id', () => {
      const created = createTemplate({
        name: 'Get Test',
        content: { subject: 'Test', body: 'Body' },
      });

      const result = getTemplate(created.template.id);
      expect(result.success).toBe(true);
      expect(result.template.name).toBe('Get Test');
    });

    test('should return error for non-existent id', () => {
      const result = getTemplate('non_existent');
      expect(result.success).toBe(false);
      expect(result.error).toContain('not found');
    });
  });

  describe('listTemplates', () => {
    beforeEach(() => {
      createTemplate({
        name: 'Template A',
        channel: 'email',
        category: 'system',
        content: { subject: 'A', body: 'Body A' },
        tags: ['welcome'],
      });
      createTemplate({
        name: 'Template B',
        channel: 'push',
        category: 'marketing',
        content: { subject: 'B', body: 'Body B' },
        tags: ['promo'],
        isActive: false,
      });
      createTemplate({
        name: 'Template C',
        channel: 'in_app',
        category: 'system',
        content: { subject: 'C', body: 'Body C' },
        tags: ['welcome'],
      });
    });

    test('should list all templates', () => {
      const result = listTemplates();
      expect(result.pagination.total).toBe(3);
    });

    test('should filter by channel', () => {
      const result = listTemplates({ channel: 'email' });
      expect(result.templates.length).toBe(1);
      expect(result.templates[0].name).toBe('Template A');
    });

    test('should filter by category', () => {
      const result = listTemplates({ category: 'system' });
      expect(result.templates.length).toBe(2);
    });

    test('should filter by active status', () => {
      const result = listTemplates({ isActive: false });
      expect(result.templates.length).toBe(1);
      expect(result.templates[0].name).toBe('Template B');
    });

    test('should search by name', () => {
      const result = listTemplates({ search: 'Template A' });
      expect(result.templates.length).toBe(1);
      expect(result.templates[0].name).toBe('Template A');
    });

    test('should filter by tags', () => {
      const result = listTemplates({ tags: 'welcome' });
      expect(result.templates.length).toBe(2);
    });

    test('should paginate results', () => {
      const page1 = listTemplates({ page: 1, limit: 2 });
      expect(page1.templates.length).toBe(2);
      expect(page1.pagination.hasNext).toBe(true);

      const page2 = listTemplates({ page: 2, limit: 2 });
      expect(page2.templates.length).toBe(1);
    });
  });

  describe('updateTemplate', () => {
    test('should update template fields', () => {
      const created = createTemplate({
        name: 'Original',
        content: { subject: 'Original', body: 'Body' },
      });

      const result = updateTemplate(created.template.id, {
        name: 'Updated',
        content: { subject: 'Updated', body: 'New body' },
      });

      expect(result.success).toBe(true);
      expect(result.template.name).toBe('Updated');
      expect(result.template.content.body).toBe('New body');
      expect(result.template.version).not.toBe('1.0.0');
    });

    test('should return error for non-existent template', () => {
      const result = updateTemplate('fake', { name: 'New' });
      expect(result.success).toBe(false);
      expect(result.error).toContain('not found');
    });
  });

  describe('deleteTemplate', () => {
    test('should delete template', () => {
      const created = createTemplate({
        name: 'To Delete',
        content: { subject: 'Del', body: 'Body' },
      });

      const result = deleteTemplate(created.template.id);
      expect(result.success).toBe(true);

      const getResult = getTemplate(created.template.id);
      expect(getResult.success).toBe(false);
    });

    test('should return error for non-existent template', () => {
      const result = deleteTemplate('fake');
      expect(result.success).toBe(false);
      expect(result.error).toContain('not found');
    });
  });

  describe('renderTemplate', () => {
    test('should render template with variable substitution', () => {
      const created = createTemplate({
        name: 'Render Test',
        content: {
          subject: 'Hello, {{userName}}',
          body: 'Welcome, {{userName}}! You have {{count}} messages.',
        },
        variables: {
          userName: { type: 'string', required: true },
          count: { type: 'number', required: true },
        },
      });

      const result = renderTemplate(created.template.id, {
        userName: 'Alice',
        count: 5,
      });

      expect(result.success).toBe(true);
      expect(result.rendered.subject).toBe('Hello, Alice');
      expect(result.rendered.body).toBe('Welcome, Alice! You have 5 messages.');
    });

    test('should apply default values', () => {
      const created = createTemplate({
        name: 'Defaults Test',
        content: {
          subject: 'Update',
          body: 'Count: {{count}}',
        },
        variables: {
          count: { type: 'number', default: 0 },
        },
      });

      const result = renderTemplate(created.template.id, {});
      expect(result.success).toBe(true);
      expect(result.rendered.body).toBe('Count: 0');
    });

    test('should return error for missing required variables', () => {
      const created = createTemplate({
        name: 'Required Test',
        content: {
          subject: 'Hello',
          body: 'Name: {{userName}}',
        },
        variables: {
          userName: { type: 'string', required: true },
        },
      });

      const result = renderTemplate(created.template.id, {});
      expect(result.success).toBe(false);
      expect(result.error).toContain('Required template variable missing');
    });
  });

  describe('previewTemplate', () => {
    test('should preview without storing', () => {
      const result = previewTemplate({
        name: 'Preview',
        content: {
          subject: 'Hi {{name}}',
          body: 'Hello {{name}}',
        },
      }, { name: 'Bob' });

      expect(result.success).toBe(true);
      expect(result.rendered.subject).toBe('Hi Bob');
    });

    test('should validate during preview', () => {
      const result = previewTemplate({
        name: '',
      }, {});

      expect(result.success).toBe(false);
      expect(result.error).toContain('name');
    });
  });

  describe('cloneTemplate', () => {
    test('should clone template with new name', () => {
      const created = createTemplate({
        name: 'Original',
        content: { subject: 'Orig', body: 'Body' },
      });

      const result = cloneTemplate(created.template.id, { name: 'Clone' });

      expect(result.success).toBe(true);
      expect(result.template.name).toBe('Clone');
      expect(result.template.id).not.toBe(created.template.id);
      expect(result.template.version).toBe('1.0.0');
    });

    test('should clone with auto-generated name', () => {
      const created = createTemplate({
        name: 'Original',
        content: { subject: 'Orig', body: 'Body' },
      });

      const result = cloneTemplate(created.template.id);

      expect(result.success).toBe(true);
      expect(result.template.name).toBe('Original (Copy)');
    });
  });

  describe('getTemplateStats', () => {
    test('should return template statistics', () => {
      createTemplate({
        name: 'Stat Test 1',
        channel: 'email',
        category: 'system',
        content: { subject: 'S', body: 'B' },
      });
      createTemplate({
        name: 'Stat Test 2',
        channel: 'push',
        category: 'marketing',
        content: { subject: 'S', body: 'B' },
        isActive: false,
      });

      const stats = getTemplateStats();
      expect(stats.total).toBe(2);
      expect(stats.active).toBe(1);
      expect(stats.inactive).toBe(1);
      expect(stats.byChannel.email).toBe(1);
      expect(stats.byChannel.push).toBe(1);
    });
  });
});
