import { describe, expect, it } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import {
    ScheduleRoleSubmenu,
    buildScheduleSubmenuGroups,
    hasFamilyScheduleAccess,
    hasStaffScheduleAccess
} from '../../apps/app/src/components/ScheduleRoleSubmenu.tsx';

function authState(overrides = {}) {
    return {
        user: {
            uid: 'user-1',
            email: 'user@example.com',
            displayName: 'User',
            roles: []
        },
        profile: null,
        loading: false,
        error: null,
        roles: [],
        isParent: false,
        isCoach: false,
        isAdmin: false,
        isPlatformAdmin: false,
        refresh: async () => null,
        signOut: async () => {},
        ...overrides
    };
}

describe('role-aware Schedule submenu', () => {
    it('shows family schedule actions to a parent without staff controls', () => {
        const auth = authState({
            roles: ['parent'],
            isParent: true,
            user: {
                uid: 'parent-1',
                email: 'parent@example.com',
                displayName: 'Parent',
                roles: ['parent'],
                parentPlayerKeys: ['team-1:player-1']
            }
        });

        expect(hasFamilyScheduleAccess(auth)).toBe(true);
        expect(hasStaffScheduleAccess(auth)).toBe(false);
        expect(buildScheduleSubmenuGroups(auth)).toEqual([
            expect.objectContaining({
                id: 'family',
                items: expect.arrayContaining([
                    expect.objectContaining({ label: 'Agenda' }),
                    expect.objectContaining({ label: 'RSVP needed' }),
                    expect.objectContaining({ label: 'Calendar' }),
                    expect.objectContaining({ label: 'Practice packets' })
                ])
            })
        ]);
    });

    it('shows team-management actions to coach/admin users without family-only navigation', () => {
        const auth = authState({
            roles: ['coach'],
            isCoach: true,
            user: {
                uid: 'coach-1',
                email: 'coach@example.com',
                displayName: 'Coach',
                roles: ['coach'],
                coachOf: ['team-1']
            }
        });

        expect(hasFamilyScheduleAccess(auth)).toBe(false);
        expect(hasStaffScheduleAccess(auth)).toBe(true);
        const groups = buildScheduleSubmenuGroups(auth, 'team-1');
        expect(groups).toEqual([
            expect.objectContaining({
                id: 'staff',
                items: expect.arrayContaining([
                    expect.objectContaining({ label: 'Team schedule', path: expect.stringContaining('teamId=team-1') }),
                    expect.objectContaining({ label: 'Add event', path: expect.stringContaining('staffSection=add') }),
                    expect.objectContaining({ label: 'Attendance', path: expect.stringContaining('staffSection=attendance') }),
                    expect.objectContaining({ label: 'Manage with AI', path: expect.stringContaining('staffSection=ai') })
                ])
            })
        ]);
        expect(groups[0].items.find((item) => item.id === 'staff-schedule')?.path)
            .toBe('/schedule?scope=staff&view=list&filter=upcoming-all&teamId=team-1');
    });

    it('unions both submenu groups for a combined parent and coach account', () => {
        const auth = authState({
            roles: ['parent', 'coach'],
            isParent: true,
            isCoach: true,
            user: {
                uid: 'combined-1',
                email: 'combined@example.com',
                displayName: 'Combined',
                roles: ['parent', 'coach'],
                parentPlayerKeys: ['team-1:player-1'],
                coachOf: ['team-1']
            }
        });

        expect(buildScheduleSubmenuGroups(auth).map((group) => group.id)).toEqual(['family', 'staff']);
    });

    it('shows staff navigation after authoritative team discovery for an adminEmails-only manager', () => {
        const auth = authState({
            user: {
                uid: 'email-admin-1',
                email: 'team-admin@example.com',
                displayName: 'Team Admin',
                roles: []
            }
        });

        expect(hasStaffScheduleAccess(auth)).toBe(false);
        expect(buildScheduleSubmenuGroups(auth, 'team-admin', {
            hasFamily: false,
            hasStaff: true
        })).toEqual([
            expect.objectContaining({
                id: 'staff',
                items: expect.arrayContaining([
                    expect.objectContaining({
                        id: 'staff-schedule',
                        path: expect.stringContaining('teamId=team-admin')
                    }),
                    expect.objectContaining({ id: 'staff-add' }),
                    expect.objectContaining({ id: 'staff-attendance' }),
                    expect.objectContaining({ id: 'staff-ai' })
                ])
            })
        ]);
    });

    it('renders one role-aware task row on mobile instead of both navigation groups', () => {
        const auth = authState({
            roles: ['parent', 'coach'],
            isParent: true,
            isCoach: true,
            user: {
                uid: 'combined-1',
                email: 'combined@example.com',
                displayName: 'Combined',
                roles: ['parent', 'coach'],
                parentPlayerKeys: ['team-1:player-1'],
                coachOf: ['team-1']
            }
        });

        const html = renderToStaticMarkup(React.createElement(
            MemoryRouter,
            { initialEntries: ['/schedule?scope=staff&teamId=team-1'] },
            React.createElement(ScheduleRoleSubmenu, {
                auth,
                selectedTeamId: 'team-1',
                variant: 'page'
            })
        ));

        expect(html).toContain('aria-label="Schedule role"');
        expect(html).toContain('aria-label="Team management tasks"');
        expect(html).toContain('>Schedule<');
        expect(html).toContain('>Add<');
        expect(html).toContain('>Attendance<');
        expect(html).toContain('>AI<');
        expect(html).not.toContain('aria-label="Family schedule tasks"');
        expect(html).not.toContain('>Agenda<');
    });

    it('uses the live schedule state for mobile active-task styling', () => {
        const auth = authState({
            roles: ['parent'],
            isParent: true
        });

        const html = renderToStaticMarkup(React.createElement(
            MemoryRouter,
            { initialEntries: ['/schedule?scope=family&view=list'] },
            React.createElement(ScheduleRoleSubmenu, {
                auth,
                variant: 'page',
                activeState: {
                    scope: 'family',
                    view: 'packets',
                    filter: 'upcoming-all'
                }
            })
        ));

        expect(html).toMatch(/aria-current="page"[^>]*>[\s\S]*?<span[^>]*>Packets<\/span>/);
        expect(html).not.toMatch(/aria-current="page"[^>]*>[\s\S]*?<span[^>]*>Agenda<\/span>/);
    });
});
