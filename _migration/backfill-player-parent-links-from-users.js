/**
 * Backfill player-side parent links from users.parentOf.
 *
 * Repairs legacy rows where a user has parentOf/parentPlayerKeys access but
 * teams/{teamId}/players/{playerId}.parents is missing the reciprocal entry.
 * DRY RUN by default. Pass --apply to write.
 *
 * Usage:
 *   node _migration/backfill-player-parent-links-from-users.js
 *   node _migration/backfill-player-parent-links-from-users.js --email parent@example.com
 *   node _migration/backfill-player-parent-links-from-users.js --team teamId
 *   node _migration/backfill-player-parent-links-from-users.js --apply
 */
import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { getAuth } from 'firebase-admin/auth';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';

const APPLY = process.argv.includes('--apply');
const emailFlagIdx = process.argv.indexOf('--email');
const teamFlagIdx = process.argv.indexOf('--team');
const onlyEmail = emailFlagIdx !== -1 ? String(process.argv[emailFlagIdx + 1] || '').trim().toLowerCase() : '';
const onlyTeamId = teamFlagIdx !== -1 ? String(process.argv[teamFlagIdx + 1] || '').trim() : '';

let dbInstance = null;
let authInstance = null;

function compactString(value) {
    return String(value || '').trim();
}

function compactEmail(value) {
    return compactString(value).toLowerCase();
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

function getParentEntryKey(entry = {}) {
    const userId = compactString(entry.userId);
    if (userId) return `user:${userId}`;
    const email = compactEmail(entry.email);
    if (email) return `email:${email}`;
    return '';
}

function buildPlayerParentEntry({ uid, userData = {}, link = {} }) {
    const email = compactEmail(userData.email || userData.profileEmail || link.email);
    const name = compactString(userData.fullName || userData.displayName || userData.name || link.parentName || email);
    const relation = compactString(link.relation || 'Parent') || 'Parent';
    return {
        userId: compactString(uid),
        ...(name ? { name } : {}),
        ...(email ? { email } : {}),
        relation,
        status: 'active',
        source: 'parentOf-backfill'
    };
}

export function buildPlayerParentBackfillUpdate(playerData = {}, parentEntries = []) {
    const parents = Array.isArray(playerData.parents) ? [...playerData.parents] : [];
    const seen = new Set(parents.map(getParentEntryKey).filter(Boolean));
    const additions = [];

    parentEntries.forEach((entry) => {
        const normalized = {
            ...entry,
            userId: compactString(entry.userId),
            email: compactEmail(entry.email),
            name: compactString(entry.name),
            relation: compactString(entry.relation || 'Parent') || 'Parent',
            status: compactString(entry.status || 'active') || 'active',
            source: compactString(entry.source || 'parentOf-backfill') || 'parentOf-backfill'
        };
        const key = getParentEntryKey(normalized);
        if (!key || seen.has(key)) return;
        seen.add(key);
        additions.push(normalized);
        parents.push(normalized);
    });

    return {
        changed: additions.length > 0,
        additions,
        playerUpdate: {
            parents,
            updatedAt: FieldValue.serverTimestamp()
        }
    };
}

async function resolveOnlyUid() {
    if (!onlyEmail) return '';
    try {
        const user = await getAuthClient().getUserByEmail(onlyEmail);
        return user.uid;
    } catch {
        const snap = await getDb().collection('users').where('email', '==', onlyEmail).limit(1).get();
        return snap.empty ? '__no-match__' : snap.docs[0].id;
    }
}

async function loadUsers() {
    const db = getDb();
    const onlyUid = await resolveOnlyUid();
    if (onlyUid === '__no-match__') return [];
    if (onlyUid) {
        const snap = await db.doc(`users/${onlyUid}`).get();
        return snap.exists ? [{ id: snap.id, data: snap.data() || {} }] : [];
    }
    const snap = await db.collection('users').get();
    return snap.docs.map((doc) => ({ id: doc.id, data: doc.data() || {} }));
}

async function main() {
    const db = getDb();
    const users = await loadUsers();
    let playersChanged = 0;
    let linksAdded = 0;

    console.log(`Mode: ${APPLY ? 'APPLY (writing)' : 'DRY RUN (no writes)'}${onlyEmail ? `  email: ${onlyEmail}` : ''}${onlyTeamId ? `  team: ${onlyTeamId}` : ''}`);

    for (const user of users) {
        const links = (Array.isArray(user.data.parentOf) ? user.data.parentOf : [])
            .filter((link) => compactString(link?.teamId) && compactString(link?.playerId))
            .filter((link) => !onlyTeamId || compactString(link.teamId) === onlyTeamId);
        for (const link of links) {
            const teamId = compactString(link.teamId);
            const playerId = compactString(link.playerId);
            const playerRef = db.doc(`teams/${teamId}/players/${playerId}`);
            const playerSnap = await playerRef.get();
            if (!playerSnap.exists) {
                console.log(`  ! missing player ${teamId}/${playerId}; skipping user ${user.id}`);
                continue;
            }

            const update = buildPlayerParentBackfillUpdate(playerSnap.data() || {}, [
                buildPlayerParentEntry({ uid: user.id, userData: user.data, link })
            ]);
            if (!update.changed) continue;

            playersChanged += 1;
            linksAdded += update.additions.length;
            console.log(`  ${teamId}/${playerId}: +${update.additions.length} parent link(s) from ${user.data.email || user.id}`);
            if (APPLY) {
                await playerRef.set(update.playerUpdate, { merge: true });
            }
        }
    }

    console.log(`${APPLY ? 'Applied' : 'Would apply'} ${linksAdded} parent link(s) across ${playersChanged} player(s).`);
    if (!APPLY) console.log('Re-run with --apply to write.');
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
    main().then(() => process.exit(0)).catch((error) => {
        console.error(error);
        process.exit(1);
    });
}
