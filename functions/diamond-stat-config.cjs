"use strict";

const core = require("./diamond-scorebook-core.cjs");

const DIAMOND_STAT_CONFIG_SNAPSHOT_SCHEMA_VERSION = 2;
const MAX_DIAMOND_STAT_DEFINITIONS = 256;
const SHA256_PATTERN = /^sha256:[0-9a-f]{64}$/;
const SAFE_STAT_ID_PATTERN = /^[a-z0-9][a-z0-9_]{0,63}$/;
const BLOCKED_STAT_IDS = new Set(["__proto__", "constructor", "prototype"]);
const STAT_SCOPES = new Set(["player", "team"]);
const STAT_VISIBILITIES = new Set(["public", "private"]);
const SNAPSHOT_KEYS = new Set([
  "schemaVersion",
  "teamId",
  "configId",
  "definitionCount",
  "statDefinitions",
  "privatePlayerStatIds",
  "publicPlayerStatIds",
  "publicTeamStatIds",
  "snapshotHash",
]);

class DiamondStatConfigError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "DiamondStatConfigError";
    this.code = code;
  }
}

function isPlainObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function exactId(value, label) {
  try {
    return core.normalizeDiamondId(value, label);
  } catch (error) {
    throw new DiamondStatConfigError(
      "stat-config-id-invalid",
      error?.message || `${label} is invalid.`,
    );
  }
}

function exactStatId(value, index) {
  if (
    typeof value !== "string" ||
    value !== value.trim() ||
    !SAFE_STAT_ID_PATTERN.test(value) ||
    BLOCKED_STAT_IDS.has(value)
  ) {
    throw new DiamondStatConfigError(
      "stat-config-malformed",
      `Stat definition ${String(index + 1)} must have an exact, safe id.`,
    );
  }
  return value;
}

function canonicalStatIdList(values, label) {
  if (!Array.isArray(values) || values.length > MAX_DIAMOND_STAT_DEFINITIONS) {
    throw new DiamondStatConfigError(
      "stat-config-malformed",
      `${label} must be a bounded array.`,
    );
  }
  const ids = values.map((value, index) => {
    if (
      typeof value !== "string" ||
      value !== value.trim() ||
      !SAFE_STAT_ID_PATTERN.test(value) ||
      BLOCKED_STAT_IDS.has(value)
    ) {
      throw new DiamondStatConfigError(
        "stat-config-malformed",
        `${label} entry ${String(index + 1)} must be an exact, safe stat id.`,
      );
    }
    return value;
  });
  if (new Set(ids).size !== ids.length) {
    throw new DiamondStatConfigError(
      "stat-config-malformed",
      `${label} cannot contain duplicate stat ids.`,
    );
  }
  return ids.sort();
}

function canonicalDefinitions(config) {
  if (!isPlainObject(config) || !Array.isArray(config.statDefinitions)) {
    throw new DiamondStatConfigError(
      "stat-config-malformed",
      "The selected stat config must contain a statDefinitions array.",
    );
  }
  if (config.statDefinitions.length > MAX_DIAMOND_STAT_DEFINITIONS) {
    throw new DiamondStatConfigError(
      "stat-config-too-large",
      `The selected stat config exceeds ${String(MAX_DIAMOND_STAT_DEFINITIONS)} definitions.`,
    );
  }
  const seen = new Set();
  const definitions = Array.from(
    config.statDefinitions,
    (definition, index) => {
      if (!isPlainObject(definition)) {
        throw new DiamondStatConfigError(
          "stat-config-malformed",
          `Stat definition ${String(index + 1)} must be an object.`,
        );
      }
      const id = exactStatId(definition.id, index);
      if (seen.has(id)) {
        throw new DiamondStatConfigError(
          "stat-config-duplicate-definition",
          `Stat definition id ${id} is duplicated.`,
        );
      }
      seen.add(id);
      if (!STAT_SCOPES.has(definition.scope)) {
        throw new DiamondStatConfigError(
          "stat-config-malformed",
          `Stat definition ${id} must explicitly use player or team scope.`,
        );
      }
      if (!STAT_VISIBILITIES.has(definition.visibility)) {
        throw new DiamondStatConfigError(
          "stat-config-malformed",
          `Stat definition ${id} must explicitly use public or private visibility.`,
        );
      }
      return {
        id,
        scope: definition.scope,
        visibility: definition.visibility,
      };
    },
  );
  return definitions.sort((left, right) =>
    left.id < right.id ? -1 : left.id > right.id ? 1 : 0,
  );
}

function unsignedSnapshot({
  teamId,
  configId,
  statDefinitions,
  explicitPublicTeamStatIds = [],
}) {
  const privatePlayerStatIds = statDefinitions
    .filter(
      (definition) =>
        definition.scope === "player" && definition.visibility === "private",
    )
    .map((definition) => definition.id);
  const publicPlayerStatIds = statDefinitions
    .filter(
      (definition) =>
        definition.scope === "player" && definition.visibility === "public",
    )
    .map((definition) => definition.id);
  const publicTeamStatIds = [
    ...new Set([
      ...statDefinitions
        .filter(
          (definition) =>
            definition.scope === "team" && definition.visibility === "public",
        )
        .map((definition) => definition.id),
      ...explicitPublicTeamStatIds,
    ]),
  ].sort();
  return {
    schemaVersion: DIAMOND_STAT_CONFIG_SNAPSHOT_SCHEMA_VERSION,
    teamId,
    configId,
    definitionCount: statDefinitions.length,
    statDefinitions,
    privatePlayerStatIds,
    publicPlayerStatIds,
    publicTeamStatIds,
  };
}

function requireHashValue(hashValue) {
  if (typeof hashValue !== "function") {
    throw new TypeError("A canonical Diamond hash function is required.");
  }
  return hashValue;
}

function canonicalSnapshotHash(unsigned, hashValue) {
  let hash;
  try {
    hash = requireHashValue(hashValue)(unsigned);
  } catch (error) {
    if (error instanceof TypeError) throw error;
    throw new DiamondStatConfigError(
      "stat-config-hash-failed",
      "The Diamond stat config snapshot could not be hashed canonically.",
    );
  }
  if (!SHA256_PATTERN.test(hash || "")) {
    throw new DiamondStatConfigError(
      "stat-config-hash-invalid",
      "The Diamond stat config snapshot hash is invalid.",
    );
  }
  return hash;
}

function createDiamondStatConfigSnapshot(
  { teamId: rawTeamId, configId: rawConfigId, config },
  { hashValue = core.hashDiamondValue } = {},
) {
  const teamId = exactId(rawTeamId, "teamId");
  const configId = exactId(rawConfigId, "statTrackerConfigId");
  const statDefinitions = canonicalDefinitions(config);
  const explicitPublicTeamStatIds = canonicalStatIdList(
    config.diamondPublicTeamStatIds ?? [],
    "diamondPublicTeamStatIds",
  );
  const unsigned = unsignedSnapshot({
    teamId,
    configId,
    statDefinitions,
    explicitPublicTeamStatIds,
  });
  return Object.freeze({
    ...unsigned,
    statDefinitions: Object.freeze(
      unsigned.statDefinitions.map((definition) => Object.freeze(definition)),
    ),
    privatePlayerStatIds: Object.freeze([...unsigned.privatePlayerStatIds]),
    publicPlayerStatIds: Object.freeze([...unsigned.publicPlayerStatIds]),
    publicTeamStatIds: Object.freeze([...unsigned.publicTeamStatIds]),
    snapshotHash: canonicalSnapshotHash(unsigned, hashValue),
  });
}

function validateDiamondStatConfigSnapshot(
  snapshot,
  {
    teamId: expectedTeamId,
    configId: expectedConfigId,
    hashValue = core.hashDiamondValue,
  } = {},
) {
  if (!isPlainObject(snapshot)) {
    throw new DiamondStatConfigError(
      "stat-config-snapshot-missing",
      "The Diamond stat config snapshot is missing.",
    );
  }
  if (
    Object.keys(snapshot).some((key) => !SNAPSHOT_KEYS.has(key)) ||
    snapshot.schemaVersion !== DIAMOND_STAT_CONFIG_SNAPSHOT_SCHEMA_VERSION
  ) {
    throw new DiamondStatConfigError(
      "stat-config-snapshot-malformed",
      "The Diamond stat config snapshot schema is not recognized.",
    );
  }
  const teamId = exactId(snapshot.teamId, "statConfigSnapshot.teamId");
  const configId = exactId(snapshot.configId, "statConfigSnapshot.configId");
  if (
    (expectedTeamId !== undefined &&
      teamId !== exactId(expectedTeamId, "teamId")) ||
    (expectedConfigId !== undefined &&
      configId !== exactId(expectedConfigId, "statTrackerConfigId"))
  ) {
    throw new DiamondStatConfigError(
      "stat-config-snapshot-mismatch",
      "The Diamond stat config snapshot does not match this game.",
    );
  }
  const statDefinitions = canonicalDefinitions({
    statDefinitions: snapshot.statDefinitions,
  });
  const unsigned = unsignedSnapshot({
    teamId,
    configId,
    statDefinitions,
    explicitPublicTeamStatIds: canonicalStatIdList(
      snapshot.publicTeamStatIds,
      "statConfigSnapshot.publicTeamStatIds",
    ),
  });
  let integrityValid = false;
  try {
    integrityValid =
      snapshot.definitionCount === unsigned.definitionCount &&
      Array.isArray(snapshot.privatePlayerStatIds) &&
      Array.isArray(snapshot.publicPlayerStatIds) &&
      Array.isArray(snapshot.publicTeamStatIds) &&
      core.canonicalDiamondJson(snapshot.statDefinitions) ===
        core.canonicalDiamondJson(unsigned.statDefinitions) &&
      core.canonicalDiamondJson(snapshot.privatePlayerStatIds) ===
        core.canonicalDiamondJson(unsigned.privatePlayerStatIds) &&
      core.canonicalDiamondJson(snapshot.publicPlayerStatIds) ===
        core.canonicalDiamondJson(unsigned.publicPlayerStatIds) &&
      core.canonicalDiamondJson(snapshot.publicTeamStatIds) ===
        core.canonicalDiamondJson(unsigned.publicTeamStatIds) &&
      snapshot.snapshotHash === canonicalSnapshotHash(unsigned, hashValue);
  } catch (error) {
    if (error instanceof TypeError) throw error;
    integrityValid = false;
  }
  if (!integrityValid) {
    throw new DiamondStatConfigError(
      "stat-config-snapshot-integrity",
      "The Diamond stat config snapshot failed its canonical integrity check.",
    );
  }
  return Object.freeze({
    ...unsigned,
    statDefinitions: Object.freeze(
      unsigned.statDefinitions.map((definition) => Object.freeze(definition)),
    ),
    privatePlayerStatIds: Object.freeze([...unsigned.privatePlayerStatIds]),
    publicPlayerStatIds: Object.freeze([...unsigned.publicPlayerStatIds]),
    publicTeamStatIds: Object.freeze([...unsigned.publicTeamStatIds]),
    snapshotHash: snapshot.snapshotHash,
  });
}

module.exports = {
  DIAMOND_STAT_CONFIG_SNAPSHOT_SCHEMA_VERSION,
  DiamondStatConfigError,
  MAX_DIAMOND_STAT_DEFINITIONS,
  createDiamondStatConfigSnapshot,
  validateDiamondStatConfigSnapshot,
};
