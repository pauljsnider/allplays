import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';

const dbSource = readFileSync(new URL('../../js/db.js', import.meta.url), 'utf8');

function getFunctionSource(name) {
    const start = dbSource.indexOf(`export async function ${name}`);
    const end = dbSource.indexOf('\nexport ', start + 1);
    return dbSource.slice(start, end === -1 ? dbSource.length : end);
}

function buildRepair(overrides = {}) {
    const dependencies = {
        normalizeRequestedChatConversationId: vi.fn((value) => String(value || '').trim()),
        doc: vi.fn(() => ({ path: 'teams/team-1/chatConversations/legacy-direct' })),
        db: {},
        getDoc: vi.fn(),
        normalizeConversationParticipantIds: vi.fn((values) => [...values]),
        serverTimestamp: vi.fn(() => ({ serverTimestamp: true })),
        updateDoc: vi.fn().mockResolvedValue(undefined),
        ...overrides
    };
    const source = getFunctionSource('repairLegacyAliasDirectConversation')
        .replace('export async function repairLegacyAliasDirectConversation', 'return async function repairLegacyAliasDirectConversation');
    const repair = new Function(...Object.keys(dependencies), source)(...Object.values(dependencies));
    return { repair, dependencies };
}

function snapshot(data, id = 'legacy-direct') {
    return {
        id,
        exists: () => data != null,
        data: () => data
    };
}

describe('legacy alias direct conversation repair', () => {
    it('converts an email-based legacy direct thread in place', async () => {
        const conversation = {
            type: 'direct',
            participantIds: ['coach-1', 'email:parent@example.com'],
            participantRoles: []
        };
        const { repair, dependencies } = buildRepair({
            getDoc: vi.fn().mockResolvedValue(snapshot(conversation))
        });

        await expect(repair('team-1', 'legacy-direct')).resolves.toMatchObject({
            id: 'legacy-direct',
            type: 'group',
            participantIds: conversation.participantIds
        });
        expect(dependencies.updateDoc).toHaveBeenCalledWith(
            expect.objectContaining({ path: 'teams/team-1/chatConversations/legacy-direct' }),
            { type: 'group', updatedAt: { serverTimestamp: true } }
        );
    });

    it('is idempotent for repaired groups and rejects unsafe direct conversions', async () => {
        const repaired = buildRepair({
            getDoc: vi.fn().mockResolvedValue(snapshot({
                type: 'group',
                participantIds: ['coach-1', 'email:parent@example.com']
            }))
        });
        await expect(repaired.repair('team-1', 'legacy-direct')).resolves.toMatchObject({ type: 'group' });
        expect(repaired.dependencies.updateDoc).not.toHaveBeenCalled();

        for (const conversation of [
            { type: 'direct', participantIds: ['coach-1', 'user:parent-1'] },
            {
                type: 'direct',
                participantIds: ['coach-1', 'email:parent@example.com'],
                directAccess: 'team_admin'
            },
            { type: 'direct', participantIds: ['coach-1', 'email:a@example.com', 'email:b@example.com'] }
        ]) {
            const unsafe = buildRepair({ getDoc: vi.fn().mockResolvedValue(snapshot(conversation)) });
            await expect(unsafe.repair('team-1', 'legacy-direct')).rejects.toThrow(/only legacy alias-based/i);
            expect(unsafe.dependencies.updateDoc).not.toHaveBeenCalled();
        }
    });

    it('rejects invalid and missing conversation records', async () => {
        const invalid = buildRepair();
        await expect(invalid.repair('team-1', '')).rejects.toThrow(/valid legacy conversation/i);

        const missing = buildRepair({ getDoc: vi.fn().mockResolvedValue(snapshot(null)) });
        await expect(missing.repair('team-1', 'missing')).rejects.toThrow(/not found/i);
    });
});
