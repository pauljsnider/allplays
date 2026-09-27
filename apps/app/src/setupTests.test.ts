import { describe, expect, it } from 'vitest';

describe('Vitest DOM matcher setup', () => {
  it('runs app tests with the jsdom 30 environment', () => {
    expect(navigator.userAgent).toMatch(/\bjsdom\/30\./);
  });

  it('registers jest-dom matchers for isolated app tests', () => {
    expect(document.body).toBeInTheDocument();
  });
});
