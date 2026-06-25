/**
 * Backfill reciprocal parent links.
 *
 * Repairs the damage from the approveParentMembershipRequest bug where a
 * player's `parents[]` array referenced a user, but that user's `parentOf`
 * (and the denormalized `parentTeamIds` / `parentPlayerKeys` the Firestore
 * rules rely on) were never written. Those users could not see their linked
 * players on web or mobile.
 *
 * For every player whose `parents[]` references a userId, this ensures the
 * referenced user's `parentOf` contains the link and recomputes the access
 * keys.
 *
 * DRY RUN by default. Pass --apply to write.
 * Optionally scope to one account: --email someone@example.com
 *
 * Usage:
 *   node _migration/backfill-reciprocal-parent-links.js                 # dry run, all users
 *   node _migration/backfill-reciprocal-parent-links.js --email a@b.com # dry run, one user
 *   node _migration/backfill-reciprocal-parent-links.js --apply         # write, all users
 */
import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { getAuth } from 'firebase-admin/auth';
import { readFileSync } from 'fs';

const sa = JSON.parse(readFileSync(new URL('./serviceAccountKey.json', import.meta.url), 'utf8'));
if (!getApps().length) initializeApp({ credential: cert(sa), projectId: 'game-flow-c6311' });
const db = getFirestore();
const auth = getAuth();

const APPLY = process.argv.includes('--apply');
const emailFlagIdx = process.argv.indexOf('--email');
const onlyEmail = emailFlagIdx !== -1 ? String(process.argv[emailFlagIdx + 1] || '').trim().toLowerCase() : null;

function uniqueStrings(values) {
    return [...new Set((values || []).filter(Boolean).map((v) => String(v)))];
}

async function resolveOnlyUid() {
    if (!onlyEmail) return null;
    try {
        const u = await auth.getUserByEmail(onlyEmail);
        return u.uid;
    } catch {
        const q = await db.collection('users').where('email', '==', onlyEmail).limit(1).get();
        return q.empty ? '__no-match__' : q.docs[0].id;
    }
}

async function main() {
    const onlyUid = await resolveOnlyUid();
    console.log(`Mode: ${APPLY ? 'APPLY (writing)' : 'DRY RUN (no writes)'}${onlyUid ? `  scope: ${onlyEmail} (${onlyUid})` : '  scope: all users'}\n`);

    // 1. Collect desired links from player.parents across all teams.
    const players = await db.collectionGroup('players').get();
    const teamCache = new Map();
    const desiredByUid = new Map(); // uid -> Map(playerKey -> link)

    for (const playerDoc of players.docs) {
        const data = playerDoc.data() || {};
        const parents = Array.isArray(data.parents) ? data.parents : [];
        if (parents.length === 0) continue;

        const m = playerDoc.ref.path.match(/^teams\/([^/]+)\/players\/([^/]+)$/);
        if (!m) continue;
        const teamId = m[1];
        const playerId = m[2];

        for (const parent of parents) {
            const uid = parent?.userId;
            if (!uid) continue;
            if (onlyUid && uid !== onlyUid) continue;

            if (!teamCache.has(teamId)) {
                const teamSnap = await db.doc(`teams/${teamId}`).get();
                teamCache.set(teamId, teamSnap.exists ? teamSnap.data() : null);
            }
            const team = teamCache.get(teamId);
            if (!team) continue; // team gone

            const link = {
                teamId,
                playerId,
                teamName: team.name || null,
                playerName: data.name || null,
                playerNumber: data.number ?? null,
                playerPhotoUrl: data.photoUrl || null,
                relation: parent.relation || null
            };
            if (!desiredByUid.has(uid)) desiredByUid.set(uid, new Map());
            desiredByUid.get(uid).set(`${teamId}::${playerId}`, link);
        }
    }

    // 2. For each user, merge missing links into parentOf.
    let usersChanged = 0;
    let linksAdded = 0;
    for (const [uid, desiredMap] of desiredByUid) {
        const userRef = db.doc(`users/${uid}`);
        const userSnap = await userRef.get();
        if (!userSnap.exists) {
            console.log(`  ! user ${uid} missing; skipping ${desiredMap.size} link(s)`);
            continue;
        }
        const userData = userSnap.data() || {};
        const existing = Array.isArray(userData.parentOf) ? userData.parentOf : [];
        const existingKeys = new Set(existing.map((l) => `${l?.teamId}::${l?.playerId}`));

        const missing = [...desiredMap.values()].filter((l) => !existingKeys.has(`${l.teamId}::${l.playerId}`));
        if (missing.length === 0) continue;

        const nextParentOf = [...existing, ...missing];
        const parentTeamIds = uniqueStrings(nextParentOf.map((l) => l?.teamId));
        const parentPlayerKeys = uniqueStrings(nextParentOf.map((l) => (l?.teamId && l?.playerId ? `${l.teamId}::${l.playerId}` : '')));
        const roles = uniqueStrings([...(Array.isArray(userData.roles) ? userData.roles : []), 'parent']);

        usersChanged += 1;
        linksAdded += missing.length;
        console.log(`  user ${uid} (${userData.email || 'no-email'}): +${missing.length} link(s): ${missing.map((l) => `${l.teamName}/${l.playerName}`).join(', ')}`);

        if (APPLY) {
            await userRef.set({ parentOf: nextParentOf, parentTeamIds, parentPlayerKeys, roles }, { merge: true });
        }
    }

    console.log(`\n${APPLY ? 'Applied' : 'Would apply'}: ${linksAdded} link(s) across ${usersChanged} user(s).`);
    if (!APPLY) console.log('Re-run with --apply to write.');
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
