import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { decideRegistrationPlacement, normalizeRegistrationForm } from '../../js/registration-flow.js';

const dbSource = readFileSync(new URL('../../js/db.js', import.meta.url), 'utf8');

function buildRejectTeamRegistration(deps) {
    const start = dbSource.indexOf('export async function rejectTeamRegistration');
    const end = dbSource.indexOf('\n/**', start);
    expect(start).toBeGreaterThanOrEqual(0);
    expect(end).toBeGreaterThan(start);
    const functionSource = dbSource
        .slice(start, end)
        .replace('export async function rejectTeamRegistration', 'return async function rejectTeamRegistration');

    return new Function('auth', 'doc', 'db', 'Timestamp', 'runTransaction', 'normalizeRegistrationStatus', functionSource)(
        deps.auth,
        deps.doc,
        deps.db,
        deps.Timestamp,
        deps.runTransaction,
        deps.normalizeRegistrationStatus
    );
}

function createHarness({ status = 'pending', registrationCapacityReleased = false, enrolled = 1, waitlisted = 0 } = {}) {
    const registrationPath = 'teams/team-1/registrationForms/form-1/registrations/reg-1';
    const formPath = 'teams/team-1/registrationForms/form-1';
    const state = new Map([
        [registrationPath, {
            status,
            registrationCapacityReleased,
            selectedOption: { id: 'u10', countKey: 'u10' }
        }],
        [formPath, {
            registrationOptionCounts: { u10: { enrolled, waitlisted } }
        }]
    ]);
    const writes = [];
    const transaction = {
        get: vi.fn(async (ref) => ({
            exists: () => state.has(ref.path),
            data: () => state.get(ref.path)
        })),
        update: vi.fn((ref, update) => {
            writes.push({ path: ref.path, update });
            const target = state.get(ref.path);
            Object.entries(update).forEach(([key, value]) => {
                if (key.startsWith('registrationOptionCounts.')) {
                    const [, countKey, countField] = key.split('.');
                    target.registrationOptionCounts[countKey][countField] = value;
                } else {
                    target[key] = value;
                }
            });
        })
    };
    const runTransaction = vi.fn(async (_db, callback) => callback(transaction));
    const rejectTeamRegistration = buildRejectTeamRegistration({
        auth: { currentUser: { uid: 'admin-1', displayName: 'Coach' } },
        doc: (_db, collectionPath, id) => ({ path: `${collectionPath}/${id}` }),
        db: {},
        Timestamp: { now: () => 'NOW' },
        runTransaction,
        normalizeRegistrationStatus: (value) => String(value || 'pending').toLowerCase()
    });
    return { rejectTeamRegistration, state, writes, runTransaction, registrationPath, formPath };
}

describe('rejectTeamRegistration capacity release', () => {
    it('atomically releases a pending registration enrolled slot and records the release', async () => {
        const harness = createHarness();

        await expect(harness.rejectTeamRegistration('team-1', 'form-1', 'reg-1', 'Not eligible'))
            .resolves.toEqual({ success: true });

        expect(harness.runTransaction).toHaveBeenCalledTimes(1);
        expect(harness.state.get(harness.formPath).registrationOptionCounts.u10.enrolled).toBe(0);
        expect(harness.state.get(harness.registrationPath)).toEqual(expect.objectContaining({
            status: 'rejected',
            registrationCapacityReleased: true,
            capacityReleasedAt: 'NOW',
            decidedBy: 'admin-1',
            decisionNote: 'Not eligible'
        }));

        const form = normalizeRegistrationForm({
            published: true,
            registrationOptions: [{ id: 'u10', title: 'U10', capacityLimit: 1, waitlistEnabled: false }]
        }, { teamId: 'team-1', formId: 'form-1' });
        expect(decideRegistrationPlacement({
            form,
            selectedOptionId: 'u10',
            counts: harness.state.get(harness.formPath).registrationOptionCounts
        }).status).toBe('pending');
    });

    it('releases waitlisted demand from the waitlisted counter', async () => {
        const harness = createHarness({ status: 'offer-extended', enrolled: 1, waitlisted: 1 });

        await harness.rejectTeamRegistration('team-1', 'form-1', 'reg-1');

        expect(harness.state.get(harness.formPath).registrationOptionCounts.u10).toEqual({ enrolled: 1, waitlisted: 0 });
    });

    it('is idempotent and never decrements capacity twice', async () => {
        const harness = createHarness();

        await harness.rejectTeamRegistration('team-1', 'form-1', 'reg-1');
        await harness.rejectTeamRegistration('team-1', 'form-1', 'reg-1');

        expect(harness.state.get(harness.formPath).registrationOptionCounts.u10.enrolled).toBe(0);
        expect(harness.writes.filter((write) => write.path === harness.formPath)).toHaveLength(1);
    });
});
