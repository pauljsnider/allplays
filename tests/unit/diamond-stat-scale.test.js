import { describe, expect, it } from "vitest";

import {
  DIAMOND_PLAYER_STAT_CATALOG,
  aggregateCoverageAwareSeasonStats,
} from "../../js/diamond-stat-presentation.js";
import { buildDiamondStatsCsv } from "../../js/diamond-stat-export.js";

const GAME_COUNT = 40;
const ROSTER_SIZE = 25;

function buildSeasonFixture() {
  return Array.from({ length: GAME_COUNT }, (_, gameIndex) => {
    const revision = gameIndex + 1;
    return {
      game: {
        id: `game-${revision}`,
        trackingEngine: "diamond-v2",
        diamondProjectionStatus: "current",
        diamondProjectionRevision: revision,
        rulesProfileId: "baseball-youth",
        status: "completed",
      },
      documents: Array.from({ length: ROSTER_SIZE }, (_, playerIndex) => ({
        id: `player-${playerIndex + 1}`,
        data: {
          trackingEngine: "diamond-v2",
          sourceRevision: revision,
          complete: true,
          stats: {
            g: 1,
            pa: 4,
            ab: 4,
            h: 1,
            tb: 1,
            bb: 0,
            ibb: 0,
            hbp: 0,
            sf: 0,
          },
          statCoverage: {
            g: "complete",
            pa: "complete",
            ab: "complete",
            h: "complete",
            tb: "complete",
            bb: "complete",
            ibb: "complete",
            hbp: "complete",
            sf: "complete",
            pitches: "not_collected",
            fpct: "not_collected",
          },
          coverage: {
            batting: "complete",
            baserunning: "not_collected",
            pitching: "not_collected",
            fielding: "not_collected",
            pitches: "not_collected",
          },
        },
      })),
    };
  });
}

describe("Diamond season scale acceptance", () => {
  it("aggregates and exports a 40-game, 25-player season without fabricating uncollected values", () => {
    const diamondGames = buildSeasonFixture();
    expect(diamondGames).toHaveLength(GAME_COUNT);
    expect(
      diamondGames.reduce((count, entry) => count + entry.documents.length, 0),
    ).toBe(GAME_COUNT * ROSTER_SIZE);

    const season = aggregateCoverageAwareSeasonStats({ diamondGames });
    expect(Object.keys(season.statsByPlayerId)).toHaveLength(ROSTER_SIZE);
    expect(season.projection).toEqual({
      hasDiamond: true,
      pending: false,
      sourceRevisions: Array.from(
        { length: GAME_COUNT },
        (_, index) => index + 1,
      ),
    });

    for (let playerIndex = 1; playerIndex <= ROSTER_SIZE; playerIndex += 1) {
      const playerId = `player-${playerIndex}`;
      expect(season.statsByPlayerId[playerId]).toMatchObject({
        g: GAME_COUNT,
        pa: GAME_COUNT * 4,
        ab: GAME_COUNT * 4,
        h: GAME_COUNT,
        avg: 0.25,
        obp: 0.25,
        slg: 0.25,
        ops: 0.5,
      });
      expect(season.statsByPlayerId[playerId]).not.toHaveProperty("pitches");
      expect(season.statsByPlayerId[playerId]).not.toHaveProperty("fpct");
      expect(
        season.presentationByPlayerId[playerId].statCoverage,
      ).toMatchObject({
        h: "complete",
        avg: "complete",
        pitches: "not_collected",
        fpct: "not_collected",
      });
    }

    const csv = buildDiamondStatsCsv({
      rows: Array.from({ length: ROSTER_SIZE }, (_, index) => {
        const playerId = `player-${index + 1}`;
        return {
          recordType: "season_player",
          identity: {
            playerId,
            playerName: `Player ${index + 1}`,
            playerNumber: String(index + 1),
          },
          stats: season.statsByPlayerId[playerId],
          presentation: season.presentationByPlayerId[playerId],
        };
      }),
      statDefinitions: DIAMOND_PLAYER_STAT_CATALOG,
      projection: season.projection,
    });
    const lines = csv.trim().split("\r\n");
    expect(lines).toHaveLength(ROSTER_SIZE + 1);
    expect(lines[0]).toContain('"pitches","pitches__coverage"');
    expect(lines[1]).toContain(
      '"1|2|3|4|5|6|7|8|9|10|11|12|13|14|15|16|17|18|19|20|21|22|23|24|25|26|27|28|29|30|31|32|33|34|35|36|37|38|39|40"',
    );
    expect(lines[1]).toContain('"","not_collected"');
  });
});
