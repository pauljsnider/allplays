import { describe, expect, it } from 'vitest';

describe('Vitest DOM matcher setup', () => {
  it('registers jest-dom matchers for isolated app tests', () => {
    expect(document.body).toBeInTheDocument();
  });
});
