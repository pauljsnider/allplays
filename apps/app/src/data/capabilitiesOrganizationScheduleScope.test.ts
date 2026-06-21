import { describe, expect, it } from 'vitest';
import { capabilities } from './capabilities';

describe('organization schedule capability scope', () => {
  it('records organization schedule as future-scoped native support', () => {
    const organizationSchedule = capabilities.find((capability) => capability.id === 'organization-schedule');

    expect(organizationSchedule).toMatchObject({
      legacyPath: 'organization-schedule.html',
      route: '/capabilities/organization-schedule',
      status: 'future'
    });
    expect(organizationSchedule?.summary).toContain('future-scoped');
    expect(organizationSchedule?.features).toContain('Future native scope');
  });
});
