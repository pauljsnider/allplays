import { getDrills as legacyGetDrills, getPracticeSessionByEvent as legacyGetPracticeSessionByEvent, getTeam as legacyGetTeam, getTeamDrills as legacyGetTeamDrills, updatePracticeSession as legacyUpdatePracticeSession, upsertPracticeSessionForEvent as legacyUpsertPracticeSessionForEvent } from '@legacy/db.js';
import { appendLivePracticeNote as legacyAppendLivePracticeNote } from '@legacy/drills-live-practice-notes.js';
import { hasFullTeamAccess as legacyHasFullTeamAccess } from '@legacy/team-access.js';

/**
 * Typed adapter boundary for the legacy js/ practice-timeline helpers (#2066).
 * Bindings re-exported as-is so existing js/* test mocks apply via the @legacy alias.
 */
export const getDrills = legacyGetDrills as (...args: any[]) => Promise<any>;
export const getPracticeSessionByEvent = legacyGetPracticeSessionByEvent as (...args: any[]) => Promise<any>;
export const getTeam = legacyGetTeam as (...args: any[]) => Promise<any>;
export const getTeamDrills = legacyGetTeamDrills as (...args: any[]) => Promise<any>;
export const updatePracticeSession = legacyUpdatePracticeSession as (...args: any[]) => Promise<any>;
export const upsertPracticeSessionForEvent = legacyUpsertPracticeSessionForEvent as (...args: any[]) => Promise<any>;
export const appendLivePracticeNote = legacyAppendLivePracticeNote as (...args: any[]) => any;
export const hasFullTeamAccess = legacyHasFullTeamAccess as (...args: any[]) => boolean;
