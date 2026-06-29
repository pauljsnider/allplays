#!/usr/bin/env node
/**
 * Migration: Move sensitive player fields off the public player doc into:
 *   teams/{teamId}/players/{playerId}/private/profile
 *
 * Why:
 * - Firestore rules are document-level; if a player doc is publicly readable,
 *   any sensitive fields on that doc are publicly readable too.
 *
 * Usage:
 *   node _migration/migrate-player-private-profile.js
 *
 * Options:
 * - TEAM_ID=...           Migrate only one team (recommended first run)
 * - DRY_RUN=1            Print intended writes without modifying Firestore
 * - FIREBASE_SERVICE_ACCOUNT=/path/to/key.json   Use explicit service account
 * - FIREBASE_PROJECT_ID=...  Fallback project id when using ADC
 */

import { readFileSync } from 'fs';
import { pathToFileURL } from 'url';
import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';

const TEAM_ID = process.env.TEAM_ID || '';
const DRY_RUN = process.env.DRY_RUN === '1';
const PROJECT_ID = process.env.FIREBASE_PROJECT_ID || 'game-flow-c6311';
const SERVICE_ACCOUNT_PATH = process.env.FIREBASE_SERVICE_ACCOUNT || './serviceAccountKey.json';

function initAdmin() {
    if (getApps().length) return;

    // Prefer explicit service account if present.
    try {
        const sa = JSON.parse(readFileSync(SERVICE_ACCOUNT_PATH, 'utf8'));
        initializeApp({ credential: cert(sa) });
        return;
    } catch {
        // Fall back to ADC (or any ambient auth the environment provides).
        initializeApp({ projectId: PROJECT_ID });
    }
}

function normalizeVisibility(value) {
    const normalized = String(value || 'team').trim().toLowerCase();
    if (normalized === 'private' || normalized === 'admin' || normalized === 'restricted') return 'admins';
    if (normalized === 'family') return 'parents';
    return ['public', 'team', 'parents', 'admins'].includes(normalized) ? normalized : 'team';
}

function pickSensitive(player) {
    const out = {};
    if (Object.prototype.hasOwnProperty.call(player, 'emergencyContact')) {
        out.emergencyContact = player.emergencyContact ?? null;
    }
    if (Object.prototype.hasOwnProperty.call(player, 'medicalInfo')) {
        out.medicalInfo = player.medicalInfo ?? '';
    }
    return out;
}

function collectTeamRosterFieldDefinitions(team = {}, rosterFieldDocs = []) {
    const fieldsByKey = new Map();
    const teamFields = team.rosterFields || team.rosterProfileFields || team.playerProfileFields || team.customRosterFields || [];
    if (Array.isArray(teamFields)) {
        teamFields.forEach((field) => {
            const key = String(field?.key || field?.id || '').trim();
            if (key) fieldsByKey.set(key, field);
        });
    }
    rosterFieldDocs.forEach((docSnap) => {
        const data = docSnap.data?.() || {};
        const key = String(data.key || data.id || docSnap.id || '').trim();
        if (key) fieldsByKey.set(key, { ...data, key });
    });
    return Array.from(fieldsByKey.values());
}

export function pickNonPublicRosterFieldValues(player = {}, rosterFields = []) {
    const nonPublicKeys = rosterFields
        .filter((field) => {
            const visibility = normalizeVisibility(field?.visibility || field?.defaultVisibility);
            return visibility === 'team' || visibility === 'parents';
        })
        .map((field) => String(field?.key || field?.id || '').trim())
        .filter(Boolean);
    const sources = [
        player.rosterFieldValues,
        player.customFields,
        player.profileFields,
        player.extraFields,
        player.profile?.rosterFields,
        player.profile?.customFields
    ];
    return nonPublicKeys.reduce((acc, key) => {
        sources.forEach((source) => {
            if (source && typeof source === 'object' && Object.prototype.hasOwnProperty.call(source, key)) {
                acc[key] = source[key];
            }
        });
        return acc;
    }, {});
}

function buildNonPublicRosterFieldDeleteUpdate(nonPublicValues = {}) {
    return Object.keys(nonPublicValues).reduce((acc, key) => {
        ['rosterFieldValues', 'customFields', 'profileFields', 'extraFields'].forEach((source) => {
            acc[`${source}.${key}`] = FieldValue.delete();
        });
        ['profile.rosterFields', 'profile.customFields'].forEach((source) => {
            acc[`${source}.${key}`] = FieldValue.delete();
        });
        return acc;
    }, {});
}

async function migrate() {
    initAdmin();
    const db = getFirestore();

    const teamsRef = db.collection('teams');
    const teamDocs = TEAM_ID
        ? [await teamsRef.doc(TEAM_ID).get()].filter(d => d.exists)
        : (await teamsRef.get()).docs;

    console.log('Starting migration: move player emergencyContact/medicalInfo to private profile');
    console.log(`Teams: ${TEAM_ID ? TEAM_ID : `${teamDocs.length} (all)`}`);
    console.log(`Dry run: ${DRY_RUN ? 'yes' : 'no'}`);
    console.log('');

    let movedPlayers = 0;
    let skippedPlayers = 0;
    let errors = 0;

    for (const teamDoc of teamDocs) {
        const teamId = teamDoc.id;
        console.log(`Team ${teamId}...`);

        const rosterFieldDocs = await db.collection(`teams/${teamId}/rosterFields`).get().then((snap) => snap.docs).catch(() => []);
        const rosterFields = collectTeamRosterFieldDefinitions(teamDoc.data() || {}, rosterFieldDocs);
        const playersSnap = await db.collection(`teams/${teamId}/players`).get();
        console.log(`  Players: ${playersSnap.size}`);

        for (const pDoc of playersSnap.docs) {
            const playerId = pDoc.id;
            const player = pDoc.data() || {};

            const sensitive = pickSensitive(player);
            const nonPublicRosterFields = pickNonPublicRosterFieldValues(player, rosterFields);
            if (Object.keys(sensitive).length === 0 && Object.keys(nonPublicRosterFields).length === 0) {
                skippedPlayers++;
                continue;
            }

            const privateRef = db.doc(`teams/${teamId}/players/${playerId}/private/profile`);

            if (DRY_RUN) {
                console.log(`  DRY_RUN move ${teamId}/${playerId}:`, [...Object.keys(sensitive), ...Object.keys(nonPublicRosterFields)]);
                movedPlayers++;
                continue;
            }

            try {
                // 1) Write private profile doc (merge, so it's safe to re-run).
                await privateRef.set(
                    {
                        ...sensitive,
                        ...(Object.keys(nonPublicRosterFields).length ? { rosterFields: nonPublicRosterFields } : {}),
                        updatedAt: FieldValue.serverTimestamp()
                    },
                    { merge: true }
                );

                // 2) Delete sensitive fields from the public player doc.
                await pDoc.ref.update({
                    emergencyContact: FieldValue.delete(),
                    medicalInfo: FieldValue.delete(),
                    ...buildNonPublicRosterFieldDeleteUpdate(nonPublicRosterFields),
                    updatedAt: FieldValue.serverTimestamp()
                });

                movedPlayers++;
            } catch (e) {
                errors++;
                console.error(`  ERROR ${teamId}/${playerId}:`, e?.message || e);
            }
        }
    }

    console.log('');
    console.log('=== Migration Complete ===');
    console.log(`Moved:   ${movedPlayers}`);
    console.log(`Skipped: ${skippedPlayers}`);
    console.log(`Errors:  ${errors}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    migrate()
        .then(() => process.exit(0))
        .catch((err) => {
            console.error('Migration failed:', err?.message || err);
            process.exit(1);
        });
}

