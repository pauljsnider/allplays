import { describe, expect, it } from 'vitest';
import { capabilities } from './capabilities';

describe('platform admin capability scope', () => {
  it('records platform admin as a web-only legacy handoff', () => {
    const admin = capabilities.find((capability) => capability.id === 'admin');

    expect(admin).toMatchObject({
      legacyPath: 'admin.html',
      route: '/capabilities/admin',
      status: 'legacy-link'
    });
    expect(admin?.summary).toContain('web-only');
    expect(admin?.features).toContain('Web-only scope');
  });
});
