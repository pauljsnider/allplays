/**
 * Fix orphaned invite/access-code redemptions (issue #3845).
 *
 * When a new-account signup consumed an invite code and then failed, the
 * cleanup path deleted the Firebase Auth user without rolling back what the
 * redemption already wrote. That leaves:
 *   - accessCodes/{codeId} with used:true / usedBy:<uid> where <uid> has no
 *     auth record (the code is permanently burned), and
 *   - a ghost users/{uid} doc still parent-linked to a real player
 *     (parentOf / parentTeamIds / parentPlayerKeys).
 *
 * This script finds accessCodes whose usedBy uid has no Firebase Auth record
 * and reports them. With --apply it:
 *   - un-marks the code (used:false, usedBy:null, usedAt:null, and removes a
 *     redemption-written status:'accepted'),
 *   - deletes the orphaned users/{uid} doc (with its parent link fields) and
 *     the publicUserProfiles/{uid} projection,
 *   - removes the orphaned uid from the player's private profile parents[]
 *     for parent/household/co-parent invites.
 *
 * DRY RUN by default. Pass --apply to write.
 * Optionally scope to one code: --code 7PPHXY3R
 *
 * Usage:
 *   node _migration/fix-orphaned-invite-redemptions.js                  # dry run, all codes
 *   node _migration/fix-orphaned-invite-redemptions.js --code 7PPHXY3R  # dry run, one code
 *   node _migration/fix-orphaned-invite-redemptions.js --apply          # write
 */
import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { getAuth } from 'firebase-admin/auth';
import { readFileSync } from 'fs';

const APPLY = process.argv.includes('--apply');
const codeFlagIdx = process.argv.indexOf('--code');
const onlyCode = codeFlagIdx !== -1 ? String(process.argv[codeFlagIdx + 1] || '').trim().toUpperCase() : null;

function getAdminApp() {
    if (!getApps().length) {
        const sa = JSON.parse(readFileSync(new URL('./serviceAccountKey.json', import.meta.url), 'utf8'));
        initializeApp({ credential: cert(sa), projectId: 'game-flow-c6311' });
    }
    return getApps()[0];
}

async function authRecordExists(auth, uid) {
    try {
        await auth.getUser(uid);
        return true;
    } catch (error) {
        if (error?.code === 'auth/user-not-found') {
            return false;
        }
        throw error;
    }
}

async function repairCode(db, codeSnap, { apply }) {
    const codeData = codeSnap.data() || {};
    const uid = String(codeData.usedBy || '').trim();
    const codeType = String(codeData.type || 'standard');
    const teamId = String(codeData.teamId || '').trim();
    const playerId = String(codeData.playerId || '').trim();

    console.log(`  code=${codeData.code || codeSnap.id} type=${codeType} usedBy=${uid} usedAt=${codeData.usedAt?.toDate?.()?.toISOString?.() || codeData.usedAt || 'n/a'}`);

    const userRef = db.doc(`users/${uid}`);
    const publicProfileRef = db.doc(`publicUserProfiles/${uid}`);
    const [userSnap, publicProfileSnap] = await Promise.all([
        userRef.get(),
        publicProfileRef.get()
    ]);

    if (userSnap.exists) {
        const userData = userSnap.data() || {};
        console.log(`    orphaned users/${uid} doc exists (parentTeamIds=${JSON.stringify(userData.parentTeamIds || [])}, parentPlayerKeys=${JSON.stringify(userData.parentPlayerKeys || [])})`);
    }

    let privateProfileRef = null;
    let remainingParents = null;
    if (teamId && playerId && ['parent_invite', 'household_invite', 'coparent_invite'].includes(codeType)) {
        privateProfileRef = db.doc(`teams/${teamId}/players/${playerId}/private/profile`);
        const privateProfileSnap = await privateProfileRef.get();
        const parents = privateProfileSnap.exists && Array.isArray(privateProfileSnap.data()?.parents)
            ? privateProfileSnap.data().parents
            : [];
        const filtered = parents.filter((parent) => parent?.userId !== uid);
        if (filtered.length !== parents.length) {
            remainingParents = filtered;
            console.log(`    private profile parents[] contains orphaned uid (will remove entry)`);
        }
    }

    if (!apply) {
        console.log('    DRY RUN: would un-mark code, delete orphaned user docs');
        return;
    }

    const batch = db.batch();
    const codeUpdate = {
        used: false,
        usedBy: null,
        usedAt: null
    };
    if (codeData.status === 'accepted') {
        codeUpdate.status = FieldValue.delete();
    }
    batch.update(codeSnap.ref, codeUpdate);
    if (userSnap.exists) {
        batch.delete(userRef);
    }
    if (publicProfileSnap.exists) {
        batch.delete(publicProfileRef);
    }
    if (privateProfileRef && remainingParents) {
        batch.update(privateProfileRef, { parents: remainingParents });
    }
    await batch.commit();
    console.log('    APPLIED: code un-marked, orphaned docs removed');
}

async function main() {
    getAdminApp();
    const db = getFirestore();
    const auth = getAuth();

    console.log(`Mode: ${APPLY ? 'APPLY' : 'DRY RUN'}${onlyCode ? ` (code ${onlyCode})` : ''}`);

    let query = db.collection('accessCodes').where('used', '==', true);
    if (onlyCode) {
        query = query.where('code', '==', onlyCode);
    }
    const snapshot = await query.get();
    console.log(`Scanning ${snapshot.size} used access code(s)...`);

    let orphaned = 0;
    for (const codeSnap of snapshot.docs) {
        const codeData = codeSnap.data() || {};
        const uid = String(codeData.usedBy || '').trim();
        if (!uid) {
            continue;
        }
        const exists = await authRecordExists(auth, uid);
        if (exists) {
            continue;
        }
        orphaned += 1;
        console.log(`ORPHANED redemption found (auth record for usedBy is deleted):`);
        await repairCode(db, codeSnap, { apply: APPLY });
    }

    console.log(`Done. ${orphaned} orphaned redemption(s) ${APPLY ? 'repaired' : 'found (dry run — pass --apply to fix)'}.`);
}

main().catch((error) => {
    console.error('Migration failed:', error);
    process.exitCode = 1;
});
