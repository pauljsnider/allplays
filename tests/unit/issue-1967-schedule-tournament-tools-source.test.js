import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const standingsSource = readFileSync(new URL('../../js/tournament-standings.js', import.meta.url), 'utf8');
const tournamentBracketsSource = readFileSync(new URL('../../js/tournament-brackets.js', import.meta.url), 'utf8');
const bracketManagementSource = readFileSync(new URL('../../js/bracket-management.js', import.meta.url), 'utf8');
const dbSource = readFileSync(new URL('../../js/db.js', import.meta.url), 'utf8');
const scheduleDetailSource = readFileSync(new URL('../../apps/app/src/pages/ScheduleEventDetail.tsx', import.meta.url), 'utf8');
const scheduleLogicSource = readFileSync(new URL('../../apps/app/src/lib/scheduleLogic.ts', import.meta.url), 'utf8');
const editScheduleTournamentTestSource = readFileSync(new URL('./edit-schedule-tournament.test.js', import.meta.url), 'utf8');
const tournamentStandingsTestSource = readFileSync(new URL('./tournament-standings.test.js', import.meta.url), 'utf8');
const tournamentBracketsTestSource = readFileSync(new URL('./tournament-brackets.test.js', import.meta.url), 'utf8');
const bracketManagementTestSource = readFileSync(new URL('./bracket-management.test.js', import.meta.url), 'utf8');
const dbTournamentOverridesTestSource = readFileSync(new URL('./db-tournament-overrides.test.js', import.meta.url), 'utf8');
const appTournamentInfoTestSource = readFileSync(new URL('./app-schedule-tournament-info.test.ts', import.meta.url), 'utf8');

describe('issue 1967 schedule tournament tools source contract', () => {
    it('keeps pool standings helpers and persisted override APIs available', () => {
        expect(standingsSource).toContain('export function buildTournamentPoolOverrideKey(poolName)');
        expect(standingsSource).toContain('export function applyTournamentStandingsOverride');
        expect(standingsSource).toContain('export function buildTournamentPoolStandings');
        expect(standingsSource).toContain('export function computeTournamentPoolStandings');
        expect(dbSource).toContain('export async function saveTournamentPoolOverride');
        expect(dbSource).toContain('export async function clearTournamentPoolOverride');
        expect(tournamentStandingsTestSource).toContain('builds division-scoped admin standings and applies final ranking overrides');
        expect(dbTournamentOverridesTestSource).toContain('retires a legacy override through a structured save and clear round trip');
    });

    it('keeps bracket source resolution and pool advancement helpers wired for schedule games', () => {
        expect(tournamentBracketsSource).toContain('export function describeTournamentSource');
        expect(tournamentBracketsSource).toContain('export function getTournamentWinner');
        expect(tournamentBracketsSource).toContain('export function collectTournamentPoolSeeds');
        expect(tournamentBracketsSource).toContain('export function collectTournamentAdvancementPatches');
        expect(tournamentBracketsSource).toContain('export function planTournamentPoolAdvancement');
        expect(tournamentBracketsSource).toContain('requiresPoolProtectionOverride: poolProtectionConflicts.length > 0');
        expect(dbSource).toContain('export async function applyTournamentAdvancementPatches');
        expect(tournamentBracketsTestSource).toContain('keeps finalized pool-seed slots stable after advancement is saved');
    });

    it('keeps bracket management creation, reporting, publish, and public view helpers together', () => {
        expect(bracketManagementSource).toContain('export function createSingleEliminationBracket');
        expect(bracketManagementSource).toContain('export function reportBracketGameResult');
        expect(bracketManagementSource).toContain('export function publishBracket');
        expect(bracketManagementSource).toContain('export function buildPublishedBracketView');
        expect(dbSource).toContain("collection(db, `teams/${teamId}/brackets`)");
        expect(dbSource).toContain('const publishedView = buildPublishedBracketView(publishedBracket);');
        expect(bracketManagementTestSource).toContain('publishes brackets and exposes public-safe read model');
    });

    it('keeps tournament metadata editable in schedule flows and readable in the app', () => {
        expect(editScheduleTournamentTestSource).toContain('includes tournament bracket configuration fields in the game form');
        expect(editScheduleTournamentTestSource).toContain('wires the pool advancement action through the full team game list');
        expect(editScheduleTournamentTestSource).toContain('requires and displays pool-protection override audit notes');
        expect(scheduleDetailSource).toContain("competitionType: event.competitionType || 'league'");
        expect(scheduleDetailSource).toContain('<option value="tournament">Tournament</option>');
        expect(scheduleLogicSource).toContain('export function getScheduleTournamentInfo');
        expect(appTournamentInfoTestSource).toContain('builds a concise label and details from tournament bracket metadata');
    });
});
