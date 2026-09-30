import {
  getLegacyCoachesOnlyGameNotePath,
  loadLegacyCoachesOnlyGameNote,
  saveLegacyCoachesOnlyGameNote
} from './adapters/legacyCoachesOnlyGameNotes';
import { COACHES_ONLY_GAME_NOTE_MAX_LENGTH } from './coachesOnlyGameNotesContract';
import { loadNativeCoachesOnlyGameNote, saveNativeCoachesOnlyGameNote } from './nativeCoachesOnlyGameNotes';
import { isNativeRuntime } from './nativeRuntime';

export { COACHES_ONLY_GAME_NOTE_MAX_LENGTH };

export type CoachesOnlyGameNote = {
  exists: boolean;
  text: string;
  updatedAt: Date | null;
  updatedBy: string | null;
};

export type CoachesOnlyGameNoteScope = {
  teamId: string;
  gameId: string;
  userId: string;
  sharedGamePath?: string;
};

export function isCoachesOnlyGameNoteSaveUncertainError(error: unknown) {
  return Boolean(error && typeof error === 'object' && (error as { mayHaveSaved?: unknown }).mayHaveSaved === true);
}

function normalizeTimestamp(value: unknown) {
  if (value instanceof Date) return value;
  const timestampLike = value as { toDate?: () => unknown } | null;
  if (typeof timestampLike?.toDate === 'function') {
    const resolved = timestampLike.toDate();
    return resolved instanceof Date && !Number.isNaN(resolved.getTime()) ? resolved : null;
  }
  return null;
}

export async function loadCoachesOnlyGameNoteForApp({
  teamId,
  gameId,
  userId,
  sharedGamePath = ''
}: CoachesOnlyGameNoteScope): Promise<CoachesOnlyGameNote> {
  const result = isNativeRuntime()
    ? await loadNativeCoachesOnlyGameNote(await getLegacyCoachesOnlyGameNotePath(teamId, gameId, sharedGamePath), userId)
    : await loadLegacyCoachesOnlyGameNote(teamId, gameId, sharedGamePath);
  return {
    exists: result.exists === true,
    text: String(result.text),
    updatedAt: normalizeTimestamp(result.updatedAt),
    updatedBy: typeof result.updatedBy === 'string' ? result.updatedBy : null
  };
}

export async function saveCoachesOnlyGameNoteForApp({
  teamId,
  gameId,
  userId,
  text,
  sharedGamePath = ''
}: {
  text: string;
} & CoachesOnlyGameNoteScope): Promise<Pick<CoachesOnlyGameNote, 'text' | 'updatedBy'>> {
  const result = isNativeRuntime()
    ? await saveNativeCoachesOnlyGameNote(await getLegacyCoachesOnlyGameNotePath(teamId, gameId, sharedGamePath), userId, text)
    : await saveLegacyCoachesOnlyGameNote(teamId, gameId, userId, text, sharedGamePath);
  return {
    text: String(result.text),
    updatedBy: typeof result.updatedBy === 'string' ? result.updatedBy : null
  };
}
