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
import { fileURLToPath } from 'url';

const APPLY = process.argv.includes('--apply');
const emailFlagIdx = process.argv.indexOf('--email');
const onlyEmail = emailFlagIdx !== -1 ? String(process.argv[emailFlagIdx + 1] || '').trim().toLowerCase() : null;

let dbInstance = null;
let authInstance = null;

function uniqueStrings(values) {
    return [...new Set((values || []).filter(Boolean).map((v) => String(v)))];
}

function getAdminApp() {
    if (!getApps().length) {
        const sa = JSON.parse(readFileSync(new URL('./serviceAccountKey.json', import.meta.url), 'utf8'));
        initializeApp({ credential: cert(sa), projectId: 'game-flow-c6311' });
    }
    return getApps()[0];
}

function getDb() {
    if (!dbInstance) {
        getAdminApp();
        dbInstance = getFirestore();
    }
    return dbInstance;
}

function getAuthClient() {
    if (!authInstance) {
        getAdminApp();
        authInstance = getAuth();
    }
    return authInstance;
}

export function buildParentAccessRepairUpdate(userData = {}, desiredLinks = []) {
    const existingParentOf = Array.isArray(userData.parentOf) ? userData.parentOf : [];
    const existingKeys = new Set(existingParentOf.map((link) => `${link?.teamId}::${link?.playerId}`));
    const missingLinks = desiredLinks.filter((link) => !existingKeys.has(`${link.teamId}::${link.playerId}`));
    const parentOf = [...existingParentOf, ...missingLinks];
    const parentTeamIds = uniqueStrings(parentOf.map((link) => link?.teamId));
    const parentPlayerKeys = uniqueStrings(parentOf.map((link) => (link?.teamId && link?.playerId ? `${link.teamId}::${link.playerId}` : '')));
    const roles = uniqueStrings([...(Array.isArray(userData.roles) ? userData.roles : []), 'parent']);

    const existingTeamIds = uniqueStrings(userData.parentTeamIds || []);
    const existingPlayerKeys = uniqueStrings(userData.parentPlayerKeys || []);
    const existingRoles = uniqueStrings(userData.roles || []);
    const changed =
        missingLinks.length > 0 ||
        JSON.stringify(parentTeamIds) !== JSON.stringify(existingTeamIds) ||
        JSON.stringify(parentPlayerKeys) !== JSON.stringify(existingPlayerKeys) ||
        JSON.stringify(roles) !== JSON.stringify(existingRoles);

    return {
        changed,
        missingLinks,
        userUpdate: {
            parentOf,
            parentTeamIds,
            parentPlayerKeys,
            roles
        }
    };
}

async function resolveOnlyUid() {
    if (!onlyEmail) return null;
    try {
        const u = await getAuthClient().getUserByEmail(onlyEmail);
        return u.uid;
    } catch {
        const q = await getDb().collection('users').where('email', '==', onlyEmail).limit(1).get();
        return q.empty ? '__no-match__' : q.docs[0].id;
    }
}

async function main() {
    const db = getDb();
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

    // 2. For each user, merge missing links into parentOf and always recompute access keys.
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
        const repair = buildParentAccessRepairUpdate(userData, [...desiredMap.values()]);
        if (!repair.changed) continue;

        usersChanged += 1;
        linksAdded += repair.missingLinks.length;
        const repairedAccessOnly = repair.missingLinks.length === 0;
        console.log(`  user ${uid} (${userData.email || 'no-email'}): ${repairedAccessOnly ? 'recomputed access keys' : `+${repair.missingLinks.length} link(s): ${repair.missingLinks.map((link) => `${link.teamName}/${link.playerName}`).join(', ')}`}`);

        if (APPLY) {
            await userRef.set(repair.userUpdate, { merge: true });
        }
    }

    console.log(`\n${APPLY ? 'Applied' : 'Would apply'}: ${linksAdded} missing link(s) repaired across ${usersChanged} user(s).`);
    if (!APPLY) console.log('Re-run with --apply to write.');
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
    main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
}
