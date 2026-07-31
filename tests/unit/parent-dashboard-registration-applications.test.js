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

function buildMergeParentRegistrationQueryPages() {
    const dbSource = readRepoFile('js/db.js');
    const start = dbSource.indexOf('function getParentRegistrationDocumentKey');
    const end = dbSource.indexOf('\nasync function listParentRegistrationApplicationsForProfile', start);
    const functionSource = dbSource.slice(start, end)
        .replace(
            'export function mergeParentRegistrationQueryPages',
            'return function mergeParentRegistrationQueryPages'
        );
    return new Function(functionSource)();
}

function loadIdentityPage(documents, cursor, pageSize) {
    const cursorIndex = cursor
        ? documents.findIndex((registrationDoc) => registrationDoc === cursor)
        : -1;
    const docs = documents.slice(cursorIndex + 1, cursorIndex + 1 + pageSize);
    return {
        docs,
        hasMore: cursorIndex + 1 + docs.length < documents.length
    };
}

function buildListParentRegistrationApplicationsForProfile({
    registration,
    form = null
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
        getDocs: vi.fn().mockResolvedValue({
            docs: [{
                id: 'registration-1',
                ref: { path: 'teams/team-1/registrationForms/form-1/registrations/registration-1' },
                data: () => registration
            }]
        }),
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

    return { listApplications, getDoc };
}

describe('parent dashboard registration application statuses', () => {
    it('renders a read-only parent registration applications section from dashboard data', () => {
        const html = readRepoFile('parent-dashboard.html');

        expect(html).toContain('id="registration-applications-list"');
        expect(html).toContain('renderRegistrationApplications(data.registrationApplications || [])');
        expect(html).toContain('registration-applications-list');
        expect(html).toContain('offer-extended');
        expect(html).toContain('Status is read-only and controlled by the team admin.');
        expect(html).toContain("from './js/db.js?v=129';");
    });

    it('loads registrations by verified guardian email or authoritative submitter uid without exposing write controls', () => {
        const db = readRepoFile('js/db.js');
        const rules = readRepoFile('firestore.rules');

        expect(db).toContain("collectionGroup(db, 'registrations')");
        expect(db).toContain("where('guardian.email', '==', email)");
        expect(db).toContain("where('submittedByUserId', '==', userId)");
        expect(db).toContain('seenRegistrationPaths');
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

    it('deduplicates overlapping identity matches and advances both cursors', () => {
        const mergePages = buildMergeParentRegistrationQueryPages();
        const newest = buildRegistrationDocument('newest', 60);
        const overlap = buildRegistrationDocument('overlap', 50);
        const guardianOnly = buildRegistrationDocument('guardian-only', 40);

        const page = mergePages({
            guardianEmail: { docs: [newest, overlap, guardianOnly], hasMore: false },
            submittedByUserId: { docs: [newest, overlap], hasMore: false }
        }, { pageSize: 2 });

        expect(page.registrations.map((registrationDoc) => registrationDoc.id)).toEqual([
            'newest',
            'overlap'
        ]);
        expect(page.nextCursor).toEqual({
            guardianEmail: overlap,
            submittedByUserId: overlap
        });
        expect(page.sourceHasMore).toEqual({
            guardianEmail: true,
            submittedByUserId: false
        });
    });

    it('uses document path descending as a deterministic submittedAt tie-breaker', () => {
        const mergePages = buildMergeParentRegistrationQueryPages();
        const alpha = buildRegistrationDocument('alpha', 50, {
            submittedAt: buildTimestamp(50, 100)
        });
        const omega = buildRegistrationDocument('omega', 50, {
            submittedAt: buildTimestamp(50, 100)
        });

        const page = mergePages({
            guardianEmail: { docs: [alpha] },
            submittedByUserId: { docs: [omega] }
        }, { pageSize: 2 });

        expect(page.registrations.map((registrationDoc) => registrationDoc.id)).toEqual([
            'omega',
            'alpha'
        ]);
    });

    it('keeps consecutive merged pages newest-first without skips or repeats', () => {
        const mergePages = buildMergeParentRegistrationQueryPages();
        const overlap = buildRegistrationDocument('overlap', 40);
        const guardianDocuments = [
            buildRegistrationDocument('guardian-new', 60),
            overlap,
            buildRegistrationDocument('guardian-old', 10)
        ];
        const submitterDocuments = [
            buildRegistrationDocument('submitter-new', 50),
            overlap,
            buildRegistrationDocument('submitter-old', 20)
        ];
        const pageSize = 2;
        let cursor = {};
        const registrationIds = [];

        for (let pageNumber = 0; pageNumber < 3; pageNumber += 1) {
            const page = mergePages({
                guardianEmail: loadIdentityPage(guardianDocuments, cursor.guardianEmail, pageSize),
                submittedByUserId: loadIdentityPage(submitterDocuments, cursor.submittedByUserId, pageSize)
            }, { cursor, pageSize });
            registrationIds.push(...page.registrations.map((registrationDoc) => registrationDoc.id));
            cursor = page.nextCursor;
        }

        expect(registrationIds).toEqual([
            'guardian-new',
            'submitter-new',
            'overlap',
            'submitter-old',
            'guardian-old'
        ]);
        expect(new Set(registrationIds).size).toBe(registrationIds.length);
        expect(cursor).toEqual({
            guardianEmail: guardianDocuments[2],
            submittedByUserId: submitterDocuments[2]
        });
    });
});
