const { generateUUID } = require('./utils');

test('generateUUID returns a valid v4 UUID', () => {
  const uuid = generateUUID();
  expect(uuid).toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/i);
});
