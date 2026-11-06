"use strict";
const { normalizeNotificationTargetCategories, notificationAudienceAllowsRoles } = require('./notification-target-index-core.cjs');
const { NotificationJournalError } = require('./notification-attempt-journal.cjs');
const ID = /^[A-Za-z0-9_-]{1,128}$/;
const fail = () => { throw new NotificationJournalError('audience_unavailable', 'The complete current schedule audience could not be verified.'); };

// Membership discovery must be canonical and complete, not a potentially stale
// notificationRecipients index. No writes/backfills or credentials are created.
function createScheduleDeliveryAudience({ listCanonicalMembers, loadRecipient, authorizeActor }) {
    if ([listCanonicalMembers, loadRecipient, authorizeActor].some((fn) => typeof fn !== 'function')) throw new Error('Canonical membership, live recipient reads and actor authorization are required.');
    const safe = async (callback) => { try { return await callback(); } catch { fail(); } };
    const eligible = async (teamId, uid) => {
        const value = await safe(() => loadRecipient({ teamId, uid }));
        if (!value || value.uid !== uid || value.complete !== true || typeof value.authEnabled !== 'boolean' || !Array.isArray(value.roles)
            || !Array.isArray(value.devices) || value.devices.length > 20 || (value.preferences !== null && (typeof value.preferences !== 'object' || Array.isArray(value.preferences)))) fail();
        // Roles must be computed from current team/user/Auth records by the
        // adapter; cached role labels or a device's uid field are insufficient.
        if (!value.authEnabled || !notificationAudienceAllowsRoles('schedule', value.roles)
            || !normalizeNotificationTargetCategories(value.preferences).schedule) return [];
        const targets = [{ recipientUid: uid, channel: 'inbox', endpoint: uid }];
        const seen = new Set();
        for (const device of value.devices) {
            if (!device || device.ownerUid !== uid || typeof device.token !== 'string' || !device.token || device.token.length > 4096
                || device.token !== device.token.trim() || /[\u0000-\u0020\u007f]/.test(device.token)) fail();
            if (seen.has(device.token)) continue;
            seen.add(device.token); targets.push({ recipientUid: uid, channel: 'push', endpoint: device.token });
        }
        return targets;
    };
    return {
        async resolve({ teamId, actorUid }) {
            if (!ID.test(teamId || '') || !ID.test(actorUid || '')) fail();
            const members = await safe(() => listCanonicalMembers(teamId));
            if (!members || members.complete !== true || !Array.isArray(members.uids) || members.uids.length > 100 || members.uids.some((uid) => !ID.test(uid || ''))) fail();
            const targets = []; const tokenOwners = new Map();
            for (const uid of [...new Set(members.uids)].sort()) {
                if (uid === actorUid) continue; // existing schedule actor exclusion
                for (const target of await eligible(teamId, uid)) {
                    if (target.channel === 'push') {
                        if (tokenOwners.has(target.endpoint) && tokenOwners.get(target.endpoint) !== uid) fail();
                        tokenOwners.set(target.endpoint, uid);
                    }
                    targets.push(target);
                    if (targets.length > 100) fail(); // never silently send a partial page
                }
            }
            return targets;
        },
        async authorize({ actor, binding, request }) {
            if (await safe(() => authorizeActor(actor, binding.teamId)) !== true) return { actorAllowed: false, recipientAllowed: false };
            if (!request) return { actorAllowed: true, recipientAllowed: true };
            if (request.teamId !== binding.teamId || request.actorUid !== actor.uid || !ID.test(request.recipientUid || '') || request.recipientUid === actor.uid) return { actorAllowed: true, recipientAllowed: false };
            const targets = await eligible(binding.teamId, request.recipientUid);
            return { actorAllowed: true, recipientAllowed: targets.some((target) => target.channel === request.channel && target.endpoint === request.endpoint) };
        }
    };
}

function createFirestoreScheduleRecipientLoader({ firestore, auth, resolveCanonicalRoles }) {
    if (!firestore?.doc || !firestore?.collection || !auth?.getUser || typeof resolveCanonicalRoles !== 'function') throw new Error('Explicit server-side recipient readers are required.');
    return async ({ teamId, uid }) => {
        if (!ID.test(teamId || '') || !ID.test(uid || '')) fail();
        let authUser;
        try { authUser = await auth.getUser(uid); }
        catch (error) {
            if (error?.code === 'auth/user-not-found') return { uid, complete: true, authEnabled: false, roles: [], preferences: null, devices: [] };
            fail();
        }
        if (authUser?.uid !== uid || typeof authUser.disabled !== 'boolean') fail();
        const [team, user, prefs, devices] = await Promise.all([
            firestore.doc(`teams/${teamId}`).get(), firestore.doc(`users/${uid}`).get(),
            firestore.doc(`users/${uid}/notificationPreferences/${teamId}`).get(),
            firestore.collection(`users/${uid}/notificationDevices`).limit(21).get()
        ]);
        if (!Array.isArray(devices.docs) || devices.docs.length > 20) fail();
        return { uid, complete: true, authEnabled: !authUser.disabled,
            roles: team.exists && user.exists ? resolveCanonicalRoles({ teamId, team: team.data(), user: user.data(), uid, email: authUser.email || '', emailVerified: authUser.emailVerified === true }) : [],
            preferences: prefs.exists ? prefs.data() : null,
            devices: devices.docs.map((snapshot) => ({ ownerUid: uid, token: snapshot.data()?.token })) };
    };
}

module.exports = { createScheduleDeliveryAudience, createFirestoreScheduleRecipientLoader };
