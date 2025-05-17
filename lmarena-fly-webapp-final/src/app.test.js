/**
 * @jest-environment node
 */
const request = require('supertest');
const express = require('express');
const path = require('path');

let app;
beforeAll(() => {
  // Create a fresh app for each test
  app = require('./app'); // assuming app exports the express instance in production, if not, refactor to allow this
});

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

  // Note: For /api/chat and /api/models, tests should mock puppeteerManager functions for fast/isolated test.
});