import { describe, expect, it, vi } from "vitest";

import {
  DIAMOND_STATS_EXPORT_MAX_ROWS,
  buildDiamondStatsCsv,
  downloadDiamondStatsCsv,
  getDiamondStatsExportFilename,
} from "../../js/diamond-stat-export.js";

const definitions = [
  { id: "h", label: "H", precision: 0, visibility: "public" },
  { id: "avg", label: "AVG", precision: 3, visibility: "public" },
  { id: "pitches", label: "PITCHES", precision: 0, visibility: "public" },
  { id: "secret_note", label: "Secret", visibility: "private" },
];

function diamondRow(overrides = {}) {
  return {
    recordType: "player",
    identity: {
      playerId: "player-1",
      playerName: 'Alex "Ace", Jr.',
      playerNumber: "7",
      gameId: "game-1",
      opponent: "Visitors",
    },
    stats: { h: 0, avg: 0, pitches: 0 },
    presentation: {
      isDiamond: true,
      sourceRevision: 12,
      statCoverage: { h: "complete", avg: "partial", pitches: "not_collected" },
      projection: {
        pending: false,
        status: "current",
        authoritativeRevision: 12,
      },
    },
    ...overrides,
  };
}

function parseCsvLine(line) {
  const cells = [];
  let cell = "";
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];
    if (character === '"' && quoted && line[index + 1] === '"') {
      cell += '"';
      index += 1;
    } else if (character === '"') {
      quoted = !quoted;
    } else if (character === "," && !quoted) {
      cells.push(cell);
      cell = "";
    } else {
      cell += character;
    }
  }
  cells.push(cell);
  return cells;
}

describe("Diamond stats CSV export", () => {
  it("exports zero, partial observations, missing values, coverage, and revision provenance distinctly", () => {
    const csv = buildDiamondStatsCsv({
      rows: [diamondRow()],
      statDefinitions: definitions,
      projection: {
        pending: false,
        status: "current",
        authoritativeRevision: 12,
        sourceRevisions: [12],
      },
    });
    const [headerLine, rowLine] = csv.trim().split("\r\n");
    const headers = parseCsvLine(headerLine);
    const values = Object.fromEntries(
      headers.map((header, index) => [header, parseCsvLine(rowLine)[index]]),
    );

    expect(values).toMatchObject({
      tracking_engine: "diamond-v2",
      projection_status: "current",
      authoritative_revision: "12",
      source_revision: "12",
      h: "0",
      h__coverage: "complete",
      avg: "0",
      avg__coverage: "partial",
      pitches: "",
      pitches__coverage: "not_collected",
    });
    expect(headers).not.toContain("secret_note");
    expect(values.player_name).toBe('Alex "Ace", Jr.');
  });

  it("marks stale rows pending and preserves the row source revision instead of relabeling it current", () => {
    const csv = buildDiamondStatsCsv({
      rows: [
        diamondRow({
          presentation: {
            ...diamondRow().presentation,
            sourceRevision: 11,
            projection: {
              pending: true,
              status: "pending",
              authoritativeRevision: 12,
            },
          },
        }),
      ],
      statDefinitions: definitions,
      projection: {
        pending: true,
        authoritativeRevision: 12,
        sourceRevisions: [11],
      },
    });
    const [headerLine, rowLine] = csv.trim().split("\r\n");
    const headers = parseCsvLine(headerLine);
    const row = parseCsvLine(rowLine);

    expect(row[headers.indexOf("projection_status")]).toBe("pending");
    expect(row[headers.indexOf("authoritative_revision")]).toBe("12");
    expect(row[headers.indexOf("source_revision")]).toBe("11");
  });

  it("neutralizes spreadsheet formulas in textual identity fields", () => {
    const csv = buildDiamondStatsCsv({
      rows: [
        diamondRow({
          identity: {
            playerId: "player-1",
            playerName: '=HYPERLINK("bad")',
            playerNumber: "+7",
          },
        }),
      ],
      statDefinitions: definitions,
    });
    const [headerLine, rowLine] = csv.trim().split("\r\n");
    const headers = parseCsvLine(headerLine);
    const row = parseCsvLine(rowLine);

    expect(row[headers.indexOf("player_name")]).toBe('\'=HYPERLINK("bad")');
    expect(row[headers.indexOf("player_number")]).toBe("'+7");
  });

  it("fails closed for legacy rows and oversized exports", () => {
    expect(() =>
      buildDiamondStatsCsv({
        rows: [diamondRow({ presentation: { isDiamond: false } })],
        statDefinitions: definitions,
      }),
    ).toThrow(/cannot mix legacy/i);

    const row = diamondRow();
    expect(() =>
      buildDiamondStatsCsv({
        rows: Array.from(
          { length: DIAMOND_STATS_EXPORT_MAX_ROWS + 1 },
          () => row,
        ),
        statDefinitions: definitions,
      }),
    ).toThrow(/limited/i);
  });

  it("downloads a sanitized CSV filename and releases its object URL", () => {
    vi.useFakeTimers();
    const click = vi.fn();
    const remove = vi.fn();
    const appendChild = vi.fn();
    const link = { href: "", download: "", click, remove };
    const createObjectURL = vi.fn(() => "blob:diamond-export");
    const revokeObjectURL = vi.fn();

    downloadDiamondStatsCsv("Fall 2026 / Stats", '"h"\r\n"1"\r\n', {
      documentRef: { createElement: vi.fn(() => link), body: { appendChild } },
      urlRef: { createObjectURL, revokeObjectURL },
    });

    expect(link.download).toBe("Fall-2026-Stats-public.csv");
    expect(click).toHaveBeenCalledOnce();
    expect(remove).toHaveBeenCalledOnce();
    vi.advanceTimersByTime(500);
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:diamond-export");
    vi.useRealTimers();
    expect(getDiamondStatsExportFilename("diamond.csv")).toBe("diamond-public.csv");
  });
});
