/**
 * @jest-environment node
 */
const request = require('supertest');
const express = require('express');
const path = require('path');

jest.mock('./puppeteerManager', () => ({
  launchOrGetPage: jest.fn().mockResolvedValue({}),
  fetchAvailableModels: jest.fn().mockResolvedValue([
    { id: 'gpt4', name: 'gpt4' },
    { id: 'claude3', name: 'claude3' }
  ]),
  initialize: jest.fn(),
  interactWithLMArena: jest.fn().mockResolvedValue(undefined),
  closePage: jest.fn(),
  closeBrowser: jest.fn()
}));

const app = require('./app');

describe('API integration tests', () => {
  it('responds to GET /healthz', async () => {
    const res = await request(app).get('/healthz');
    expect(res.statusCode).toBe(200);
    expect(res.body.status).toBe('ok');
  });

  it('404s unknown api endpoint', async () => {
    const res = await request(app).get('/api/nonexistent');
    expect(res.statusCode).toBe(404);
    expect(res.body.error).toBeDefined();
  });

  it('responds to GET /api/models with mocked data', async () => {
    const res = await request(app).get('/api/models');
    expect(res.statusCode).toBe(200);
    expect(res.body.models).toEqual([
      { id: 'gpt4', name: 'gpt4' },
      { id: 'claude3', name: 'claude3' }
    ]);
  });

  it('responds to POST /api/chat (mocked)', async () => {
    const res = await request(app)
      .post('/api/chat')
      .send({
        userPrompt: "Hello",
        systemPrompt: "Test",
        targetModelA: "gpt4",
        targetModelB: "claude3",
        clientConversationId: "test-id",
        clientMessagesHistory: []
      });
    expect(res.statusCode).toBe(200);
    // SSE: just check response headers for event-stream
    expect(res.headers['content-type']).toContain('text/event-stream');
  });
});