import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { buildRolloverPlayerCopy } from '../../js/team-rollover.js';

function readDbSource() {
    return readFileSync(new URL('../../js/db.js', import.meta.url), 'utf8');
}

function extractFunction(source, signature) {
    const start = source.indexOf(signature);
    expect(start, `Expected function signature to exist: ${signature}`).toBeGreaterThanOrEqual(0);

    const parenStart = source.indexOf('(', start);
    expect(parenStart, `Expected opening paren for: ${signature}`).toBeGreaterThanOrEqual(0);

    let parenDepth = 1;
    let parenEnd = -1;
    for (let i = parenStart + 1; i < source.length; i += 1) {
        const ch = source[i];
        if (ch === '(') parenDepth += 1;
        if (ch === ')') parenDepth -= 1;
        if (parenDepth === 0) {
            parenEnd = i;
            break;
        }
    }

    expect(parenEnd, `Expected closing paren for: ${signature}`).toBeGreaterThanOrEqual(0);

    const braceStart = source.indexOf('{', parenEnd);
    expect(braceStart, `Expected opening brace for: ${signature}`).toBeGreaterThanOrEqual(0);

    let depth = 1;
    for (let i = braceStart + 1; i < source.length; i += 1) {
        const ch = source[i];
        if (ch === '{') depth += 1;
        if (ch === '}') depth -= 1;
        if (depth === 0) {
            return source.slice(start, i + 1);
        }
    }

    throw new Error(`Could not extract function for signature: ${signature}`);
}

function buildRolloverDbHarness({ players = [] } = {}) {
    const source = readDbSource();
    const assertFnSource = extractFunction(source, 'function assertNoSensitivePlayerFields(');
    const copyFnSource = extractFunction(source, 'export async function copySelectedPlayersForTeamRollover(')
        .replace('export async function copySelectedPlayersForTeamRollover', 'async function copySelectedPlayersForTeamRollover');
    const batch = {
        setCalls: [],
        set(ref, payload) {
            this.setCalls.push({ ref, payload });
        },
        commit: async () => {
            batch.committed = true;
        },
        committed: false
    };
    const deps = {
        buildRolloverPlayerCopy,
        collection: (_db, path) => ({ path }),
        db: {},
        doc: (collectionRef) => ({ path: `${collectionRef.path}/auto-${batch.setCalls.length + 1}` }),
        getPlayers: async () => players,
        Timestamp: { now: () => ({ marker: `ts-${batch.setCalls.length}` }) },
        writeBatch: () => {
            deps.batchCreated = true;
            return batch;
        },
        batchCreated: false
    };

    const factory = new Function('deps', `
        const { buildRolloverPlayerCopy, collection, db, doc, getPlayers, Timestamp, writeBatch } = deps;
        ${assertFnSource}
        ${copyFnSource}
        return { copySelectedPlayersForTeamRollover };
    `);

    return {
        batch,
        deps,
        ...factory(deps)
    };
}

describe('team rollover player copy', () => {
    it('preserves supported public player fields with source audit metadata', () => {
        const rolledOverAt = { marker: 'now' };
        const copy = buildRolloverPlayerCopy({
            id: 'player-1',
            name: 'Sam Player',
            number: '12',
            position: 'Guard',
            photoUrl: 'https://example.test/player.png',
            active: false,
            rosterFieldValues: {
                height: '5-8',
                medicalInfo: 'asthma'
            },
            profile: {
                nickname: 'Sam',
                rosterFields: {
                    graduationYear: '2030',
                    medicalNotes: 'uses inhaler'
                },
                customFields: {
                    bats: 'right',
                    parentEmail: 'parent@example.com'
                }
            },
            createdAt: { old: true },
            updatedAt: { old: true }
        }, 'team-old', rolledOverAt);

        expect(copy).toEqual({
            name: 'Sam Player',
            number: '12',
            position: 'Guard',
            photoUrl: 'https://example.test/player.png',
            active: true,
            rosterFieldValues: {
                height: '5-8'
            },
            profile: {
                nickname: 'Sam',
                rosterFields: {
                    graduationYear: '2030'
                },
                customFields: {
                    bats: 'right'
                }
            },
            sourceTeamId: 'team-old',
            sourcePlayerId: 'player-1',
            rolledOverAt
        });
    });

    it('omits private family, medical, and emergency contact info during rollover', () => {
        const medicalInfo = { allergies: 'peanuts' };
        const emergencyContact = { name: 'Jane Doe', phone: '555-1234' };
        const copy = buildRolloverPlayerCopy({
            id: 'player-1',
            name: 'Sam Player',
            medicalInfo,
            emergencyContact,
            contacts: [{ name: 'Dana Reed', email: 'dana@example.com', phone: '555-3000', relation: 'Emergency Contact' }],
            contactInfo: { email: 'household@example.com', phone: '555-2222' },
            parents: [{ userId: 'parent-1', email: 'parent@example.com', relation: 'Mom' }],
            guardianEmail: 'guardian@example.com',
            householdContact: { name: 'Family Contact' },
            sourceTeamId: 'older-team',
            sourcePlayerId: 'older-player',
            rolledOverAt: { old: true },
            deactivatedAt: { old: true }
        }, 'team-old', { marker: 'now' });

        expect(copy).not.toHaveProperty('medicalInfo');
        expect(copy).not.toHaveProperty('emergencyContact');
        expect(copy).not.toHaveProperty('contacts');
        expect(copy).not.toHaveProperty('contactInfo');
        expect(copy).not.toHaveProperty('parents');
        expect(copy).not.toHaveProperty('guardianEmail');
        expect(copy).not.toHaveProperty('householdContact');
        expect(copy).not.toHaveProperty('deactivatedAt');
        expect(copy.sourceTeamId).toBe('team-old');
        expect(copy.sourcePlayerId).toBe('player-1');
    });

    it('writes sanitized public player payloads through the rollover copy path', async () => {
        const harness = buildRolloverDbHarness({
            players: [
                {
                    id: 'player-1',
                    name: 'Sam Player',
                    active: true,
                    number: '12',
                    parents: [{ userId: 'parent-1', email: 'parent@example.com' }],
                    contacts: [{ name: 'Dana Reed', email: 'dana@example.com', phone: '555-3000', relation: 'Emergency Contact' }],
                    emergencyContact: { name: 'Jane Doe', phone: '555-1234' },
                    medicalInfo: { allergies: 'peanuts' },
                    rosterFieldValues: {
                        school: 'Central',
                        contacts: [{ name: 'Roster Contact', phone: '555-2222' }],
                        guardianPhone: '555-9999'
                    },
                    profile: {
                        rosterFields: {
                            graduationYear: '2030',
                            emergencyContactPhone: '555-0000'
                        },
                        customFields: {
                            throws: 'right',
                            householdEmail: 'household@example.com'
                        }
                    }
                },
                {
                    id: 'player-2',
                    name: 'Taylor Player',
                    active: true,
                    contactPhone: '555-4444',
                    parentEmail: 'parent2@example.com',
                    householdContact: { name: 'Household Contact' },
                    customFields: {
                        jerseySize: 'M',
                        contactEmail: 'generic-contact@example.com',
                        emergencyContactName: 'Alex'
                    }
                }
            ]
        });

        await expect(harness.copySelectedPlayersForTeamRollover('team-old', 'team-new', ['player-1', 'player-2']))
            .resolves.toEqual({ copiedCount: 2 });

        expect(harness.batch.committed).toBe(true);
        expect(harness.batch.setCalls).toHaveLength(2);
        expect(harness.batch.setCalls.map(call => call.ref.path)).toEqual([
            'teams/team-new/players/auto-1',
            'teams/team-new/players/auto-2'
        ]);
        expect(harness.batch.setCalls[0].payload).toMatchObject({
            name: 'Sam Player',
            active: true,
            number: '12',
            rosterFieldValues: { school: 'Central' },
            profile: {
                rosterFields: { graduationYear: '2030' },
                customFields: { throws: 'right' }
            },
            sourceTeamId: 'team-old',
            sourcePlayerId: 'player-1'
        });
        expect(harness.batch.setCalls[1].payload).toMatchObject({
            name: 'Taylor Player',
            active: true,
            customFields: { jerseySize: 'M' },
            sourceTeamId: 'team-old',
            sourcePlayerId: 'player-2'
        });
        expect(harness.batch.setCalls[0].payload).not.toHaveProperty('parents');
        expect(harness.batch.setCalls[0].payload).not.toHaveProperty('contacts');
        expect(harness.batch.setCalls[0].payload).not.toHaveProperty('emergencyContact');
        expect(harness.batch.setCalls[0].payload).not.toHaveProperty('medicalInfo');
        expect(harness.batch.setCalls[0].payload.rosterFieldValues).not.toHaveProperty('contacts');
        expect(harness.batch.setCalls[0].payload.rosterFieldValues).not.toHaveProperty('guardianPhone');
        expect(harness.batch.setCalls[0].payload.profile.rosterFields).not.toHaveProperty('emergencyContactPhone');
        expect(harness.batch.setCalls[0].payload.profile.customFields).not.toHaveProperty('householdEmail');
        expect(harness.batch.setCalls[1].payload).not.toHaveProperty('contactPhone');
        expect(harness.batch.setCalls[1].payload).not.toHaveProperty('parentEmail');
        expect(harness.batch.setCalls[1].payload).not.toHaveProperty('householdContact');
        expect(harness.batch.setCalls[1].payload.customFields).not.toHaveProperty('contactEmail');
        expect(harness.batch.setCalls[1].payload.customFields).not.toHaveProperty('emergencyContactName');
    });

    it('does not create a partial batch when a selected rollover player is missing', async () => {
        const harness = buildRolloverDbHarness({
            players: [
                {
                    id: 'player-1',
                    name: 'Sam Player',
                    active: true,
                    medicalInfo: { allergies: 'peanuts' }
                }
            ]
        });

        await expect(harness.copySelectedPlayersForTeamRollover('team-old', 'team-new', ['player-1', 'missing-player']))
            .rejects.toThrow('One or more selected players could not be found on the source team. Refresh and try again.');

        expect(harness.deps.batchCreated).toBe(false);
        expect(harness.batch.setCalls).toHaveLength(0);
        expect(harness.batch.committed).toBe(false);
    });
});
