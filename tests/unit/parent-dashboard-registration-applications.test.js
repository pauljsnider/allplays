import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';

function readRepoFile(relativePath) {
    return readFileSync(new URL(`../../${relativePath}`, import.meta.url), 'utf8');
}

function buildTimestamp(seconds, nanoseconds = 0) {
    return {
        seconds,
        nanoseconds,
        toMillis: () => (seconds * 1000) + Math.floor(nanoseconds / 1000000)
    };
}

function buildRegistrationDocument(id, seconds, overrides = {}) {
    const registration = {
        teamId: `team-${id}`,
        formId: `form-${id}`,
        submittedAt: buildTimestamp(seconds),
        ...overrides
    };
    return {
        id,
        ref: {
            path: `teams/${registration.teamId}/registrationForms/${registration.formId}/registrations/${id}`
        },
        data: () => registration
    };
}

function buildMergeParentRegistrationQueryResults() {
    const dbSource = readRepoFile('js/db.js');
    const start = dbSource.indexOf('function getParentRegistrationDocumentKey');
    const end = dbSource.indexOf('\nasync function listParentRegistrationApplicationsForProfile', start);
    const functionSource = dbSource.slice(start, end)
        .replace(
            'export function mergeParentRegistrationQueryResults',
            'return function mergeParentRegistrationQueryResults'
        );
    return new Function(functionSource)();
}

function buildListParentRegistrationApplicationsForProfile({
    registration,
    form = null,
    getDocs = vi.fn().mockResolvedValue({
        docs: [{
            id: 'registration-1',
            ref: { path: 'teams/team-1/registrationForms/form-1/registrations/registration-1' },
            data: () => registration
        }]
    })
}) {
    const dbSource = readRepoFile('js/db.js');
    const start = dbSource.indexOf('async function listParentRegistrationApplicationsForProfile');
    const end = dbSource.indexOf('\nexport async function getParentDashboardData', start);
    const functionSource = dbSource.slice(start, end)
        .replace(
            'async function listParentRegistrationApplicationsForProfile',
            'return async function listParentRegistrationApplicationsForProfile'
        );
    const getDoc = vi.fn().mockResolvedValue({
        exists: () => form !== null,
        data: () => form
    });
    const dependencies = {
        normalizeParentRegistrationEmail: (value = '') => String(value || '').trim().toLowerCase(),
        auth: { currentUser: null },
        query: vi.fn((...parts) => parts),
        collectionGroup: vi.fn(),
        db: {},
        where: vi.fn(),
        getDocs,
        mergeParentRegistrationQueryResults: buildMergeParentRegistrationQueryResults(),
        getTeam: vi.fn().mockResolvedValue({ id: 'team-1', name: 'Team One' }),
        getDoc,
        doc: vi.fn((_db, ...parts) => ({ path: parts.join('/') })),
        getRegistrationPlayerDraft: vi.fn().mockReturnValue({ name: 'Player One' }),
        getRegistrationGuardianDrafts: vi.fn().mockReturnValue([{ email: 'parent@example.com' }]),
        normalizeRegistrationStatus: (status = '') => status || 'pending',
        formatParentRegistrationStatusLabel: () => 'Pending Review'
    };
    const dependencyNames = Object.keys(dependencies);
    const listApplications = new Function(...dependencyNames, functionSource)(
        ...dependencyNames.map((name) => dependencies[name])
    );

    return { listApplications, getDoc, dependencies };
}

describe('parent dashboard registration application statuses', () => {
    it('renders a read-only parent registration applications section from dashboard data', () => {
        const html = readRepoFile('parent-dashboard.html');

        expect(html).toContain('id="registration-applications-list"');
        expect(html).toContain('renderRegistrationApplications(data.registrationApplications || [])');
        expect(html).toContain('registration-applications-list');
        expect(html).toContain('offer-extended');
        expect(html).toContain('Status is read-only and controlled by the team admin.');
        expect(html).toContain("from './js/db.js?v=130';");
    });

    it('loads registrations by verified guardian email or authoritative submitter uid without exposing write controls', () => {
        const db = readRepoFile('js/db.js');
        const rules = readRepoFile('firestore.rules');
        const functionStart = db.indexOf('async function listParentRegistrationApplicationsForProfile');
        const functionEnd = db.indexOf('\nexport async function getParentDashboardData', functionStart);
        const functionSource = db.slice(functionStart, functionEnd);

        expect(db).toContain("collectionGroup(db, 'registrations')");
        expect(functionSource).toContain("where('guardian.email', '==', email)");
        expect(functionSource).toContain("where('submittedByUserId', '==', userId)");
        expect(functionSource).toContain('mergeParentRegistrationQueryResults(');
        expect(functionSource).not.toContain("orderBy('submittedAt'");
        expect(functionSource).not.toContain('startAfter(');
        expect(functionSource).not.toContain('limit(');
        expect(db).toContain('registrationApplications');
        expect(rules).toContain('isCurrentUserRegistrationGuardian(resource.data)');
        const registrationRules = rules.match(/match \/registrations\/\{registrationId\} \{[\s\S]*?allow create:/)[0];
        expect(registrationRules).toContain('allow read: if isTeamOwnerOrAdmin(teamId) || isCurrentUserRegistrationGuardian(resource.data);');
        expect(registrationRules).toContain('allow update: if isTeamOwnerOrAdmin(teamId);');
        expect(registrationRules).not.toContain('allow update: if isTeamOwnerOrAdmin(teamId) || isCurrentUserRegistrationGuardian(resource.data);');
    });

    it('uses the registration snapshot program name without reading its registration form', async () => {
        const { listApplications, getDoc } = buildListParentRegistrationApplicationsForProfile({
            registration: {
                teamId: 'team-1',
                formId: 'form-1',
                programName: 'Spring Soccer',
                status: 'pending'
            }
        });

        const applications = await listApplications({ email: 'parent@example.com' });

        expect(applications[0].programName).toBe('Spring Soccer');
        expect(getDoc).not.toHaveBeenCalled();
    });

    it('reads the registration form once to resolve a legacy registration program name', async () => {
        const { listApplications, getDoc } = buildListParentRegistrationApplicationsForProfile({
            registration: {
                teamId: 'team-1',
                formId: 'form-1',
                status: 'pending'
            },
            form: { programName: 'Legacy Soccer' }
        });

        const applications = await listApplications({ email: 'parent@example.com' });

        expect(applications[0].programName).toBe('Legacy Soccer');
        expect(getDoc).toHaveBeenCalledTimes(1);
    });

    it('merges the production identity queries without excluding legacy submittedAt values', async () => {
        const canonical = buildRegistrationDocument('canonical', 300, {
            teamId: 'team-1',
            formId: 'form-1',
            programName: 'Spring Soccer'
        });
        const stringDate = buildRegistrationDocument('string-date', 0, {
            teamId: 'team-1',
            formId: 'form-1',
            programName: 'Spring Soccer',
            submittedAt: '1970-01-01T00:03:20.000Z'
        });
        const createdAtFallback = buildRegistrationDocument('created-at-fallback', 0, {
            teamId: 'team-1',
            formId: 'form-1',
            programName: 'Spring Soccer',
            submittedAt: undefined,
            createdAt: buildTimestamp(100)
        });
        const missingDate = buildRegistrationDocument('missing-date', 0, {
            teamId: 'team-1',
            formId: 'form-1',
            programName: 'Spring Soccer',
            submittedAt: undefined
        });
        const getDocs = vi.fn()
            .mockResolvedValueOnce({ docs: [missingDate, stringDate, canonical] })
            .mockResolvedValueOnce({ docs: [canonical, createdAtFallback] });
        const { listApplications, dependencies } = buildListParentRegistrationApplicationsForProfile({
            registration: canonical.data(),
            getDocs
        });

        const applications = await listApplications({
            id: 'parent-1',
            email: 'parent@example.com'
        });

        expect(applications.map((application) => application.id)).toEqual(
            ['canonical', 'string-date', 'created-at-fallback', 'missing-date']
        );
        expect(getDocs).toHaveBeenCalledTimes(2);
        expect(dependencies.query).toHaveBeenCalledTimes(2);
        expect(dependencies.query.mock.calls.every((call) => call.length === 2)).toBe(true);
    });

    it('deduplicates overlapping identity matches across complete query results', () => {
        const mergeResults = buildMergeParentRegistrationQueryResults();
        const newest = buildRegistrationDocument('newest', 60);
        const overlap = buildRegistrationDocument('overlap', 50);
        const guardianOnly = buildRegistrationDocument('guardian-only', 40);

        const registrations = mergeResults([
            { docs: [guardianOnly, overlap, newest] },
            { docs: [overlap, newest] }
        ]);

        expect(registrations.map((registrationDoc) => registrationDoc.id)).toEqual([
            'newest',
            'overlap',
            'guardian-only'
        ]);
    });

    it('uses document path descending as a deterministic submittedAt tie-breaker', () => {
        const mergeResults = buildMergeParentRegistrationQueryResults();
        const alpha = buildRegistrationDocument('alpha', 50, {
            submittedAt: buildTimestamp(50, 100)
        });
        const omega = buildRegistrationDocument('omega', 50, {
            submittedAt: buildTimestamp(50, 100)
        });

        const registrations = mergeResults([{ docs: [alpha] }, { docs: [omega] }]);

        expect(registrations.map((registrationDoc) => registrationDoc.id)).toEqual([
            'omega',
            'alpha'
        ]);
    });

    it('orders Timestamp, string, createdAt fallback, invalid, and missing dates without dropping records', () => {
        const mergeResults = buildMergeParentRegistrationQueryResults();
        const registrations = mergeResults([{
            docs: [
                buildRegistrationDocument('missing', 0, { submittedAt: undefined }),
                buildRegistrationDocument('invalid', 0, { submittedAt: 'not-a-date' }),
                buildRegistrationDocument('created-at', 0, {
                    submittedAt: undefined,
                    createdAt: buildTimestamp(100)
                }),
                buildRegistrationDocument('string', 0, {
                    submittedAt: '1970-01-01T00:03:20.000Z'
                }),
                buildRegistrationDocument('timestamp', 300)
            ]
        }]);

        expect(registrations.map((registrationDoc) => registrationDoc.id)).toEqual([
            'timestamp',
            'string',
            'created-at',
            'missing',
            'invalid'
        ]);
    });

    it('returns the successful identity query when the other lookup fails', async () => {
        const registrationDoc = buildRegistrationDocument('submitter-match', 100, {
            teamId: 'team-1',
            formId: 'form-1',
            programName: 'Spring Soccer'
        });
        const getDocs = vi.fn()
            .mockRejectedValueOnce(new Error('guardian index unavailable'))
            .mockResolvedValueOnce({ docs: [registrationDoc] });
        const { listApplications } = buildListParentRegistrationApplicationsForProfile({
            registration: registrationDoc.data(),
            getDocs
        });

        const applications = await listApplications({
            id: 'parent-1',
            email: 'parent@example.com'
        });

        expect(applications.map((application) => application.id)).toEqual(['submitter-match']);
    });
});
