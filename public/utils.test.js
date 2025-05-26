import { generateClientUUID } from './utils';

describe('generateClientUUID', () => {
  it('generates a valid v4-like uuid string', () => {
    const uuid = generateClientUUID();
    expect(typeof uuid).toBe('string');
    expect(uuid.length).toBeGreaterThan(10);
    expect(uuid).toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/i);
  });
});
