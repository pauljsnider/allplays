/**
 * Backfill coach roles for team owners.
 *
 * Repairs the gap where creating a team never granted the creator the coach
 * role (issue #3846). Team creation only wrote the team doc with `ownerId`;
 * the owner's `users/{uid}` doc was never updated with `coachOf` /
 * `roles: ['coach']`, so the app's role derivation treated owners as
 * parent-only (e.g. coach@allplays.ai owned a team but had roles:["parent"]).
 *
 * For every team, this ensures users/{ownerId} has:
 *   - `coachOf` containing the teamId
 *   - `roles` containing 'coach'
 *
 * DRY RUN by default. Pass --apply to write.
 * Optionally scope to one team: --team teamId
 *
 * Usage:
 *   node _migration/backfill-owner-coach-roles.js                # dry run, all teams
 *   node _migration/backfill-owner-coach-roles.js --team abc123  # dry run, one team
 *   node _migration/backfill-owner-coach-roles.js --apply        # write, all teams
 */
import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { readFileSync } from 'fs';

const APPLY = process.argv.includes('--apply');
const teamFlagIdx = process.argv.indexOf('--team');
const teamFlagValue = teamFlagIdx !== -1 ? String(process.argv[teamFlagIdx + 1] || '').trim() : null;
if (teamFlagIdx !== -1 && (!teamFlagValue || teamFlagValue.startsWith('--'))) {
    console.error('Missing team ID after --team. No changes were made.');
    process.exit(1);
}
const onlyTeamId = teamFlagValue;

let dbInstance = null;

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

async function main() {
    const db = getDb();
    console.log(`Mode: ${APPLY ? 'APPLY (writing)' : 'DRY RUN (no writes)'}${onlyTeamId ? `  scope: team ${onlyTeamId}` : '  scope: all teams'}\n`);

    // 1. Collect owner -> teamIds across teams.
    const teamIdsByOwner = new Map(); // uid -> Set(teamId)
    if (onlyTeamId) {
        const teamSnap = await db.doc(`teams/${onlyTeamId}`).get();
        if (!teamSnap.exists) {
            console.log(`Team ${onlyTeamId} not found; nothing to do.`);
            return;
        }
        const ownerId = String(teamSnap.data()?.ownerId || '').trim();
        if (ownerId) {
            teamIdsByOwner.set(ownerId, new Set([onlyTeamId]));
        }
    } else {
        const teams = await db.collection('teams').get();
        for (const teamDoc of teams.docs) {
            const ownerId = String(teamDoc.data()?.ownerId || '').trim();
            if (!ownerId) {
                console.log(`  ! team ${teamDoc.id} has no ownerId; skipping`);
                continue;
            }
            if (!teamIdsByOwner.has(ownerId)) teamIdsByOwner.set(ownerId, new Set());
            teamIdsByOwner.get(ownerId).add(teamDoc.id);
        }
    }

    // 2. For each owner, ensure coachOf covers their teams and roles has 'coach'.
    let usersChanged = 0;
    let teamLinksAdded = 0;
    for (const [uid, teamIds] of teamIdsByOwner) {
        const userRef = db.doc(`users/${uid}`);
        const userSnap = await userRef.get();
        if (!userSnap.exists) {
            console.log(`  ! user ${uid} missing; skipping ${teamIds.size} team(s): ${[...teamIds].join(', ')}`);
            continue;
        }
        const userData = userSnap.data() || {};
        const existingCoachOf = new Set(Array.isArray(userData.coachOf) ? userData.coachOf.map(String) : []);
        const existingRoles = Array.isArray(userData.roles) ? userData.roles.map(String) : [];
        const missingTeamIds = [...teamIds].filter((teamId) => !existingCoachOf.has(teamId));
        const needsCoachRole = !existingRoles.includes('coach');

        if (missingTeamIds.length === 0 && !needsCoachRole) continue;

        usersChanged += 1;
        teamLinksAdded += missingTeamIds.length;
        const email = userData.email || '(no email)';
        console.log(`  ${uid} (${email}): +coachOf [${missingTeamIds.join(', ') || 'none'}]${needsCoachRole ? " +role 'coach'" : ''}`);

        if (APPLY) {
            const update = { roles: FieldValue.arrayUnion('coach') };
            if (missingTeamIds.length > 0) {
                update.coachOf = FieldValue.arrayUnion(...missingTeamIds);
            }
            await userRef.set(update, { merge: true });
        }
    }

    console.log(`\n${APPLY ? 'Updated' : 'Would update'} ${usersChanged} user(s); ${APPLY ? 'added' : 'would add'} ${teamLinksAdded} coachOf link(s).`);
    if (!APPLY) {
        console.log('Dry run complete. Re-run with --apply to write.');
    }
}

main().catch((error) => {
    console.error('Backfill failed:', error);
    process.exit(1);
});
