import { beforeEach, describe, expect, it, vi } from 'vitest';

const firebaseMocks = vi.hoisted(() => ({
  auth: { currentUser: null },
  collection: vi.fn((_database, path) => ({ path })),
  doc: vi.fn((_database, path, id) => ({ path: `${path}/${id}` })),
  getDoc: vi.fn(),
  getDocs: vi.fn(),
  query: vi.fn((collectionRef, ...constraints) => ({ collectionRef, constraints })),
  where: vi.fn((field, op, value) => ({ field, op, value }))
}));

vi.mock('../../js/firebase.js?v=23', () => ({
  db: {},
  auth: firebaseMocks.auth,
  storage: {},
  collection: firebaseMocks.collection,
  getDocs: firebaseMocks.getDocs,
  getDoc: firebaseMocks.getDoc,
  doc: firebaseMocks.doc,
  addDoc: vi.fn(),
  updateDoc: vi.fn(),
  deleteDoc: vi.fn(),
  setDoc: vi.fn(),
  query: firebaseMocks.query,
  where: firebaseMocks.where,
  orderBy: vi.fn(),
  Timestamp: { now: vi.fn() },
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
  documentId: vi.fn(),
  writeBatch: vi.fn(),
  runTransaction: vi.fn(),
  functions: {},
  httpsCallable: vi.fn(),
  ref: vi.fn(),
  uploadBytes: vi.fn(),
  getDownloadURL: vi.fn(),
  deleteObject: vi.fn()
}));

vi.mock('../../js/firebase.js?v=22', async () => import('../../js/firebase.js?v=23'));

vi.mock('../../js/firebase-images.js?v=10', () => ({
  imageStorage: {},
  ensureImageAuth: vi.fn(),
  requireImageAuth: vi.fn()
}));

function createTeamDoc(id, data) {
  return {
    id,
    data: () => data
  };
}

function getWhereConstraint(queryValue) {
  return queryValue.constraints.find((constraint) => constraint?.field);
}

const { getTeams, getUserTeamsWithAccess } = await import('../../js/db.js?v=123');

describe('team access query resilience', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    firebaseMocks.auth.currentUser = {
      uid: 'owner-1',
      email: 'coach@example.com'
    };
  });

  it('keeps public and owned teams when the optional admin-email query is denied', async () => {
    const publicTeam = createTeamDoc('public-1', { name: 'Falcons', isPublic: true });
    const ownedTeam = createTeamDoc('owned-1', { name: 'Vipers', ownerId: 'owner-1' });
    const permissionError = Object.assign(new Error('Missing or insufficient permissions.'), {
      code: 'permission-denied'
    });
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    firebaseMocks.getDocs.mockImplementation(async (queryValue) => {
      const constraint = getWhereConstraint(queryValue);
      if (constraint.field === 'isPublic') return { docs: [publicTeam] };
      if (constraint.field === 'ownerId') return { docs: [ownedTeam] };
      if (constraint.field === 'adminEmails') throw permissionError;
      throw new Error(`Unexpected query: ${constraint.field}`);
    });

    await expect(getTeams()).resolves.toEqual([
      { id: 'public-1', name: 'Falcons', isPublic: true },
      { id: 'owned-1', name: 'Vipers', ownerId: 'owner-1' }
    ]);
    expect(warnSpy).toHaveBeenCalledWith(
      'Unable to load teams granted through admin email; continuing with public and owned teams.',
      permissionError
    );
  });

  it('keeps owned and owner-email teams when the optional admin-email query is denied', async () => {
    const ownedTeam = createTeamDoc('owned-1', { name: 'Falcons', ownerId: 'owner-1' });
    const emailTeam = createTeamDoc('email-1', { name: 'Vipers', ownerEmail: 'coach@example.com' });
    const permissionError = Object.assign(new Error('Missing or insufficient permissions.'), {
      code: 'permission-denied'
    });
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    firebaseMocks.getDoc.mockResolvedValue({
      exists: () => true,
      data: () => ({ email: 'coach@example.com' })
    });
    firebaseMocks.getDocs.mockImplementation(async (queryValue) => {
      const constraint = getWhereConstraint(queryValue);
      if (constraint.field === 'ownerId') return { docs: [ownedTeam] };
      if (constraint.field === 'adminEmails') throw permissionError;
      if (constraint.field === 'ownerEmail') return { docs: [emailTeam] };
      if (constraint.field === 'ownerEmailLower') return { docs: [] };
      throw new Error(`Unexpected query: ${constraint.field}`);
    });

    await expect(getUserTeamsWithAccess('owner-1', 'coach@example.com')).resolves.toEqual([
      { id: 'owned-1', name: 'Falcons', ownerId: 'owner-1' },
      { id: 'email-1', name: 'Vipers', ownerEmail: 'coach@example.com' }
    ]);
    expect(warnSpy).toHaveBeenCalledWith(
      'Optional team access query failed (adminEmails:coach@example.com).',
      permissionError
    );
  });
});
