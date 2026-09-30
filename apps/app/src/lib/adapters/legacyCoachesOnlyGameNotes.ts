import {
  getCoachesOnlyGameNotePath as legacyGetCoachesOnlyGameNotePath,
  loadCoachesOnlyGameNote as legacyLoadCoachesOnlyGameNote,
  saveCoachesOnlyGameNote as legacySaveCoachesOnlyGameNote
} from '@legacy/coaches-only-game-notes.js';
import {
  doc as legacyDoc,
  getDocFromServer as legacyGetDocFromServer,
  serverTimestamp as legacyServerTimestamp,
  setDoc as legacySetDoc
} from '@legacy/vendor/firebase-firestore.js';
import { db as legacyDb } from '@legacy/firebase.js';

export function getLegacyCoachesOnlyGameNotePath(teamId: string, gameId: string, sharedGamePath = '') {
  return legacyGetCoachesOnlyGameNotePath(teamId, gameId, sharedGamePath);
}

export function loadLegacyCoachesOnlyGameNote(teamId: string, gameId: string, sharedGamePath = '') {
  return legacyLoadCoachesOnlyGameNote({
    db: legacyDb,
    doc: legacyDoc,
    getDoc: legacyGetDocFromServer,
    teamId,
    gameId,
    sharedGamePath
  });
}

export function saveLegacyCoachesOnlyGameNote(teamId: string, gameId: string, userId: string, text: string, sharedGamePath = '') {
  return legacySaveCoachesOnlyGameNote({
    db: legacyDb,
    doc: legacyDoc,
    setDoc: legacySetDoc,
    serverTimestamp: legacyServerTimestamp,
    teamId,
    gameId,
    userId,
    text,
    sharedGamePath
  });
}
