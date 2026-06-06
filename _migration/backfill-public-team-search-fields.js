#!/usr/bin/env node

import admin from 'firebase-admin';

const zipCache = new Map();

function normalizePublicTeamSearchValue(value, { uppercase = false } = {}) {
    const normalized = String(value || '').trim();
    return uppercase ? normalized.toUpperCase() : normalized.toLowerCase();
}

function parseResolvedZipLocation(resolvedLocation) {
    const normalizedLocation = String(resolvedLocation || '').trim();
    if (!normalizedLocation) return null;

    const [cityPart, statePart = ''] = normalizedLocation.split(',').map((part) => part.trim());
    if (!cityPart || !statePart) return null;

    return {
        city: cityPart,
        state: statePart.toUpperCase()
    };
}

async function resolveZip(zip) {
    const normalizedZip = String(zip || '').trim();
    if (!normalizedZip) return null;
    if (zipCache.has(normalizedZip)) return zipCache.get(normalizedZip);

    try {
        const response = await fetch(`https://api.zippopotam.us/us/${encodeURIComponent(normalizedZip)}`);
        if (!response.ok) {
            zipCache.set(normalizedZip, null);
            return null;
        }

        const place = (await response.json())?.places?.[0];
        const resolvedLocation = place?.['place name'] && place?.['state abbreviation']
            ? `${place['place name']}, ${place['state abbreviation']}`
            : null;
        zipCache.set(normalizedZip, resolvedLocation);
        return resolvedLocation;
    } catch (error) {
        console.warn(`[backfill-public-team-search-fields] Failed to resolve ZIP ${normalizedZip}:`, error.message || error);
        zipCache.set(normalizedZip, null);
        return null;
    }
}

function buildSearchFieldPatch(location) {
    return {
        publicSearchCity: normalizePublicTeamSearchValue(location.city),
        publicSearchState: normalizePublicTeamSearchValue(location.state, { uppercase: true }),
        publicSearchCityState: `${normalizePublicTeamSearchValue(location.city)}, ${normalizePublicTeamSearchValue(location.state)}`
    };
}

async function main() {
    if (!admin.apps.length) {
        admin.initializeApp();
    }

    const db = admin.firestore();
    const snapshot = await db.collection('teams')
        .where('isPublic', '==', true)
        .get();

    let updatedCount = 0;
    let skippedCount = 0;

    for (const teamDoc of snapshot.docs) {
        const team = teamDoc.data() || {};
        const hasCity = String(team.city || '').trim();
        const hasState = String(team.state || '').trim();
        const hasMaterializedCity = String(team.publicSearchCity || '').trim();
        const hasMaterializedState = String(team.publicSearchState || '').trim();
        const zip = String(team.zip || '').trim();

        if ((hasCity && hasState) || (hasMaterializedCity && hasMaterializedState) || !zip) {
            skippedCount += 1;
            continue;
        }

        const resolvedLocation = parseResolvedZipLocation(await resolveZip(zip));
        if (!resolvedLocation) {
            skippedCount += 1;
            continue;
        }

        await teamDoc.ref.update(buildSearchFieldPatch(resolvedLocation));
        updatedCount += 1;
        console.log(`[backfill-public-team-search-fields] Updated ${teamDoc.id} -> ${resolvedLocation.city}, ${resolvedLocation.state}`);
    }

    console.log(`[backfill-public-team-search-fields] Done. Updated ${updatedCount} team(s), skipped ${skippedCount} team(s).`);
}

main().catch((error) => {
    console.error('[backfill-public-team-search-fields] Failed:', error);
    process.exitCode = 1;
});
