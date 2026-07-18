import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { assertFails, assertSucceeds, initializeTestEnvironment } from '@firebase/rules-unit-testing';
import { collection, deleteDoc, doc, getDoc, getDocs, limit, query, setDoc, where } from 'firebase/firestore';

const rules = readFileSync(resolve(process.cwd(), 'firestore.rules'), 'utf8');
const dbSource = readFileSync(resolve(process.cwd(), 'js/db.js'), 'utf8');
const functionsSource = readFileSync(resolve(process.cwd(), 'functions/index.js'), 'utf8');
const teamPageSource = readFileSync(resolve(process.cwd(), 'team.html'), 'utf8');

describe('public team projection compatibility contract', () => {
    it('keeps strict projection detail reads and callable-only collection discovery', () => {
        expect(dbSource).toContain("doc(db, 'publicTeamProfiles', normalizedTeamId)");
        expect(dbSource).toContain("httpsCallable(functions, 'discoverPublicTeamProfiles')");
        expect(dbSource).toContain("httpsCallable(functions, 'getPublicTeamProfile')");
        expect(dbSource).toContain('if (!isPublicProjectionFallbackError(error)) throw error;');
        expect(dbSource).toMatch(/discoverPublicTeams[\s\S]*discoverPublicTeamsFromCallable/);
        expect(rules).toContain('function hasNoCallableOnlyPublicTeamPresentationFields(data)');
        expect(rules).toContain("'tournament', 'tournamentDivisions', 'tournamentPools', 'tournamentPoolOverrides'");
        expect(rules).toContain('hasNoCallableOnlyPublicTeamPresentationFields(data)');
    });

    it('preserves public external schedules without putting calendar credentials in the profile projection', () => {
        expect(dbSource).toContain("httpsCallable(functions, 'getPublicTeamExternalCalendarIcs')");
        expect(teamPageSource).toContain('getPublicTeamExternalCalendarIcs(currentTeamId)');
        expect(teamPageSource).toContain('appendExternalCalendarEvents(parseICS(icsText))');
        expect(teamPageSource).toContain("from './js/db.js?v=103'");

        const callableStart = functionsSource.indexOf('exports.getPublicTeamExternalCalendarIcs');
        const callableEnd = functionsSource.indexOf('\nexports.publicTeamGamesIcs', callableStart);
        const callableSource = functionsSource.slice(callableStart, callableEnd);
        expect(callableSource).toContain('isPublicTeamDiscoverable(team)');
        expect(functionsSource).toContain('sanitizePublicExternalCalendarIcs(result.icsText)');
        expect(callableSource).toContain('calendarUrls.map(fetchSanitizedPublicExternalCalendarIcs)');
        expect(callableSource).toContain('return {\n      calendars,');
        expect(callableSource).not.toContain('return { calendarUrls');
    });
});

describe.skipIf(!process.env.FIRESTORE_EMULATOR_HOST)('public team projection compatibility rules', () => {
    let testEnv;

    beforeAll(async () => {
        testEnv = await initializeTestEnvironment({
            projectId: `allplays-public-team-compat-${Date.now()}`,
            firestore: { rules }
        });
    }, 30000);

    beforeEach(async () => {
        await testEnv.clearFirestore();
        await testEnv.withSecurityRulesDisabled(async (context) => {
            const db = context.firestore();
            await setDoc(doc(db, 'teams/public-team'), {
                name: 'Public Team', isPublic: true, active: true, ownerId: 'owner-1'
            });
            await setDoc(doc(db, 'publicTeamProfiles/public-team'), {
                publicSchemaVersion: 1,
                name: 'Public Team', isPublic: true, active: true, publicSearchName: 'public team'
            });
        });
    });

    afterAll(async () => testEnv?.cleanup());

    it('lets old and new clients read the same public team during rollout', async () => {
        const db = testEnv.unauthenticatedContext().firestore();
        await assertSucceeds(getDoc(doc(db, 'teams/public-team')));
        await assertSucceeds(getDocs(query(collection(db, 'teams'), where('isPublic', '==', true))));
        const projection = await assertSucceeds(getDoc(doc(db, 'publicTeamProfiles/public-team')));
        expect(projection.data()).toMatchObject({ name: 'Public Team', isPublic: true });
        await assertFails(getDocs(query(
            collection(db, 'publicTeamProfiles'),
            where('publicSchemaVersion', '==', 1),
            where('isPublic', '==', true),
            where('active', '==', true),
            limit(100)
        )));
        await assertFails(getDocs(query(collection(db, 'publicTeamProfiles'), limit(101))));
    });

    it('fails closed if a privileged writer ever creates a malformed projection', async () => {
        await testEnv.withSecurityRulesDisabled(async (context) => {
            const db = context.firestore();
            await setDoc(doc(db, 'teams/malformed-team'), {
                name: 'Malformed Team', isPublic: true, active: true
            });
            await setDoc(doc(db, 'publicTeamProfiles/malformed-team'), {
                publicSchemaVersion: 1,
                name: 'Malformed Team', isPublic: true, active: true,
                unexpectedSecret: 'must-not-list'
            });
        });
        const db = testEnv.unauthenticatedContext().firestore();
        await assertFails(getDoc(doc(db, 'publicTeamProfiles/malformed-team')));
        await assertFails(getDocs(query(
            collection(db, 'publicTeamProfiles'),
            where('publicSchemaVersion', '==', 1),
            where('isPublic', '==', true),
            where('active', '==', true),
            limit(100)
        )));
    });

    it('keeps nested presentation structures behind the sanitizing callable', async () => {
        const callableOnlyFields = [
            { standingsConfig: { enabled: true, providerToken: 'must-not-return' } },
            { tournament: { pools: [{ name: 'Pool A', managerEmail: 'private@example.test' }] } },
            { tournamentDivisions: [{ name: 'Division A', managerEmail: 'private@example.test' }] },
            { tournamentPools: [{ name: 'Pool A', managerEmail: 'private@example.test' }] },
            { tournamentPoolOverrides: { 'Pool A': { groupKey: 'a', managerEmail: 'private@example.test' } } }
        ];
        const publicDb = testEnv.unauthenticatedContext().firestore();

        for (const callableOnlyField of callableOnlyFields) {
            await testEnv.withSecurityRulesDisabled(async (context) => {
                await setDoc(doc(context.firestore(), 'publicTeamProfiles/public-team'), {
                    publicSchemaVersion: 1,
                    name: 'Public Team',
                    isPublic: true,
                    active: true,
                    ...callableOnlyField
                });
            });
            await assertFails(getDoc(doc(publicDb, 'publicTeamProfiles/public-team')));
        }
    });

    it('fails closed when any allow-listed projection field has a malformed type', async () => {
        const malformedFields = [
            { name: { private: 'value' } },
            { sport: { private: 'value' } },
            { description: ['private'] },
            { photoUrl: { private: 'value' } },
            { city: ['private'] },
            { state: { private: 'value' } },
            { zip: ['private'] },
            { leagueUrl: { private: 'value' } },
            { websiteUrl: ['private'] },
            { socialLinks: { privateEmail: 'private@example.test' } },
            { twitchChannel: { private: 'value' } },
            { streamUrl: ['private'] },
            { livestreamUrl: { private: 'value' } },
            { streamEmbedUrl: ['private'] },
            { youtubeEmbedUrl: { private: 'value' } },
            { standingsConfig: ['private'] },
            { tournament: ['private'] },
            { tournamentDivisions: { private: 'value' } },
            { tournamentPools: { private: 'value' } },
            { tournamentPoolOverrides: ['private'] },
            { appAccess: 'true' },
            { webAccess: 1 },
            { archived: 'false' },
            { status: { private: 'value' } },
            { publicSearchName: ['private'] },
            { publicSearchCity: { private: 'value' } },
            { publicSearchState: ['private'] },
            { publicSearchZip: { private: 'value' } },
            { publicSearchCityState: ['private'] },
            { sourceUpdatedAt: { private: 'value' } }
        ];
        const publicDb = testEnv.unauthenticatedContext().firestore();

        for (const malformedField of malformedFields) {
            await testEnv.withSecurityRulesDisabled(async (context) => {
                await setDoc(doc(context.firestore(), 'publicTeamProfiles/public-team'), {
                    publicSchemaVersion: 1,
                    name: 'Public Team',
                    isPublic: true,
                    active: true,
                    ...malformedField
                });
            });
            await assertFails(getDoc(doc(publicDb, 'publicTeamProfiles/public-team')));
        }
    });

    it('fails closed when a projection outlives a private, inactive, or deleted source team', async () => {
        const db = testEnv.unauthenticatedContext().firestore();

        await testEnv.withSecurityRulesDisabled(async (context) => {
            await setDoc(doc(context.firestore(), 'teams/public-team'), {
                name: 'Private Current', isPublic: false, active: true
            });
        });
        await assertFails(getDoc(doc(db, 'publicTeamProfiles/public-team')));

        await testEnv.withSecurityRulesDisabled(async (context) => {
            await setDoc(doc(context.firestore(), 'teams/public-team'), {
                name: 'Inactive Current', isPublic: true, active: false
            });
        });
        await assertFails(getDoc(doc(db, 'publicTeamProfiles/public-team')));

        await testEnv.withSecurityRulesDisabled(async (context) => {
            await setDoc(doc(context.firestore(), 'teams/public-team'), {
                name: 'Archived Current', isPublic: true, active: true, status: 'ARCHIVED'
            });
        });
        await assertFails(getDoc(doc(db, 'publicTeamProfiles/public-team')));

        await testEnv.withSecurityRulesDisabled(async (context) => {
            await deleteDoc(doc(context.firestore(), 'teams/public-team'));
        });
        await assertFails(getDoc(doc(db, 'publicTeamProfiles/public-team')));
    });

    it('keeps projection writes server-only', async () => {
        const ownerDb = testEnv.authenticatedContext('owner-1').firestore();
        await assertFails(setDoc(doc(ownerDb, 'publicTeamProfiles/injected'), {
            name: 'Injected', isPublic: true, active: true
        }));
    });
});
