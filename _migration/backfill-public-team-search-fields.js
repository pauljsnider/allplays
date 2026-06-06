#!/usr/bin/env node

import admin from 'firebase-admin';

const zipCache = new Map();
const ZIP_RESOLVE_CONCURRENCY = 10;
const ZIP_RESOLVE_MAX_ATTEMPTS = 3;
const RETRYABLE_STATUS_CODES = new Set([408, 425, 429, 500, 502, 503, 504]);
const FIRESTORE_BATCH_LIMIT = 500;

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

function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

async function resolveZip(zip) {
    const normalizedZip = String(zip || '').trim();
    if (!normalizedZip) return null;
    if (zipCache.has(normalizedZip)) return zipCache.get(normalizedZip);

    for (let attempt = 1; attempt <= ZIP_RESOLVE_MAX_ATTEMPTS; attempt += 1) {
        try {
            const response = await fetch(`https://api.zippopotam.us/us/${encodeURIComponent(normalizedZip)}`);
            if (!response.ok) {
                if (RETRYABLE_STATUS_CODES.has(response.status) && attempt < ZIP_RESOLVE_MAX_ATTEMPTS) {
                    await sleep(250 * (2 ** (attempt - 1)));
                    continue;
                }
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
            if (attempt < ZIP_RESOLVE_MAX_ATTEMPTS) {
                await sleep(250 * (2 ** (attempt - 1)));
                continue;
            }
            console.warn(`[backfill-public-team-search-fields] Failed to resolve ZIP ${normalizedZip}:`, error.message || error);
            zipCache.set(normalizedZip, null);
            return null;
        }
    }

    zipCache.set(normalizedZip, null);
    return null;
}

function buildSearchFieldPatch(location) {
    return {
        publicSearchCity: normalizePublicTeamSearchValue(location.city),
        publicSearchState: normalizePublicTeamSearchValue(location.state, { uppercase: true }),
        publicSearchCityState: `${normalizePublicTeamSearchValue(location.city)}, ${normalizePublicTeamSearchValue(location.state)}`
    };
}

async function mapWithConcurrency(items, concurrency, handler) {
    const safeConcurrency = Math.max(1, Math.min(Number(concurrency) || 1, items.length || 1));
    let nextIndex = 0;

    async function worker() {
        while (nextIndex < items.length) {
            const currentIndex = nextIndex;
            nextIndex += 1;
            await handler(items[currentIndex], currentIndex);
        }
    }

    await Promise.all(Array.from({ length: safeConcurrency }, () => worker()));
}

async function commitBatch(batch, pendingCount) {
    if (pendingCount === 0) return 0;
    await batch.commit();
    return pendingCount;
}

async function main() {
    if (!admin.apps.length) {
        admin.initializeApp();
    }

    const db = admin.firestore();
    const snapshot = await db.collection('teams')
        .where('isPublic', '==', true)
        .get();

    const candidateTeams = snapshot.docs.filter((teamDoc) => {
        const team = teamDoc.data() || {};
        const hasCity = String(team.city || '').trim();
        const hasState = String(team.state || '').trim();
        const hasMaterializedCity = String(team.publicSearchCity || '').trim();
        const hasMaterializedState = String(team.publicSearchState || '').trim();
        const zip = String(team.zip || '').trim();

        return !(hasCity && hasState) && !(hasMaterializedCity && hasMaterializedState) && !!zip;
    });

    const zipLocations = new Map();
    const uniqueZips = [...new Set(candidateTeams.map((teamDoc) => String(teamDoc.data()?.zip || '').trim()).filter(Boolean))];
    await mapWithConcurrency(uniqueZips, ZIP_RESOLVE_CONCURRENCY, async (zip) => {
        zipLocations.set(zip, parseResolvedZipLocation(await resolveZip(zip)));
    });

    let updatedCount = 0;
    let skippedCount = snapshot.docs.length - candidateTeams.length;
    let pendingBatchCount = 0;
    let batch = db.batch();

    for (const teamDoc of candidateTeams) {
        const team = teamDoc.data() || {};
        const zip = String(team.zip || '').trim();

        try {
            const resolvedLocation = zipLocations.get(zip) || null;
            if (!resolvedLocation) {
                skippedCount += 1;
                console.warn(`[backfill-public-team-search-fields] Skipped ${teamDoc.id}: unable to resolve ZIP ${zip}`);
                continue;
            }

            batch.update(teamDoc.ref, buildSearchFieldPatch(resolvedLocation));
            pendingBatchCount += 1;
            console.log(`[backfill-public-team-search-fields] Queued ${teamDoc.id} -> ${resolvedLocation.city}, ${resolvedLocation.state}`);

            if (pendingBatchCount === FIRESTORE_BATCH_LIMIT) {
                updatedCount += await commitBatch(batch, pendingBatchCount);
                batch = db.batch();
                pendingBatchCount = 0;
            }
        } catch (error) {
            console.error(`[backfill-public-team-search-fields] Failed to update team ${teamDoc.id}:`, error);
            throw error;
        }
    }

    updatedCount += await commitBatch(batch, pendingBatchCount);

    console.log(`[backfill-public-team-search-fields] Done. Updated ${updatedCount} team(s), skipped ${skippedCount} team(s).`);
}

main().catch((error) => {
    console.error('[backfill-public-team-search-fields] Failed:', error);
    process.exitCode = 1;
});
