import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';

function readPlayerPage() {
    return readFileSync(new URL('../../player.html', import.meta.url), 'utf8');
}

function readDbSource() {
    return readFileSync(new URL('../../js/db.js', import.meta.url), 'utf8');
}

function readFunctionsSource() {
    return readFileSync(new URL('../../functions/index.js', import.meta.url), 'utf8');
}

function extractExportBlock(source, startMarker, endMarker) {
    const start = source.indexOf(startMarker);
    expect(start, `Expected export marker to exist: ${startMarker}`).toBeGreaterThanOrEqual(0);

    const end = source.indexOf(endMarker, start + startMarker.length);
    expect(end, `Expected export marker to exist: ${endMarker}`).toBeGreaterThanOrEqual(0);

    return source.slice(start, end);
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

function buildPlayerProfileUpdatePayload(overrides = {}) {
    const source = readPlayerPage();
    const fnSource = extractFunction(source, 'function buildPlayerProfileUpdatePayload(');
    const factory = new Function(`${fnSource}; return buildPlayerProfileUpdatePayload;`);
    const buildPayload = factory();

    return buildPayload({
        emergencyContactName: '',
        emergencyContactPhone: '',
        medicalInfo: '',
        privateProfileLoadFailed: false,
        privateFieldsDirty: {
            emergencyContact: false,
            medicalInfo: false
        },
        ...overrides
    });
}

function buildDbProfileUpdateHelpers() {
    const source = readDbSource();
    const assertFnSource = extractFunction(source, 'function assertNoSensitivePlayerFields(');
    const publicFnSource = extractFunction(source, 'export async function updatePlayerProfile(')
        .replace('export async function updatePlayerProfile', 'async function updatePlayerProfile');
    const privateFnSource = extractFunction(source, 'export async function updatePlayerPrivateProfile(')
        .replace('export async function updatePlayerPrivateProfile', 'async function updatePlayerPrivateProfile');

    const factory = new Function('deps', `
        const { Timestamp, updateDoc, doc, db, setDoc } = deps;
        ${assertFnSource}
        ${publicFnSource}
        ${privateFnSource}
        return { updatePlayerProfile, updatePlayerPrivateProfile };
    `);

    const deps = {
        Timestamp: {
            now: vi.fn(() => 'ts-now')
        },
        updateDoc: vi.fn(() => Promise.resolve()),
        setDoc: vi.fn(() => Promise.resolve()),
        doc: vi.fn((database, path, maybeId) => maybeId ? `${path}/${maybeId}` : path),
        db: {}
    };

    return {
        deps,
        ...factory(deps)
    };
}

function buildPrivateParentMergeHelpers() {
    const source = readDbSource();
    const hasContactsSource = extractFunction(source, 'function playerHasRosterContactFields(');
    const hasParentUserIdsSource = extractFunction(source, 'function playerHasRosterParentUserIds(');
    const mergeSource = extractFunction(source, 'async function mergePlayerPrivateProfileParents(')
        .replace('async function mergePlayerPrivateProfileParents', 'async function mergePlayerPrivateProfileParents');

    const factory = new Function('deps', `
        const { getPlayerPrivateProfile } = deps;
        ${hasContactsSource}
        ${hasParentUserIdsSource}
        ${mergeSource}
        return { playerHasRosterContactFields, mergePlayerPrivateProfileParents };
    `);

    const deps = {
        getPlayerPrivateProfile: vi.fn()
    };

    return {
        deps,
        ...factory(deps)
    };
}

describe('player private-profile edit payload', () => {
    it('omits untouched private fields when a photo-only save follows a private-profile load failure', () => {
        const payload = buildPlayerProfileUpdatePayload({
            privateProfileLoadFailed: true,
            photoUrl: 'https://img.example/player.jpg'
        });

        expect(payload).toEqual({
            photoUrl: 'https://img.example/player.jpg'
        });
        expect(payload).not.toHaveProperty('emergencyContact');
        expect(payload).not.toHaveProperty('medicalInfo');
    });

    it('includes private fields during normal profile saves when the private-profile load succeeded', () => {
        const payload = buildPlayerProfileUpdatePayload({
            emergencyContactName: 'Pat Parent',
            emergencyContactPhone: '555-0100',
            medicalInfo: 'Asthma inhaler'
        });

        expect(payload).toEqual({
            emergencyContact: {
                name: 'Pat Parent',
                phone: '555-0100'
            },
            medicalInfo: 'Asthma inhaler'
        });
    });

    it('includes only explicitly edited private fields after a private-profile load failure', () => {
        const payload = buildPlayerProfileUpdatePayload({
            emergencyContactName: 'New Contact',
            emergencyContactPhone: '555-0111',
            privateProfileLoadFailed: true,
            privateFieldsDirty: {
                emergencyContact: true,
                medicalInfo: false
            }
        });

        expect(payload).toEqual({
            emergencyContact: {
                name: 'New Contact',
                phone: '555-0111'
            }
        });
        expect(payload).not.toHaveProperty('medicalInfo');
    });
});

describe('player profile private doc writes', () => {
    it('keeps standard sensitive roster fields out of the public player document helper', () => {
        const source = readDbSource();
        const fnSource = extractFunction(source, 'function assertNoSensitivePlayerFields(');
        const factory = new Function(`${fnSource}; return assertNoSensitivePlayerFields;`);
        const assertNoSensitivePlayerFields = factory();

        expect(() => assertNoSensitivePlayerFields({
            rosterFieldValues: {
                medicalInfo: 'Allergy',
                emergencyContactPhone: '555-0100'
            }
        })).toThrow('Do not write sensitive fields to public player doc');
    });

    it('rejects parent, guardian, and household contact fields on the public player helper', () => {
        const source = readDbSource();
        const fnSource = extractFunction(source, 'function assertNoSensitivePlayerFields(');
        const factory = new Function(`${fnSource}; return assertNoSensitivePlayerFields;`);
        const assertNoSensitivePlayerFields = factory();

        expect(() => assertNoSensitivePlayerFields({
            parents: [{ email: 'pat@example.com', relation: 'Mother' }],
            guardianEmail: 'guardian@example.com',
            householdContacts: [{ email: 'house@example.com' }]
        })).toThrow('Do not write sensitive fields to public player doc');
    });

    it('rejects sensitive fields passed to the public player document helper', async () => {
        const { updatePlayerProfile } = buildDbProfileUpdateHelpers();

        await expect(updatePlayerProfile('team-1', 'player-1', {
            emergencyContact: { name: 'Pat Parent', phone: '555-0100' },
            medicalInfo: 'Asthma inhaler'
        })).rejects.toThrow('Do not write sensitive fields to public player doc');
    });

    it('skips the private profile document when only photoUrl is present', async () => {
        const { deps, updatePlayerProfile } = buildDbProfileUpdateHelpers();

        await updatePlayerProfile('team-1', 'player-1', {
            photoUrl: 'https://img.example/player.jpg'
        });

        expect(deps.updateDoc).toHaveBeenCalledTimes(1);
        expect(deps.setDoc).not.toHaveBeenCalled();
    });

    it('writes emergency contact and medical info through the private profile helper', async () => {
        const { deps, updatePlayerPrivateProfile } = buildDbProfileUpdateHelpers();

        await updatePlayerPrivateProfile('team-1', 'player-1', {
            emergencyContact: { name: 'Pat Parent', phone: '555-0100' },
            medicalInfo: 'Asthma inhaler'
        });

        expect(deps.updateDoc).not.toHaveBeenCalled();
        expect(deps.setDoc).toHaveBeenCalledWith(
            'teams/team-1/players/player-1/private/profile',
            {
                emergencyContact: { name: 'Pat Parent', phone: '555-0100' },
                medicalInfo: 'Asthma inhaler',
                updatedAt: 'ts-now'
            },
            { merge: true }
        );
    });

    it('wires the edit form to split public and private profile saves', () => {
        const source = readPlayerPage();

        expect(source).toContain('updatePlayerPrivateProfile');
        expect(source).toContain('const { emergencyContact, medicalInfo, ...publicData } = data;');
        expect(source).toContain('await updatePlayerProfile(currentTeamId, currentPlayer.id, publicData);');
        expect(source).toContain('await updatePlayerPrivateProfile(currentTeamId, currentPlayer.id, privateData);');
    });

    it('stores parent invite contact details on the private player profile document', () => {
        const dbSource = readDbSource();
        const functionsSource = readFunctionsSource();
        const parentInviteClientSource = extractFunction(dbSource, 'export async function redeemParentInvite(');
        const parentInviteCallableSource = extractExportBlock(functionsSource, 'exports.redeemParentInvite', 'exports.redeemHouseholdInvite');
        const householdInviteCallableSource = extractExportBlock(functionsSource, 'exports.redeemHouseholdInvite', 'exports.redeemCoParentInvite');

        expect(parentInviteClientSource).toContain("httpsCallable(functions, 'redeemParentInvite')");
        expect(parentInviteClientSource).not.toContain('await updateDoc(playerRef, {\n                parents: arrayUnion({');

        expect(parentInviteCallableSource).toContain('const privateProfileRef = firestore.doc(`teams/${teamId}/players/${playerId}/private/profile`);');
        expect(parentInviteCallableSource).toContain('transaction.set(privateProfileRef, {');
        expect(parentInviteCallableSource).toContain('email: codeData.email || signedInEmail ||');

        expect(householdInviteCallableSource).toContain('const privateProfileRef = firestore.doc(`teams/${teamId}/players/${playerId}/private/profile`);');
        expect(householdInviteCallableSource).toContain('transaction.set(privateProfileRef, {');
        expect(householdInviteCallableSource).toContain("status: 'accepted'");
    });

    it('keeps resolved parent invite team and player in scope for the success return', () => {
        const dbSource = readDbSource();
        const functionsSource = readFunctionsSource();
        const parentInviteClientSource = extractFunction(dbSource, 'export async function redeemParentInvite(');
        const parentInviteCallableSource = extractExportBlock(functionsSource, 'exports.redeemParentInvite', 'exports.redeemHouseholdInvite');

        expect(parentInviteCallableSource).toContain('const team = { id: teamSnap.id, ...(teamSnap.data() || {}) };');
        expect(parentInviteCallableSource).toContain('const player = { id: playerSnap.id, ...(playerSnap.data() || {}) };');
        expect(parentInviteCallableSource).toContain('teamName: parentLink.teamName');
        expect(parentInviteCallableSource).toContain('playerName: parentLink.playerName');

        expect(parentInviteClientSource).toContain('teamName: payload.teamName || null');
        expect(parentInviteClientSource).toContain('playerName: payload.playerName || null');
    });

    it('hydrates RSVP roster players with private-profile parent contacts when public docs are redacted', async () => {
        const { deps, mergePlayerPrivateProfileParents } = buildPrivateParentMergeHelpers();
        deps.getPlayerPrivateProfile.mockImplementation(async (_teamId, playerId) => {
            if (playerId === 'player-private') {
                return {
                    parents: [{ userId: 'parent-1', email: 'private@example.com' }]
                };
            }
            return null;
        });

        const players = await mergePlayerPrivateProfileParents('team-1', [
            { id: 'player-private', name: 'Private Contact' },
            { id: 'player-public', name: 'Public Contact', parents: [{ userId: 'parent-2', email: 'public@example.com' }] }
        ]);

        expect(players).toEqual([
            {
                id: 'player-private',
                name: 'Private Contact',
                privateProfileParents: [{ userId: 'parent-1', email: 'private@example.com' }]
            },
            {
                id: 'player-public',
                name: 'Public Contact',
                parents: [{ userId: 'parent-2', email: 'public@example.com' }]
            }
        ]);
        expect(deps.getPlayerPrivateProfile).toHaveBeenCalledTimes(1);
        expect(deps.getPlayerPrivateProfile).toHaveBeenCalledWith('team-1', 'player-private');
    });
});
