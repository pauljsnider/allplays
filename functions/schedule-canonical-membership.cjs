"use strict";
const ID = /^[A-Za-z0-9_-]{1,128}$/;
const validId = (value) => typeof value === 'string' && ID.test(value);
// A deliberately stricter subset of firestore.rules: never trim identifiers
// or email grants, and never case-fold stored admin-list entries into access.
const email = (value) => typeof value === 'string' && value.length <= 320 && /^[^\s@]+@[^\s@]+$/.test(value) ? value.toLowerCase() : '';
const ownerEmail = (team) => {
    const one = Object.hasOwn(team, 'ownerEmail') ? team.ownerEmail : '';
    const two = Object.hasOwn(team, 'ownerEmailLower') ? team.ownerEmailLower : '';
    if (typeof one !== 'string' || typeof two !== 'string' || (one && !email(one)) || (two && !email(two))
        || (one && two && email(one) !== email(two))) return '';
    return email(one || two);
};
const missingOwner = (team) => !Object.hasOwn(team, 'ownerId') || team.ownerId === '';
const fail = () => { throw new Error('Canonical schedule membership is unavailable.'); };

// Mirrors the current notification role sources: owner identity, team admin
// emails and users.parentTeamIds. It intentionally ignores coachOf, favorites,
// profile email, cached notificationRecipients and client-supplied role labels.
function canonicalScheduleRoles({ teamId, team, user, uid, email: authEmail, emailVerified }) {
    if (!validId(teamId) || !validId(uid) || !team || !user) return [];
    const roles = new Set();
    const ownerId = team.ownerId;
    const verifiedEmail = emailVerified === true ? email(authEmail) : '';
    if (ownerId === uid || (missingOwner(team) && verifiedEmail && ownerEmail(team) === verifiedEmail)) roles.add('staff');
    if (verifiedEmail && Array.isArray(team.adminEmails) && (team.adminEmails.includes(authEmail) || team.adminEmails.includes(verifiedEmail))) roles.add('staff');
    if (Array.isArray(user.parentTeamIds) && user.parentTeamIds.includes(teamId)) roles.add('parent');
    return [...roles];
}

function createCanonicalScheduleMembership({ firestore, auth }) {
    if (!firestore?.doc || !firestore?.collection || !auth?.getUser || !auth?.getUserByEmail) throw new Error('Canonical Firestore and Auth readers are required.');
    const teamFor = async (teamId) => {
        if (!validId(teamId)) fail();
        const snapshot = await firestore.doc(`teams/${teamId}`).get();
        if (!snapshot.exists) fail();
        return snapshot.data();
    };
    return {
        resolveCanonicalRoles: canonicalScheduleRoles,
        async listCanonicalMembers(teamId) {
            const team = await teamFor(teamId); const uids = new Set();
            if (!missingOwner(team)) { if (typeof team.ownerId !== 'string' || !ID.test(team.ownerId)) fail(); uids.add(team.ownerId); }
            if (team.adminEmails !== undefined && !Array.isArray(team.adminEmails)) fail();
            const addresses = [...new Set((team.adminEmails || []).map(email))];
            if (missingOwner(team)) {
                const owner = ownerEmail(team);
                if (!owner && [team.ownerEmail, team.ownerEmailLower].some((value) => value !== undefined && value !== '')) fail();
                if (owner) addresses.push(owner);
            }
            if (addresses.length > 100 || addresses.some((value) => !value || value.length > 320 || !/^[^\s@]+@[^\s@]+$/.test(value))) fail();
            // A bounded query must fail on overflow; never silently truncate the
            // family audience. No reliance on eventually consistent token indexes.
            const parents = await firestore.collection('users').where('parentTeamIds', 'array-contains', teamId).limit(101).get();
            if (!Array.isArray(parents.docs) || parents.docs.length > 100) fail();
            for (const row of parents.docs) { if (!validId(row.id)) fail(); uids.add(row.id); }
            for (const address of new Set(addresses)) {
                let user;
                try { user = await auth.getUserByEmail(address); }
                catch (error) { if (error?.code === 'auth/user-not-found') continue; throw error; }
                if (!validId(user?.uid) || email(user.email) !== address || typeof user.disabled !== 'boolean') fail();
                if (!user.disabled && user.emailVerified === true) uids.add(user.uid);
            }
            if (uids.size > 100) fail();
            return { complete: true, uids: [...uids].sort() };
        },
        async authorizeActor(actor, teamId) {
            if (!validId(actor?.uid)) return false;
            const [team, user, account] = await Promise.all([teamFor(teamId), firestore.doc(`users/${actor.uid}`).get(), auth.getUser(actor.uid)]);
            if (!user.exists || account?.uid !== actor.uid || account.disabled !== false || account.emailVerified !== true) return false;
            return canonicalScheduleRoles({ teamId, team, user: user.data(), uid: actor.uid, email: account.email, emailVerified: account.emailVerified }).includes('staff');
        }
    };
}
module.exports = { canonicalScheduleRoles, createCanonicalScheduleMembership };
