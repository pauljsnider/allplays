import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const drillsHtml = readFileSync(path.resolve(process.cwd(), 'drills.html'), 'utf8');

const updateDoc = vi.fn();
const doc = vi.fn((database, ...segments) => ({ database, path: segments.join('/') }));

vi.mock('../../js/firebase.js?v=22', () => ({
    db: { name: 'mock-db' },
    auth: {},
    storage: {},
    collection: vi.fn(),
    getDocs: vi.fn(),
    getDoc: vi.fn(),
    doc,
    addDoc: vi.fn(),
    updateDoc,
    deleteDoc: vi.fn(),
    setDoc: vi.fn(),
    query: vi.fn(),
    where: vi.fn(),
    orderBy: vi.fn(),
    Timestamp: {
        now: vi.fn(() => 'mock-timestamp'),
        fromDate: vi.fn((value) => value)
    },
    increment: vi.fn(),
    arrayUnion: vi.fn(),
    arrayRemove: vi.fn(),
    deleteField: vi.fn(),
    limit: vi.fn(),
    startAfter: vi.fn(),
    getCountFromServer: vi.fn(),
    onSnapshot: vi.fn(),
    serverTimestamp: vi.fn(),
    collectionGroup: vi.fn(),
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

vi.mock('../../js/vendor/firebase-storage.js', () => ({
    uploadBytesResumable: vi.fn()
}));

const { updatePracticeAttendance } = await import('../../js/db.js');

describe('updatePracticeAttendance roster size', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('preserves the full roster denominator when only marked players are submitted', async () => {
        await updatePracticeAttendance('team-1', 'session-1', {
            rosterSize: 12,
            players: [{ playerId: 'p1', displayName: 'Avery', status: 'present' }]
        });

        expect(updateDoc).toHaveBeenCalledWith(
            { database: { name: 'mock-db' }, path: 'teams/team-1/practiceSessions/session-1' },
            expect.objectContaining({
                attendance: expect.objectContaining({
                    rosterSize: 12,
                    checkedInCount: 1,
                    players: [expect.objectContaining({ playerId: 'p1', status: 'present' })]
                })
            })
        );
    });

    it('loads the roster-size fix through a fresh drills page cache key', () => {
        expect(drillsHtml).toContain("from './js/db.js?v=102';");
        expect(drillsHtml).not.toContain("from './js/db.js?v=92';");
    });
});
