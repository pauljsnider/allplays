import {
  DIAMOND_COVERAGE_STATUSES,
  DIAMOND_TRACKING_ENGINE,
  getCoverageAwareStatValue,
} from "./diamond-stat-presentation.js?v=6";

export const DIAMOND_STATS_EXPORT_MAX_ROWS = 2000;
export const DIAMOND_STATS_EXPORT_MAX_DEFINITIONS = 256;

const SAFE_STAT_ID = /^[a-z0-9][a-z0-9_]{0,63}$/;
const COVERAGE_STATUS_SET = new Set(DIAMOND_COVERAGE_STATUSES);
const BLOCKED_KEYS = new Set(["__proto__", "constructor", "prototype"]);
const FIXED_COLUMNS = Object.freeze([
  "record_type",
  "export_visibility",
  "player_id",
  "player_name",
  "player_number",
  "participation_status",
  "game_id",
  "game_date",
  "opponent",
  "tracking_engine",
  "projection_status",
  "authoritative_revision",
  "source_revision",
]);

function isRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function normalizeText(value, maximum = 200) {
  return String(value ?? "")
    .replace(/[\u0000-\u001f\u007f]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maximum);
}

function normalizeStatId(value) {
  const id = String(value || "")
    .trim()
    .toLowerCase();
  return SAFE_STAT_ID.test(id) && !BLOCKED_KEYS.has(id) ? id : "";
}

function normalizeRevision(value) {
  const revision = Number(value);
  return Number.isSafeInteger(revision) && revision >= 0 ? revision : null;
}

function normalizeDefinitions(definitions, visibility) {
  const seen = new Set();
  return (Array.isArray(definitions) ? definitions : [])
    .flatMap((definition) => {
      if (!isRecord(definition)) return [];
      const id = normalizeStatId(
        definition.id ||
          definition.fieldName ||
          definition.acronym ||
          definition.label,
      );
      const definitionVisibility = String(definition.visibility || "public").toLowerCase();
      if (
        !id ||
        seen.has(id) ||
        (visibility === "public" && ["private", "manager-internal"].includes(definitionVisibility))
      )
        return [];
      seen.add(id);
      return [{ ...definition, id }];
    })
    .slice(0, DIAMOND_STATS_EXPORT_MAX_DEFINITIONS);
}

function normalizeSourceRevision(row, projection) {
  const direct = normalizeRevision(
    row?.sourceRevision ?? row?.presentation?.sourceRevision,
  );
  if (direct !== null) return String(direct);
  const revisions = [
    ...new Set(
      (Array.isArray(projection?.sourceRevisions)
        ? projection.sourceRevisions
        : []
      )
        .map(normalizeRevision)
        .filter((revision) => revision !== null),
    ),
  ].sort((left, right) => left - right);
  return revisions.join("|");
}

function normalizeProjectionStatus(projection) {
  if (projection?.pending === true) return "pending";
  const status = String(projection?.status || "")
    .trim()
    .toLowerCase();
  return status === "complete" ? "current" : status || "current";
}

function escapeCsvCell(value, { text = false } = {}) {
  let normalized = value === null || value === undefined ? "" : String(value);
  if (text && /^[=+\-@]/.test(normalized)) normalized = `'${normalized}`;
  return `"${normalized.replace(/"/g, '""')}"`;
}

function requireDiamondRows(rows) {
  if (!Array.isArray(rows) || rows.length === 0) {
    throw new Error("Diamond stats export requires at least one row.");
  }
  if (rows.length > DIAMOND_STATS_EXPORT_MAX_ROWS) {
    throw new Error(
      `Diamond stats export is limited to ${DIAMOND_STATS_EXPORT_MAX_ROWS} rows.`,
    );
  }
  rows.forEach((row) => {
    if (!isRecord(row) || row?.presentation?.isDiamond !== true) {
      throw new Error(
        "Diamond stats export cannot mix legacy or unclassified stat rows.",
      );
    }
  });
  return rows;
}

/**
 * Builds a machine-readable CSV without converting omitted Diamond data into
 * zero. Every stat has an adjacent coverage column and every row carries its
 * projection provenance.
 */
export function buildDiamondStatsCsv({
  rows = [],
  statDefinitions = [],
  projection = {},
  visibility = "public",
} = {}) {
  const normalizedVisibility = visibility === "manager-internal" ? "manager-internal" : "public";
  const normalizedRows = requireDiamondRows(rows);
  normalizedRows.forEach((row) => {
    const rowVisibility = row?.presentation?.statVisibility === "manager-internal"
      ? "manager-internal"
      : "public";
    if (rowVisibility !== normalizedVisibility) {
      throw new Error("Diamond stats export cannot silently mix public and manager-internal rows.");
    }
  });
  const definitions = normalizeDefinitions(statDefinitions, normalizedVisibility);
  const headers = [
    ...FIXED_COLUMNS,
    ...definitions.flatMap(({ id }) => [id, `${id}__coverage`]),
  ];
  const csvRows = [
    headers.map((header) => escapeCsvCell(header, { text: true })).join(","),
  ];
  const authoritativeRevision = normalizeRevision(
    projection?.authoritativeRevision,
  );
  const projectionStatus = normalizeProjectionStatus(projection);

  normalizedRows.forEach((row) => {
    const identity = isRecord(row.identity) ? row.identity : {};
    const stats = isRecord(row.stats) ? row.stats : {};
    const presentation = row.presentation;
    const fixedValues = [
      normalizeText(row.recordType || identity.recordType || "player", 32),
      normalizedVisibility,
      normalizeText(identity.playerId, 128),
      normalizeText(identity.playerName || identity.name, 160),
      normalizeText(identity.playerNumber || identity.number, 32),
      normalizeText(identity.participationStatus, 40),
      normalizeText(identity.gameId, 128),
      normalizeText(identity.gameDate, 40),
      normalizeText(identity.opponent, 160),
      DIAMOND_TRACKING_ENGINE,
      normalizeProjectionStatus(
        presentation?.projection || {
          pending: presentation?.projectionPending === true,
          status: projectionStatus,
        },
      ),
      normalizeRevision(presentation?.projection?.authoritativeRevision) ??
        authoritativeRevision ??
        "",
      normalizeSourceRevision(row, projection),
    ];
    const statValues = definitions.flatMap((definition) => {
      const displayed = getCoverageAwareStatValue(
        presentation,
        stats,
        definition.id,
        definition,
      );
      const status = COVERAGE_STATUS_SET.has(displayed.status)
        ? displayed.status
        : "not_collected";
      return [
        displayed.available && status !== "not_collected"
          ? displayed.value
          : "",
        status,
      ];
    });
    csvRows.push(
      [
        ...fixedValues.map((value) => escapeCsvCell(value, { text: true })),
        ...statValues.map((value, index) =>
          escapeCsvCell(value, { text: index % 2 === 1 }),
        ),
      ].join(","),
    );
  });

  return `${csvRows.join("\r\n")}\r\n`;
}

export function getDiamondStatsExportFilename(
  value,
  fallback = "allplays-diamond-stats",
  visibility = "public",
) {
  const rawBase =
    normalizeText(value || fallback, 120)
      .replace(/[^a-z0-9._-]+/gi, "-")
      .replace(/^-+|-+$/g, "") || fallback;
  const extensionless = rawBase.toLowerCase().endsWith(".csv") ? rawBase.slice(0, -4) : rawBase;
  const suffix = visibility === "manager-internal" ? "manager-internal" : "public";
  const base = extensionless.toLowerCase().endsWith(`-${suffix}`)
    ? extensionless
    : `${extensionless}-${suffix}`;
  return `${base}.csv`;
}

export function downloadDiamondStatsCsv(
  filename,
  csvText,
  { documentRef = document, urlRef = URL, visibility = "public" } = {},
) {
  const csv = String(csvText || "");
  if (!csv.trim()) throw new Error("Diamond stats export is empty.");
  const url = urlRef.createObjectURL(
    new Blob([csv], { type: "text/csv;charset=utf-8" }),
  );
  const link = documentRef.createElement("a");
  link.href = url;
  link.download = getDiamondStatsExportFilename(filename, "allplays-diamond-stats", visibility);
  documentRef.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => urlRef.revokeObjectURL(url), 500);
}
