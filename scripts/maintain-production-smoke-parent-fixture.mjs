import { pathToFileURL } from 'node:url';
import {
    createFirebaseRestSession,
    getFirestoreDocument,
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

export function inspectParentFixture(userDocument, playerDocument, teamId, playerId) {
    const fields = userDocument?.fields || {};
    const playerKey = `${teamId}::${playerId}`;
    const hasParentOf = getArrayValues(fields.parentOf)
        .some((value) => isParentLink(value, teamId, playerId));
    const hasParentTeamId = hasStringValue(fields.parentTeamIds, teamId);
    const hasParentPlayerKey = hasStringValue(fields.parentPlayerKeys, playerKey);
    const playerExists = Boolean(playerDocument);
    const playerActive = playerExists && isActiveRosterPlayer(playerDocument);

    return {
        ready: hasParentOf && hasParentTeamId && hasParentPlayerKey && playerActive,
        hasParentOf,
        hasParentTeamId,
        hasParentPlayerKey,
        playerExists,
        playerActive
    };
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

    const [adminDocument, teamDocument] = await Promise.all([
        getFirestoreDocument(adminSession, `users/${adminSession.localId}`),
        getFirestoreDocument(staffSession, `teams/${teamId}`)
    ]);
    if (!adminDocument || !isGlobalAdmin(adminDocument)) {
        throw new Error('The admin smoke account is not authorized to maintain fixture membership');
    }
    if (!teamDocument || !isAuthorizedFixtureManager(teamDocument, staffSession, staffEmail)) {
        throw new Error('The staff smoke account is not an owner or administrator of the fixture team');
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

    let inspection = inspectParentFixture(parentDocument, playerDocument, teamId, playerId);
    if (mode === 'repair' && !inspection.ready) {
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

        [playerDocument, parentDocument] = await Promise.all([
            getFirestoreDocument(staffSession, playerPath),
            getFirestoreDocument(parentSession, parentPath)
        ]);
        inspection = inspectParentFixture(parentDocument, playerDocument, teamId, playerId);
    }

    if (!inspection.ready) {
        throw new Error(
            `Parent fixture is not ready (parent-link=${inspection.hasParentOf}, ` +
            `team-link=${inspection.hasParentTeamId}, player-key=${inspection.hasParentPlayerKey}, ` +
            `player-exists=${inspection.playerExists}, player-active=${inspection.playerActive})`
        );
    }

    console.log(`Parent fixture ${mode} passed with a linked active player.`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    main().catch((error) => {
        console.error(`Production smoke parent fixture failed: ${error?.message || 'Unknown error'}`);
        process.exitCode = 1;
    });
}
