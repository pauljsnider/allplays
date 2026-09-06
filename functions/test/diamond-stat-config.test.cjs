"use strict";

const assert = require("node:assert/strict");
const { describe, it } = require("node:test");

const core = require("../diamond-scorebook-core.cjs");
const {
  MAX_DIAMOND_STAT_DEFINITIONS,
  createDiamondStatConfigSnapshot,
  validateDiamondStatConfigSnapshot,
} = require("../diamond-stat-config.cjs");

function definition(id, scope = "player", visibility = "public") {
  return { id, label: id.toUpperCase(), scope, visibility, ignored: true };
}

describe("Diamond stat config snapshots", () => {
  it("creates a deterministic minimal snapshot with explicit sorted visibility allowlists", () => {
    const input = {
      teamId: "team-1",
      configId: "baseball-full",
      config: {
        name: "Baseball Full",
        diamondPublicTeamStatIds: ["lob"],
        statDefinitions: [
          definition("hr", "player", "private"),
          definition("r", "team", "private"),
          definition("avg", "player", "private"),
          definition("ab"),
        ],
      },
    };
    const snapshot = createDiamondStatConfigSnapshot(input);
    assert.deepEqual(snapshot.statDefinitions, [
      { id: "ab", scope: "player", visibility: "public" },
      { id: "avg", scope: "player", visibility: "private" },
      { id: "hr", scope: "player", visibility: "private" },
      { id: "r", scope: "team", visibility: "private" },
    ]);
    assert.deepEqual(snapshot.privatePlayerStatIds, ["avg", "hr"]);
    assert.deepEqual(snapshot.publicPlayerStatIds, ["ab"]);
    assert.deepEqual(snapshot.publicTeamStatIds, ["lob"]);
    assert.equal(snapshot.definitionCount, 4);
    assert.match(snapshot.snapshotHash, /^sha256:[0-9a-f]{64}$/);

    const reordered = createDiamondStatConfigSnapshot({
      ...input,
      config: {
        ...input.config,
        statDefinitions: [...input.config.statDefinitions].reverse(),
      },
    });
    assert.equal(reordered.snapshotHash, snapshot.snapshotHash);
    assert.deepEqual(
      validateDiamondStatConfigSnapshot(snapshot, {
        teamId: "team-1",
        configId: "baseball-full",
      }),
      snapshot,
    );
  });

  it("accepts exactly 256 unique definitions and rejects an overflow", () => {
    const definitions = Array.from(
      { length: MAX_DIAMOND_STAT_DEFINITIONS },
      (_, index) => definition(`stat_${String(index)}`),
    );
    assert.equal(
      createDiamondStatConfigSnapshot({
        teamId: "team-1",
        configId: "bounded",
        config: { statDefinitions: definitions },
      }).definitionCount,
      MAX_DIAMOND_STAT_DEFINITIONS,
    );
    assert.throws(
      () =>
        createDiamondStatConfigSnapshot({
          teamId: "team-1",
          configId: "overflow",
          config: {
            statDefinitions: [
              ...definitions,
              definition(`stat_${String(MAX_DIAMOND_STAT_DEFINITIONS)}`),
            ],
          },
        }),
      (error) => error.code === "stat-config-too-large",
    );
  });

  it("requires safe unique IDs and explicit exact scope and visibility", () => {
    const invalidDefinitions = [
      [definition("HR"), "stat-config-malformed"],
      [
        { id: "hr", scope: " player", visibility: "public" },
        "stat-config-malformed",
      ],
      [
        { id: "hr", scope: "player", visibility: "Public" },
        "stat-config-malformed",
      ],
      [{ id: "hr", scope: "player" }, "stat-config-malformed"],
      [
        { id: "constructor", scope: "player", visibility: "public" },
        "stat-config-malformed",
      ],
    ];
    for (const [candidate, code] of invalidDefinitions) {
      assert.throws(
        () =>
          createDiamondStatConfigSnapshot({
            teamId: "team-1",
            configId: "invalid",
            config: { statDefinitions: [candidate] },
          }),
        (error) => error.code === code,
      );
    }
    assert.throws(
      () =>
        createDiamondStatConfigSnapshot({
          teamId: "team-1",
          configId: "duplicate",
          config: { statDefinitions: [definition("hr"), definition("hr")] },
        }),
      (error) => error.code === "stat-config-duplicate-definition",
    );
  });

  it("rejects missing definitions, unsafe config IDs, and malformed documents", () => {
    for (const input of [null, {}, { statDefinitions: null }]) {
      assert.throws(
        () =>
          createDiamondStatConfigSnapshot({
            teamId: "team-1",
            configId: "invalid",
            config: input,
          }),
        (error) => error.code === "stat-config-malformed",
      );
    }
    assert.throws(
      () =>
        createDiamondStatConfigSnapshot({
          teamId: "team-1",
          configId: " bad/config ",
          config: { statDefinitions: [] },
        }),
      (error) => error.code === "stat-config-id-invalid",
    );
    const sparse = [];
    sparse.length = 1;
    assert.throws(
      () =>
        createDiamondStatConfigSnapshot({
          teamId: "team-1",
          configId: "sparse",
          config: { statDefinitions: sparse },
        }),
      (error) => error.code === "stat-config-malformed",
    );
    assert.throws(
      () =>
        createDiamondStatConfigSnapshot(
          {
            teamId: "team-1",
            configId: "invalid-hash",
            config: { statDefinitions: [] },
          },
          { hashValue: () => "not-a-canonical-hash" },
        ),
      (error) => error.code === "stat-config-hash-invalid",
    );
  });

  it("fails validation for identity, canonical-order, derived-list, or hash tampering", () => {
    const snapshot = createDiamondStatConfigSnapshot({
      teamId: "team-1",
      configId: "baseball-full",
      config: {
        statDefinitions: [
          definition("avg", "player", "private"),
          definition("hr"),
        ],
      },
    });
    const mutations = [
      { ...snapshot, teamId: "team-2" },
      {
        ...snapshot,
        statDefinitions: [...snapshot.statDefinitions].reverse(),
      },
      { ...snapshot, privatePlayerStatIds: [] },
      { ...snapshot, publicPlayerStatIds: [] },
      { ...snapshot, publicTeamStatIds: ["hr"] },
      { ...snapshot, definitionCount: 1 },
      { ...snapshot, snapshotHash: core.hashDiamondValue({ forged: true }) },
      { ...snapshot, unexpected: true },
    ];
    for (const candidate of mutations) {
      assert.throws(
        () =>
          validateDiamondStatConfigSnapshot(candidate, {
            teamId: "team-1",
            configId: "baseball-full",
          }),
        (error) => error.code.startsWith("stat-config-"),
      );
    }
    assert.throws(
      () =>
        validateDiamondStatConfigSnapshot(snapshot, {
          teamId: "team-1",
          configId: "another-config",
        }),
      (error) => error.code === "stat-config-snapshot-mismatch",
    );
  });
});
