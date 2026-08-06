import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

function extractFunction(source, signature) {
    const start = source.indexOf(signature);
    expect(start, `Expected function signature to exist: ${signature}`).toBeGreaterThanOrEqual(0);

    const parenStart = source.indexOf('(', start);
    let parenDepth = 1;
    let parenEnd = -1;
    for (let index = parenStart + 1; index < source.length; index += 1) {
        const ch = source[index];
        if (ch === '(') parenDepth += 1;
        if (ch === ')') parenDepth -= 1;
        if (parenDepth === 0) {
            parenEnd = index;
            break;
        }
    }

    const braceStart = source.indexOf('{', parenEnd);
    let depth = 1;
    for (let index = braceStart + 1; index < source.length; index += 1) {
        const ch = source[index];
        if (ch === '{') depth += 1;
        if (ch === '}') depth -= 1;
        if (depth === 0) {
            return source.slice(start, index + 1);
        }
    }

    throw new Error(`Could not extract function for signature: ${signature}`);
}

const source = readFileSync(resolve(process.cwd(), 'functions/index.js'), 'utf8');
const normalizeTextSource = extractFunction(source, 'function normalizePublicRsvpText(');
const normalizeEmailSource = extractFunction(source, 'function normalizePublicRsvpEmail(');
const contactsSource = extractFunction(source, 'function getPublicRsvpParentContacts(');
const hydrationSource = extractFunction(source, 'async function hydratePublicRsvpPrivateProfileParents(');
const factory = new Function(`${normalizeTextSource}\n${normalizeEmailSource}\n${contactsSource}\nreturn getPublicRsvpParentContacts;`);
const getPublicRsvpParentContacts = factory();

function makePlayerDoc(id, data) {
    return { id, data: () => data };
}

function makePrivateProfileSnap(data, exists = true) {
    return { exists, data: () => data };
}

function createHydrator(privateProfiles, getAllCalls) {
    const firestore = {
        doc: (path) => ({ path }),
        getAll: async (...refs) => {
            getAllCalls.push(refs.map((ref) => ref.path));
            return refs.map((ref) => {
                const playerId = ref.path.split('/')[3];
                return Object.prototype.hasOwnProperty.call(privateProfiles, playerId)
                    ? makePrivateProfileSnap(privateProfiles[playerId])
                    : makePrivateProfileSnap(undefined, false);
            });
        }
    };
    const hydrationFactory = new Function(
        'firestore',
        'getPublicRsvpParentContacts',
        'PUBLIC_RSVP_PRIVATE_PROFILE_BATCH_SIZE',
        `${hydrationSource}\nreturn hydratePublicRsvpPrivateProfileParents;`
    );
    return hydrationFactory(firestore, getPublicRsvpParentContacts, 100);
}

describe('public RSVP parent contact resolution', () => {
    it('uses private-profile parents when public roster docs no longer expose contacts', () => {
        expect(getPublicRsvpParentContacts({
            privateProfileParents: [{ email: 'private@example.com', userId: 'parent-1', relation: 'Mother' }]
        })).toEqual([
            { name: 'Mother', email: 'private@example.com', userId: 'parent-1' }
        ]);
    });

    it('hydrates eligible private contacts in bounded chunks including a final partial chunk', async () => {
        const getAllCalls = [];
        const hydrate = createHydrator({
            'player-1': { parents: [{ email: 'one@example.com' }] },
            'player-2': { parents: [{ email: 'two@example.com' }] },
            'player-3': { parents: [{ email: 'three@example.com' }] },
            'player-4': { parents: [{ email: 'four@example.com' }] },
            'player-5': { parents: [{ email: 'five@example.com' }] }
        }, getAllCalls);

        const players = await hydrate({
            teamId: 'team-1',
            playerDocs: Array.from({ length: 5 }, (_, index) => makePlayerDoc(`player-${index + 1}`, { active: true })),
            respondedPlayerIds: new Set(),
            batchSize: 2
        });

        expect(getAllCalls.map((call) => call.length)).toEqual([2, 2, 1]);
        expect(players.map((player) => player.privateProfileParents?.[0]?.email)).toEqual([
            'one@example.com',
            'two@example.com',
            'three@example.com',
            'four@example.com',
            'five@example.com'
        ]);
    });

    it('skips ineligible players and isolates missing or malformed private profiles', async () => {
        const getAllCalls = [];
        const hydrate = createHydrator({
            eligible: { parents: [{ email: 'private@example.com', userId: 'parent-1' }] },
            malformed: { parents: 'not-an-array' }
        }, getAllCalls);
        const playerDocs = [
            makePlayerDoc('eligible', { active: true }),
            makePlayerDoc('missing', { active: true }),
            makePlayerDoc('malformed', { active: true }),
            makePlayerDoc('inactive', { active: false }),
            makePlayerDoc('responded', { active: true }),
            makePlayerDoc('public-parent', { active: true, parents: [{ email: 'public@example.com' }] }),
            makePlayerDoc('public-direct', { active: true, parentEmail: 'direct@example.com' })
        ];

        const players = await hydrate({
            teamId: 'team-1',
            playerDocs,
            respondedPlayerIds: new Set(['responded']),
            batchSize: 100
        });

        expect(getAllCalls).toEqual([[
            'teams/team-1/players/eligible/private/profile',
            'teams/team-1/players/missing/private/profile',
            'teams/team-1/players/malformed/private/profile'
        ]]);
        expect(getPublicRsvpParentContacts(players.find((player) => player.id === 'eligible')))
            .toEqual([{ name: '', email: 'private@example.com', userId: 'parent-1' }]);
        expect(getPublicRsvpParentContacts(players.find((player) => player.id === 'missing'))).toEqual([]);
        expect(getPublicRsvpParentContacts(players.find((player) => player.id === 'malformed'))).toEqual([]);
        expect(getPublicRsvpParentContacts(players.find((player) => player.id === 'public-parent')))
            .toEqual([{ name: '', email: 'public@example.com', userId: '' }]);
    });
});
