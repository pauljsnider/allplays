import { pathToFileURL } from 'node:url';
import {
    createFirebaseRestSession,
    findFirestoreDocumentsByStringArrayContains,
    findFirestoreDocumentsByStringField,
    getFirestoreDocument,
    getFirestoreDocumentPath,
    patchFirestoreDocumentFields
} from '../tests/smoke/helpers/firebase-rest.js';
import { assertSmokeFixtureIdentifier } from './maintain-production-smoke-official-fixture.mjs';

function getStringField(fields, fieldName) {
    return String(fields?.[fieldName]?.stringValue || '');
}

function getArrayValues(field) {
    return Array.isArray(field?.arrayValue?.values) ? field.arrayValue.values : [];
}

function getMapFields(value) {
    return value?.mapValue?.fields || {};
}

function getBooleanField(fields, fieldName) {
    return fields?.[fieldName]?.booleanValue;
}

function getStringArray(field) {
    return getArrayValues(field)
        .map((value) => String(value?.stringValue || '').trim().toLowerCase())
        .filter(Boolean);
}

function hasStringValue(field, expected) {
    return getArrayValues(field).some((value) => String(value?.stringValue || '') === expected);
}

function isParentLink(value, teamId, playerId) {
    const fields = getMapFields(value);
    return getStringField(fields, 'teamId') === teamId &&
        getStringField(fields, 'playerId') === playerId;
}

function isActiveRosterPlayer(document) {
    const fields = document?.fields || {};
    const status = getStringField(fields, 'status');
    return getBooleanField(fields, 'active') !== false &&
        getBooleanField(fields, 'archived') !== true &&
        (!status || status === 'active');
}

function isActiveTeam(document) {
    const fields = document?.fields || {};
    const status = getStringField(fields, 'status').trim().toLowerCase();
    return getBooleanField(fields, 'active') !== false &&
        getBooleanField(fields, 'archived') !== true &&
        !['archived', 'inactive', 'disabled'].includes(status);
}

export function inspectParentFixture(
    userDocument,
    teamDocument,
    playerDocument,
    teamId,
    playerId
) {
    const fields = userDocument?.fields || {};
    const playerKey = `${teamId}::${playerId}`;
    const hasParentOf = getArrayValues(fields.parentOf)
        .some((value) => isParentLink(value, teamId, playerId));
    const hasParentTeamId = hasStringValue(fields.parentTeamIds, teamId);
    const hasParentPlayerKey = hasStringValue(fields.parentPlayerKeys, playerKey);
    const teamActive = Boolean(teamDocument) && isActiveTeam(teamDocument);
    const playerExists = Boolean(playerDocument);
    const playerActive = playerExists && isActiveRosterPlayer(playerDocument);

    return {
        ready: hasParentOf && hasParentTeamId && hasParentPlayerKey && teamActive && playerActive,
        hasParentOf,
        hasParentTeamId,
        hasParentPlayerKey,
        teamActive,
        playerExists,
        playerActive
    };
}

export function assertUnprivilegedParentFixture(userDocument, teamDocument, { uid, email }) {
    const userFields = userDocument?.fields || {};
    const teamFields = teamDocument?.fields || {};
    const normalizedEmail = String(email || '').trim().toLowerCase();
    const privilegedRoles = new Set(['admin', 'platformadmin', 'staff', 'coach', 'manager', 'owner']);
    const hasPrivilegedRole = getStringArray(userFields.roles).some((role) => privilegedRoles.has(role));
    const ownsTeam = Boolean(uid) && getStringField(teamFields, 'ownerId') === uid;
    const administersTeam = Boolean(normalizedEmail) && getStringArray(teamFields.adminEmails).includes(normalizedEmail);
    if (
        getBooleanField(userFields, 'isAdmin') === true ||
        getBooleanField(userFields, 'isPlatformAdmin') === true ||
        hasPrivilegedRole ||
        ownsTeam ||
        administersTeam
    ) {
        throw new Error('The parent smoke account has privileged access and cannot be used for parent-only coverage');
    }
    return true;
}

function buildStringArray(values) {
    return {
        arrayValue: {
            values: values.map((value) => ({ stringValue: value }))
        }
    };
}

function uniqueStrings(field, requiredValue) {
    return [
        ...new Set([
            ...getArrayValues(field).map((value) => String(value?.stringValue || '')).filter(Boolean),
            requiredValue
        ])
    ];
}

function buildParentLink(teamId, playerId, teamName, playerName) {
    return {
        mapValue: {
            fields: {
                teamId: { stringValue: teamId },
                teamName: { stringValue: teamName },
                playerId: { stringValue: playerId },
                playerName: { stringValue: playerName }
            }
        }
    };
}

export function buildParentMembershipPatch(
    userDocument,
    { teamId, playerId, teamName = 'Smoke Team', playerName = 'Smoke Player' }
) {
    const fields = userDocument?.fields || {};
    const parentOf = [
        ...getArrayValues(fields.parentOf)
            .filter((value) => !isParentLink(value, teamId, playerId)),
        buildParentLink(teamId, playerId, teamName, playerName)
    ];

    return {
        fields: {
            parentOf: { arrayValue: { values: parentOf } },
            parentTeamIds: buildStringArray(uniqueStrings(fields.parentTeamIds, teamId)),
            parentPlayerKeys: buildStringArray(
                uniqueStrings(fields.parentPlayerKeys, `${teamId}::${playerId}`)
            )
        }
    };
}

export function buildActivePlayerPatch() {
    return {
        fields: {
            active: { booleanValue: true },
            archived: { booleanValue: false },
            status: { stringValue: 'active' }
        }
    };
}

export function buildActiveTeamPatch() {
    return {
        fields: {
            active: { booleanValue: true },
            archived: { booleanValue: false },
            status: { stringValue: 'active' }
        }
    };
}

export function inspectStaffTeamDiscovery(
    teamDocument,
    staffDocument,
    { uid, email, teamId, ownerQueryFound = false, adminQueryFound = false }
) {
    const fields = teamDocument?.fields || {};
    const staffFields = staffDocument?.fields || {};
    const normalizedEmail = String(email || '').trim().toLowerCase();
    const ownsTeam = Boolean(uid) && getStringField(fields, 'ownerId') === uid;
    const hasCanonicalAdminEmail = Boolean(normalizedEmail) && getArrayValues(fields.adminEmails)
        .some((value) => String(value?.stringValue || '') === normalizedEmail);
    const hasCoachTeamId = Boolean(teamId) && hasStringValue(staffFields.coachOf, teamId);
    const directCoachDiscovery = hasCoachTeamId && (ownsTeam || hasCanonicalAdminEmail);
    return {
        ready: ownerQueryFound || adminQueryFound || directCoachDiscovery,
        ownsTeam,
        hasCanonicalAdminEmail,
        hasCoachTeamId,
        ownerQueryFound,
        adminQueryFound,
        directCoachDiscovery
    };
}

export function buildCanonicalStaffAccessPatch(teamDocument, email) {
    const normalizedEmail = String(email || '').trim().toLowerCase();
    if (!normalizedEmail) throw new Error('Canonical staff email is required');
    const adminEmails = getArrayValues(teamDocument?.fields?.adminEmails)
        .map((value) => String(value?.stringValue || ''))
        .filter((value) => value.trim().toLowerCase() !== normalizedEmail);
    return {
        fields: {
            adminEmails: buildStringArray([...adminEmails, normalizedEmail])
        }
    };
}

export function buildCanonicalStaffProfilePatch(staffDocument, teamId) {
    if (!teamId) throw new Error('Canonical staff team ID is required');
    const coachTeamIds = getArrayValues(staffDocument?.fields?.coachOf)
        .map((value) => String(value?.stringValue || ''))
        .filter((value) => value.trim() !== teamId);
    return {
        fields: {
            coachOf: buildStringArray([...coachTeamIds, teamId])
        }
    };
}

function queryContainsDocument(documents, documentPath) {
    return documents.some((document) => getFirestoreDocumentPath(document) === documentPath);
}

async function queryManagedTeamCallable(session, fetchImpl) {
    const response = await fetchImpl(
        `https://us-central1-${encodeURIComponent(session.projectId)}.cloudfunctions.net/listManagedTeams`,
        {
            method: 'POST',
            headers: {
                authorization: `Bearer ${session.idToken}`,
                'content-type': 'application/json'
            },
            body: JSON.stringify({ data: {} }),
            signal: AbortSignal.timeout(30_000)
        }
    );
    const payload = await response.json().catch(() => ({}));
    const result = payload?.result || payload?.data;
    if (!response.ok || !Array.isArray(result?.items)) {
        const errorStatus = String(payload?.error?.status || '').trim() || 'invalid-response';
        throw new Error(`Managed-team callable failed with HTTP ${response.status} (${errorStatus})`);
    }
    return {
        items: result.items.filter((item) => item && typeof item === 'object' && !Array.isArray(item)),
        isPartial: result.isPartial === true
    };
}

export async function loadManagedTeamCallable(session, teamId, fetchImpl = fetch) {
    let result;
    for (let attempt = 0; attempt < 2; attempt += 1) {
        result = await queryManagedTeamCallable(session, fetchImpl);
        const foundFixture = result.items.some(
            (item) => String(item?.id || '').trim() === teamId
        );
        if (foundFixture || !result.isPartial) return result;
    }
    throw new Error(
        `The app managed-team callable result is inconclusive and retryable after a partial retry ` +
        `(items=${result.items.length}, partial=true)`
    );
}

async function queryStaffTeamDiscovery(session, teamId, email) {
    const normalizedEmail = String(email || '').trim().toLowerCase();
    const teamPath = `teams/${teamId}`;
    const [ownerResult, adminResult] = await Promise.allSettled([
        findFirestoreDocumentsByStringField(session, 'teams', 'ownerId', session.localId),
        normalizedEmail
            ? findFirestoreDocumentsByStringArrayContains(
                session,
                'teams',
                'adminEmails',
                normalizedEmail
            )
            : Promise.resolve([])
    ]);
    return {
        ownerQueryFound: ownerResult.status === 'fulfilled' &&
            queryContainsDocument(ownerResult.value, teamPath),
        adminQueryFound: adminResult.status === 'fulfilled' &&
            queryContainsDocument(adminResult.value, teamPath),
        ownerQueryFailed: ownerResult.status === 'rejected',
        adminQueryFailed: adminResult.status === 'rejected'
    };
}

function isAuthorizedFixtureManager(teamDocument, session, staffEmail) {
    const fields = teamDocument?.fields || {};
    if (getStringField(fields, 'ownerId') === session.localId) return true;
    const normalizedEmail = String(staffEmail || '').trim().toLowerCase();
    return getArrayValues(fields.adminEmails)
        .map((value) => String(value?.stringValue || '').trim().toLowerCase())
        .includes(normalizedEmail);
}

function isGlobalAdmin(userDocument) {
    return getBooleanField(userDocument?.fields || {}, 'isAdmin') === true;
}

function getDisplayName(document, fallback) {
    const fields = document?.fields || {};
    return getStringField(fields, 'name').trim() ||
        getStringField(fields, 'displayName').trim() ||
        fallback;
}

async function main() {
    const mode = String(process.env.SMOKE_FIXTURE_MODE || 'audit').trim().toLowerCase();
    if (!['audit', 'repair'].includes(mode)) {
        throw new Error('SMOKE_FIXTURE_MODE must be audit or repair');
    }

    const appBaseUrl = String(process.env.SMOKE_APP_BASE_URL || '').trim();
    const teamId = String(process.env.SMOKE_TEAM_ID || '').trim();
    const playerId = String(process.env.SMOKE_PLAYER_ID || '').trim();
    const adminEmail = String(process.env.SMOKE_ADMIN_EMAIL || '').trim();
    const adminPassword = String(process.env.SMOKE_ADMIN_PASSWORD || '');
    const staffEmail = String(process.env.SMOKE_STAFF_EMAIL || '').trim();
    const staffPassword = String(process.env.SMOKE_STAFF_PASSWORD || '');
    const parentEmail = String(process.env.SMOKE_PARENT_EMAIL || '').trim();
    const parentPassword = String(process.env.SMOKE_PARENT_PASSWORD || '');
    if (
        !appBaseUrl || !teamId || !playerId ||
        !adminEmail || !adminPassword ||
        !staffEmail || !staffPassword ||
        !parentEmail || !parentPassword
    ) {
        throw new Error('Protected production smoke parent fixture configuration is incomplete');
    }
    assertSmokeFixtureIdentifier(teamId, 'Team ID');
    assertSmokeFixtureIdentifier(playerId, 'Player ID');

    const [adminSession, staffSession, parentSession] = await Promise.all([
        createFirebaseRestSession({
            appBaseUrl,
            email: adminEmail,
            password: adminPassword
        }),
        createFirebaseRestSession({
            appBaseUrl,
            email: staffEmail,
            password: staffPassword
        }),
        createFirebaseRestSession({
            appBaseUrl,
            email: parentEmail,
            password: parentPassword
        })
    ]);

    let [adminDocument, staffDocument, teamDocument] = await Promise.all([
        getFirestoreDocument(adminSession, `users/${adminSession.localId}`),
        getFirestoreDocument(staffSession, `users/${staffSession.localId}`),
        getFirestoreDocument(staffSession, `teams/${teamId}`)
    ]);
    if (!adminDocument || !isGlobalAdmin(adminDocument)) {
        throw new Error('The admin smoke account is not authorized to maintain fixture membership');
    }
    const canonicalStaffEmail = String(staffSession.email || staffEmail).trim().toLowerCase();
    if (!teamDocument || !isAuthorizedFixtureManager(teamDocument, staffSession, canonicalStaffEmail)) {
        throw new Error('The staff smoke account is not an owner or administrator of the fixture team');
    }
    if (!staffDocument) {
        throw new Error('The staff smoke user profile does not exist');
    }
    let staffQueryDiscovery = await queryStaffTeamDiscovery(
        staffSession,
        teamId,
        canonicalStaffEmail
    );
    let staffDiscovery = inspectStaffTeamDiscovery(teamDocument, staffDocument, {
        uid: staffSession.localId,
        email: canonicalStaffEmail,
        teamId,
        ...staffQueryDiscovery
    });
    if (mode === 'repair' && (
        !staffDiscovery.hasCanonicalAdminEmail ||
        !staffDiscovery.hasCoachTeamId ||
        !staffDiscovery.ready
    )) {
        if (!staffDiscovery.hasCanonicalAdminEmail) {
            await patchFirestoreDocumentFields(
                adminSession,
                `teams/${teamId}`,
                buildCanonicalStaffAccessPatch(teamDocument, canonicalStaffEmail).fields,
                { updateTime: String(teamDocument.updateTime || '') }
            );
        }
        if (!staffDiscovery.hasCoachTeamId) {
            await patchFirestoreDocumentFields(
                adminSession,
                `users/${staffSession.localId}`,
                buildCanonicalStaffProfilePatch(staffDocument, teamId).fields,
                { updateTime: String(staffDocument.updateTime || '') }
            );
        }
        [staffDocument, teamDocument] = await Promise.all([
            getFirestoreDocument(staffSession, `users/${staffSession.localId}`),
            getFirestoreDocument(staffSession, `teams/${teamId}`)
        ]);
        staffQueryDiscovery = await queryStaffTeamDiscovery(
            staffSession,
            teamId,
            canonicalStaffEmail
        );
        staffDiscovery = inspectStaffTeamDiscovery(teamDocument, staffDocument, {
            uid: staffSession.localId,
            email: canonicalStaffEmail,
            teamId,
            ...staffQueryDiscovery
        });
    }
    if (!staffDiscovery.ready) {
        throw new Error(
            `The staff smoke account is not discoverable by the app's team access paths ` +
            `(owner=${staffDiscovery.ownsTeam}, canonical-admin=${staffDiscovery.hasCanonicalAdminEmail}, ` +
            `coach-link=${staffDiscovery.hasCoachTeamId}, owner-query=${staffDiscovery.ownerQueryFound}, ` +
            `admin-query=${staffDiscovery.adminQueryFound}, owner-query-failed=${staffQueryDiscovery.ownerQueryFailed}, ` +
            `admin-query-failed=${staffQueryDiscovery.adminQueryFailed})`
        );
    }
    const managedTeamResult = await loadManagedTeamCallable(staffSession, teamId);
    const callableFoundFixture = managedTeamResult.items.some(
        (item) => String(item?.id || '').trim() === teamId
    );
    if (!callableFoundFixture) {
        throw new Error(
            `The app managed-team callable omitted the fixture team ` +
            `(items=${managedTeamResult.items.length}, partial=${managedTeamResult.isPartial})`
        );
    }
    const playerPath = `teams/${teamId}/players/${playerId}`;
    const parentPath = `users/${parentSession.localId}`;
    let [playerDocument, parentDocument] = await Promise.all([
        getFirestoreDocument(staffSession, playerPath),
        getFirestoreDocument(parentSession, parentPath)
    ]);
    if (!playerDocument) {
        throw new Error('The parent smoke player fixture does not exist');
    }
    if (!parentDocument) {
        throw new Error('The parent smoke user profile does not exist');
    }
    if (String(process.env.SMOKE_REQUIRE_UNPRIVILEGED_PARENT || '').trim().toLowerCase() === 'true') {
        assertUnprivilegedParentFixture(parentDocument, teamDocument, {
            uid: parentSession.localId,
            email: parentEmail
        });
    }

    let inspection = inspectParentFixture(
        parentDocument,
        teamDocument,
        playerDocument,
        teamId,
        playerId
    );
    if (mode === 'repair' && !inspection.ready) {
        if (!inspection.teamActive) {
            await patchFirestoreDocumentFields(
                staffSession,
                `teams/${teamId}`,
                buildActiveTeamPatch().fields,
                { updateTime: String(teamDocument.updateTime || '') }
            );
        }
        if (!inspection.playerActive) {
            await patchFirestoreDocumentFields(
                staffSession,
                playerPath,
                buildActivePlayerPatch().fields,
                { updateTime: String(playerDocument.updateTime || '') }
            );
        }
        if (
            !inspection.hasParentOf ||
            !inspection.hasParentTeamId ||
            !inspection.hasParentPlayerKey
        ) {
            const membershipPatch = buildParentMembershipPatch(parentDocument, {
                teamId,
                playerId,
                teamName: getDisplayName(teamDocument, 'Smoke Team'),
                playerName: getDisplayName(playerDocument, 'Smoke Player')
            });
            await patchFirestoreDocumentFields(
                adminSession,
                parentPath,
                membershipPatch.fields,
                { updateTime: String(parentDocument.updateTime || '') }
            );
        }

        [teamDocument, playerDocument, parentDocument] = await Promise.all([
            getFirestoreDocument(staffSession, `teams/${teamId}`),
            getFirestoreDocument(staffSession, playerPath),
            getFirestoreDocument(parentSession, parentPath)
        ]);
        inspection = inspectParentFixture(
            parentDocument,
            teamDocument,
            playerDocument,
            teamId,
            playerId
        );
    }

    if (!inspection.ready) {
        throw new Error(
            `Parent fixture is not ready (parent-link=${inspection.hasParentOf}, ` +
            `team-link=${inspection.hasParentTeamId}, player-key=${inspection.hasParentPlayerKey}, ` +
            `team-active=${inspection.teamActive}, player-exists=${inspection.playerExists}, ` +
            `player-active=${inspection.playerActive})`
        );
    }

    console.log(
        `Parent fixture ${mode} passed with a linked active player and app-discoverable staff team ` +
        `(owner-query=${staffDiscovery.ownerQueryFound}, admin-query=${staffDiscovery.adminQueryFound}, ` +
        `coach-link=${staffDiscovery.hasCoachTeamId}).`
    );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    main().catch((error) => {
        console.error(`Production smoke parent fixture failed: ${error?.message || 'Unknown error'}`);
        process.exitCode = 1;
    });
}
