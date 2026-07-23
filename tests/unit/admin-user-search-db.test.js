import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
    ADMIN_OFFICIAL_ENRICHMENT_QUERY_CEILING,
    ADMIN_USER_SEARCH_CANDIDATE_QUERY_CEILING,
    ADMIN_USER_SEARCH_RESULT_LIMIT,
    buildAdminUserSearchHash
} from '../../js/admin-search.js';

const firebaseMocks = vi.hoisted(() => ({
    collection: vi.fn((database, name) => ({ type: 'collection', name })),
    collectionGroup: vi.fn((database, name) => ({ type: 'collectionGroup', name })),
    query: vi.fn((...parts) => ({ parts })),
    where: vi.fn((field, op, value) => ({ type: 'where', field, op, value })),
    orderBy: vi.fn((field) => ({ type: 'orderBy', field })),
    limit: vi.fn((value) => ({ type: 'limit', value })),
    startAfter: vi.fn((value) => ({ type: 'startAfter', value })),
    documentId: vi.fn(() => '__name__'),
    getDocs: vi.fn()
}));

vi.mock('../../js/firebase.js?v=23', () => ({
    db: {},
    auth: { currentUser: null },
    storage: {},
    collection: firebaseMocks.collection,
    collectionGroup: firebaseMocks.collectionGroup,
    getDocs: firebaseMocks.getDocs,
    getDoc: vi.fn(),
    doc: vi.fn(),
    addDoc: vi.fn(),
    updateDoc: vi.fn(),
    deleteDoc: vi.fn(),
    setDoc: vi.fn(),
    query: firebaseMocks.query,
    where: firebaseMocks.where,
    orderBy: firebaseMocks.orderBy,
    Timestamp: { now: vi.fn(() => ({ toMillis: () => Date.now() })) },
    increment: vi.fn(),
    arrayUnion: vi.fn(),
    arrayRemove: vi.fn(),
    deleteField: vi.fn(),
    limit: firebaseMocks.limit,
    startAfter: firebaseMocks.startAfter,
    documentId: firebaseMocks.documentId,
    getCountFromServer: vi.fn(),
    onSnapshot: vi.fn(),
    serverTimestamp: vi.fn(),
    writeBatch: vi.fn(),
    runTransaction: vi.fn(),
    functions: {},
    httpsCallable: vi.fn(),
    ref: vi.fn(),
    uploadBytes: vi.fn(),
    getDownloadURL: vi.fn(),
    deleteObject: vi.fn()
}));

vi.mock('../../js/firebase-images.js?v=10', () => ({
    imageStorage: {},
    ensureImageAuth: vi.fn(),
    requireImageAuth: vi.fn()
}));

function firestoreDoc(id, data) {
    return { id, data: () => data };
}

function findConstraint(request, type, field) {
    return request.parts.find((part) => part?.type === type && (!field || part.field === field));
}

describe('bounded admin user search queries', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        firebaseMocks.getDocs.mockResolvedValue({ docs: [] });
    });

    it('finds a later email/name candidate without following user pagination', async () => {
        const laterUser = firestoreDoc('user-450', {
            email: 'zeta@example.com',
            fullName: 'Zeta User'
        });
        firebaseMocks.getDocs.mockImplementation(async (request) => {
            const emailStart = findConstraint(request, 'where', 'email');
            const nameStart = findConstraint(request, 'where', 'fullName');
            if (emailStart?.op === '>=' && emailStart.value === 'zeta') {
                return { docs: [laterUser] };
            }
            if (nameStart?.op === '>=' && nameStart.value === 'Zeta') {
                return { docs: [laterUser] };
            }
            return { docs: [] };
        });

        const { searchAdminUsers } = await import('../../js/db.js?v=123-admin-user-search');
        const users = await searchAdminUsers('zeta');

        expect(users).toEqual([{
            id: 'user-450',
            email: 'zeta@example.com',
            fullName: 'Zeta User'
        }]);
        expect(firebaseMocks.getDocs.mock.calls.length).toBeLessThanOrEqual(ADMIN_USER_SEARCH_CANDIDATE_QUERY_CEILING);
        expect(firebaseMocks.startAfter).not.toHaveBeenCalled();
        firebaseMocks.getDocs.mock.calls.forEach(([request]) => {
            expect(findConstraint(request, 'limit')?.value).toBeLessThanOrEqual(ADMIN_USER_SEARCH_RESULT_LIMIT);
        });
    });

    it('resolves an official-linked user through the bounded contact path', async () => {
        const official = firestoreDoc('official-1', {
            name: 'Robin Ref',
            email: 'robin@example.com'
        });
        const linkedUser = firestoreDoc('user-900', {
            email: 'robin@example.com',
            fullName: 'Robin Ref'
        });
        firebaseMocks.getDocs.mockImplementation(async (request) => {
            const officialRef = request.parts.find((part) => part?.type === 'collectionGroup');
            const officialName = findConstraint(request, 'where', 'name');
            const userEmail = findConstraint(request, 'where', 'email');
            if (officialRef && officialName?.op === '>=' && officialName.value === 'Robin') {
                return { docs: [official] };
            }
            if (userEmail?.op === 'in' && userEmail.value.includes('robin@example.com')) {
                return { docs: [linkedUser] };
            }
            return { docs: [] };
        });

        const { searchAdminUsers } = await import('../../js/db.js?v=123-admin-user-search');
        const users = await searchAdminUsers('robin');

        expect(users).toEqual([{
            id: 'user-900',
            email: 'robin@example.com',
            fullName: 'Robin Ref'
        }]);
        expect(firebaseMocks.getDocs.mock.calls.length).toBeLessThanOrEqual(ADMIN_USER_SEARCH_CANDIDATE_QUERY_CEILING);
    });

    it.each([
        ['smith', { fullName: 'Jane McSmith', email: 'jane@school.org', phone: '+1 (555) 123-4567' }],
        ['school', { fullName: 'Jane Doe', email: 'jane@School.org', phone: '+1 (555) 123-4567' }],
        ['1234567', { fullName: 'Jane Doe', email: 'jane@school.org', phone: '+1 (555) 123-4567' }],
        ['mCsMiTh', { fullName: 'Jane McSmith', email: 'jane@school.org', phone: '+1 (555) 123-4567' }]
    ])('finds a later indexed user for substring search %s', async (term, userData) => {
        const indexedUser = firestoreDoc('user-450', userData);
        firebaseMocks.getDocs.mockImplementation(async (request) => {
            const hashFilter = findConstraint(request, 'where', 'hashes');
            if (hashFilter?.op === 'array-contains' && hashFilter.value === buildAdminUserSearchHash(term)) {
                return { docs: [firestoreDoc('user-450', { userId: 'user-450' })] };
            }
            const idFilter = findConstraint(request, 'where', '__name__');
            if (idFilter?.op === 'in' && idFilter.value.includes('user-450')) {
                return { docs: [indexedUser] };
            }
            return { docs: [] };
        });

        const { searchAdminUsers } = await import('../../js/db.js?v=123-admin-user-search');
        const users = await searchAdminUsers(term);

        expect(users).toEqual([{ id: 'user-450', ...userData }]);
        expect(firebaseMocks.getDocs.mock.calls.length).toBeLessThanOrEqual(ADMIN_USER_SEARCH_CANDIDATE_QUERY_CEILING);
    });

    it('covers every bounded user contact while keeping enrichment query fan-out fixed', async () => {
        const users = Array.from({ length: 500 }, (_, index) => ({
            id: `user-${index}`,
            email: `user-${index}@example.com`,
            phone: `555000${String(index).padStart(4, '0')}`
        }));
        const { getOfficialsForUsers } = await import('../../js/db.js?v=123-admin-user-search');

        await getOfficialsForUsers(users);

        expect(firebaseMocks.getDocs).toHaveBeenCalledTimes(ADMIN_OFFICIAL_ENRICHMENT_QUERY_CEILING);
        const emailTargets = new Set();
        const phoneTargets = new Set();
        firebaseMocks.getDocs.mock.calls.forEach(([request]) => {
            expect(findConstraint(request, 'limit')?.value).toBe(ADMIN_USER_SEARCH_RESULT_LIMIT);
            const filter = findConstraint(request, 'where');
            expect(filter.value.length).toBeLessThanOrEqual(30);
            const targets = filter.field === 'email' ? emailTargets : phoneTargets;
            filter.value.forEach((value) => targets.add(value));
        });
        expect(emailTargets.size).toBe(50);
        expect(phoneTargets.size).toBe(50);
    });

    it('finds an official linked to a search result beyond position 25', async () => {
        const users = Array.from({ length: ADMIN_USER_SEARCH_RESULT_LIMIT }, (_, index) => ({
            id: `user-${index}`,
            email: `user-${index}@example.com`
        }));
        const laterOfficial = {
            id: 'official-30',
            ref: { parent: { parent: { id: 'team-1' } } },
            data: () => ({
                name: 'Later Official',
                email: 'user-29@example.com'
            })
        };
        firebaseMocks.getDocs.mockImplementation(async (request) => {
            const emailFilter = findConstraint(request, 'where', 'email');
            return {
                docs: emailFilter?.value.includes('user-29@example.com') ? [laterOfficial] : []
            };
        });
        const { getOfficialsForUsers } = await import('../../js/db.js?v=123-admin-user-search');

        const entries = await getOfficialsForUsers(users);

        expect(entries).toEqual([{
            teamId: 'team-1',
            official: {
                id: 'official-30',
                name: 'Later Official',
                email: 'user-29@example.com'
            }
        }]);
    });
});
