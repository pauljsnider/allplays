import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";
import { hashDiamondValue as clientHashDiamondValue } from "../../apps/app/src/lib/diamondScorebook/canonical.ts";

const require = createRequire(import.meta.url);
const {
  DIAMOND_COMMAND_TYPES,
  DIAMOND_ENGINE,
  canonicalDiamondJson,
  hashDiamondCommand,
  parseDiamondPolicy,
  getDiamondPolicyDecision,
  findMeaningfulLegacyTrackingData,
  hasMeaningfulLegacyTrackingData,
  evaluateDiamondActivationEligibility,
  decideDiamondEngineClaim,
  decideDiamondCommandIdempotency,
  decideDiamondExpectedRevision,
  decideDiamondLifecycle,
  normalizeDiamondCommand,
  normalizeDiamondPayload,
  decideDiamondScorerLease,
  sanitizeDiamondPublicProjection,
  sanitizeDiamondPrivateProjection,
  sanitizeDiamondPublicEvent,
  buildDiamondEventPage,
  validateDiamondVoiceProposal,
  decideDiamondNotification,
  decideDiamondOperation,
  decideDiamondDeletionCleanup,
} = require("../../functions/diamond-scorebook-core.cjs");

const commandId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const secondCommandId = "bbbbbbbb-bbbb-4bbb-9bbb-bbbbbbbbbbbb";

function policy(overrides = {}) {
  return {
    mode: "enabled",
    revision: 1,
    teamIds: [],
    ...overrides,
  };
}

function optIn(overrides = {}) {
  return {
    enabled: true,
    sport: "baseball",
    rulesProfileId: "youth-baseball",
    rulesProfileVersion: 1,
    captureMode: "quick",
    ...overrides,
  };
}

function team(overrides = {}) {
  return {
    id: "team-1",
    name: "Falcons",
    sport: "Baseball",
    active: true,
    ...overrides,
  };
}

function game(overrides = {}) {
  return {
    id: "game-1",
    teamId: "team-1",
    type: "game",
    sport: "baseball",
    status: "scheduled",
    homeScore: 0,
    awayScore: 0,
    ...overrides,
  };
}

function command(overrides = {}) {
  return {
    schemaVersion: 2,
    commandId,
    teamId: "team-1",
    gameId: "game-1",
    expectedRevision: 3,
    rulesProfileId: "youth-baseball",
    rulesProfileVersion: 1,
    type: "record_pitch",
    payload: {
      pitcherId: "pitcher-1",
      batterId: "batter-1",
      result: "called_strike",
    },
    ...overrides,
  };
}

function lease(overrides = {}) {
  return {
    holderUid: "scorer-1",
    leaseId: "lease-1",
    expiresAtMillis: 20_000,
    epoch: 2,
    ...overrides,
  };
}

describe("Diamond policy and rollout boundary", () => {
  it("parses the same bounded policy shape enforced by Firestore rules", () => {
    expect(
      parseDiamondPolicy(
        policy({
          mode: "pilot",
          revision: 7,
          teamIds: ["team-1"],
          minimumAppBuild: 104,
          updatedAt: { millis: 1_000 },
          updatedBy: "admin:one",
          rolloutNote: "Internal pilot",
        }),
      ),
    ).toMatchObject({
      valid: true,
      mode: "pilot",
      revision: 7,
      teamIds: ["team-1"],
      minimumAppBuild: 104,
      activationEnabled: true,
      scoringEnabled: true,
    });
  });

  it.each([
    ["missing", null, {}, "policy-missing"],
    ["unreadable", policy(), { readStatus: "error" }, "policy-unreadable"],
    ["partial", policy(), { readStatus: "partial" }, "policy-unreadable"],
    ["unknown mode", policy({ mode: "gradual" }), {}, "policy-malformed"],
    [
      "missing revision",
      { mode: "enabled", teamIds: [] },
      {},
      "policy-malformed",
    ],
    [
      "invalid team id",
      policy({ teamIds: ["bad/team"] }),
      {},
      "policy-malformed",
    ],
    [
      "duplicate team id",
      policy({ teamIds: ["team-1", "team-1"] }),
      {},
      "policy-malformed",
    ],
    [
      "bad timestamp",
      policy({ updatedAt: "yesterday" }),
      {},
      "policy-malformed",
    ],
    ["null timestamp", policy({ updatedAt: null }), {}, "policy-malformed"],
    ["null updater", policy({ updatedBy: null }), {}, "policy-malformed"],
    ["unknown field", policy({ scoringEnabled: true }), {}, "policy-malformed"],
  ])("fails closed for a %s policy", (_label, input, options, reason) => {
    expect(parseDiamondPolicy(input, options)).toMatchObject({
      valid: false,
      mode: "disabled",
      reason,
      activationEnabled: false,
      scoringEnabled: false,
    });
  });

  it("applies cohort and minimum-build gates without broadening internal or pilot modes", () => {
    const parsed = parseDiamondPolicy(
      policy({
        mode: "pilot",
        revision: 8,
        teamIds: ["team-1"],
        minimumAppBuild: 104,
      }),
    );

    expect(
      getDiamondPolicyDecision({
        policy: parsed,
        teamId: "team-1",
        appBuild: 104,
      }),
    ).toMatchObject({
      allowed: true,
      policyRevision: 8,
    });
    expect(
      getDiamondPolicyDecision({
        policy: parsed,
        teamId: "team-2",
        appBuild: 104,
      }),
    ).toMatchObject({
      allowed: false,
      code: "team-not-in-rollout",
    });
    expect(
      getDiamondPolicyDecision({
        policy: parsed,
        teamId: "team-1",
        appBuild: 103,
      }),
    ).toMatchObject({
      allowed: false,
      code: "minimum-app-build",
    });
    expect(
      getDiamondPolicyDecision({
        policy: parseDiamondPolicy(policy({ mode: "disabled" })),
        teamId: "team-1",
      }),
    ).toMatchObject({
      allowed: false,
      code: "policy-disabled",
    });
  });
});

describe("Diamond team, game, and engine ownership eligibility", () => {
  function eligibility(overrides = {}) {
    return evaluateDiamondActivationEligibility({
      policy: parseDiamondPolicy(policy()),
      team: team(),
      game: game(),
      teamOptIn: optIn(),
      teamId: "team-1",
      gameId: "game-1",
      appBuild: 104,
      ...overrides,
    });
  }

  it("allows only a new opted-in diamond-sport game with no legacy state", () => {
    expect(eligibility()).toMatchObject({
      allowed: true,
      eligible: true,
      alreadyActivated: false,
      sport: "baseball",
      rulesProfileId: "youth-baseball",
    });
    expect(hasMeaningfulLegacyTrackingData(game())).toBe(false);
  });

  it.each([
    ["inactive team", { team: team({ active: false }) }, "inactive-team"],
    ["archived team", { team: team({ status: "archived" }) }, "inactive-team"],
    [
      "non-diamond sport",
      { team: team({ sport: "soccer" }) },
      "unsupported-sport",
    ],
    [
      "cross-sport game",
      { game: game({ sport: "softball" }) },
      "cross-sport-game",
    ],
    [
      "cross-team game",
      { game: game({ teamId: "team-2" }) },
      "cross-team-game",
    ],
    ["practice", { game: game({ type: "practice" }) }, "not-a-game"],
    [
      "cancelled game",
      { game: game({ status: "cancelled" }) },
      "ineligible-game-status",
    ],
    ["not opted in", { teamOptIn: { enabled: false } }, "team-not-opted-in"],
    [
      "mismatched profile sport",
      { teamOptIn: optIn({ sport: "fastpitch" }) },
      "rules-sport-mismatch",
    ],
    [
      "malformed capture mode",
      { teamOptIn: optIn({ captureMode: "automatic" }) },
      "team-opt-in-malformed",
    ],
    [
      "legacy engine",
      { game: game({ trackingEngine: "legacy-v1" }) },
      "legacy-game",
    ],
    [
      "unknown engine",
      { game: game({ trackingEngine: "diamond-v3" }) },
      "unknown-tracking-engine",
    ],
    [
      "wrong-case engine",
      { game: game({ trackingEngine: "Diamond-v2" }) },
      "unknown-tracking-engine",
    ],
    [
      "legacy event",
      { game: game({ events: [{ id: "event-1" }] }) },
      "legacy-data-present",
    ],
    [
      "legacy aggregate",
      { game: game({ opponentStats: { hits: 1 } }) },
      "legacy-data-present",
    ],
    [
      "legacy final zero-score",
      { game: game({ status: "completed" }) },
      "legacy-data-present",
    ],
    [
      "legacy inning label",
      { game: game({ currentPeriod: "Top 1" }) },
      "legacy-data-present",
    ],
    [
      "malformed legacy score",
      { game: game({ homeScore: "three" }) },
      "legacy-data-present",
    ],
    [
      "legacy live state",
      { game: game({ liveBaseballState: { inning: 1 } }) },
      "legacy-data-present",
    ],
  ])("rejects a %s", (_label, overrides, code) => {
    expect(eligibility(overrides)).toMatchObject({
      allowed: false,
      eligible: false,
      code,
    });
  });

  it("treats a canonical Diamond game as an idempotent activation target", () => {
    expect(
      eligibility({
        game: game({
          trackingEngine: "diamond-v2",
          status: "live",
          homeScore: 5,
          events: [{ id: "diamond-event" }],
        }),
      }),
    ).toMatchObject({
      allowed: true,
      eligible: true,
      alreadyActivated: true,
    });
  });

  it("reports the concrete legacy evidence used to keep old games passive", () => {
    expect(
      findMeaningfulLegacyTrackingData(
        game({
          homeScore: 3,
          liveStatus: "live",
          gameLog: ["single"],
          trackingStartedAt: 123,
        }),
      ),
    ).toEqual(
      expect.arrayContaining([
        "tracked-live-status",
        "gameLog",
        "nonzero-score",
        "tracked-lifecycle-marker",
      ]),
    );
  });

  it("claims only after a verified activation and a final legacy-data recheck", () => {
    const eligible = eligibility();
    expect(
      decideDiamondEngineClaim({ game: game(), eligibility: eligible }),
    ).toMatchObject({
      allowed: false,
      code: "activation-not-verified",
    });
    expect(
      decideDiamondEngineClaim({
        game: game({ plays: [{ id: "late-legacy-play" }] }),
        eligibility: eligible,
        activationVerified: true,
      }),
    ).toMatchObject({ allowed: false, code: "legacy-data-present" });
    expect(
      decideDiamondEngineClaim({
        game: game(),
        eligibility: eligible,
        activationVerified: true,
      }),
    ).toEqual(
      expect.objectContaining({
        allowed: true,
        action: "claim",
        trackingEngine: DIAMOND_ENGINE,
        update: expect.objectContaining({
          trackingEngine: DIAMOND_ENGINE,
          trackingEngineRevision: 1,
          diamondProjectionRevision: 0,
        }),
      }),
    );
    expect(
      decideDiamondEngineClaim({
        game: game({ trackingEngine: DIAMOND_ENGINE }),
        eligibility: eligible,
        activationVerified: true,
      }),
    ).toMatchObject({ allowed: true, action: "none", code: "already-claimed" });
  });
});

describe("Diamond command validation, hashing, idempotency, and revisions", () => {
  it("shares exact underscore command values with the app/domain contract", () => {
    expect(DIAMOND_COMMAND_TYPES).toEqual([
      "activate",
      "set_lineup",
      "set_defensive_alignment",
      "set_dp_flex",
      "start",
      "record_pitch",
      "record_plate_appearance",
      "advance_runner",
      "record_fielding",
      "record_scoring_judgment",
      "advance_half_inning",
      "place_tiebreaker_runner",
      "substitute",
      "re_enter",
      "add_courtesy_runner",
      "scorer_handoff",
      "private_note",
      "suspend",
      "resume",
      "rules_decision",
      "void_event",
      "supersede_event",
      "reopen_for_correction",
      "finalize",
    ]);
  });

  it("normalizes a bounded command and rejects client-authored envelope state", () => {
    expect(normalizeDiamondCommand(command())).toEqual(command());
    expect(() =>
      normalizeDiamondCommand(command({ actorUid: "spoofed" })),
    ).toThrow(/unsupported envelope fields/i);
    expect(() =>
      normalizeDiamondCommand(command({ commandId: "not-random" })),
    ).toThrow(/UUID v4/i);
    expect(() =>
      normalizeDiamondCommand(command({ type: "home_run" })),
    ).toThrow(/unsupported/i);
    expect(() =>
      normalizeDiamondCommand(command({ teamId: " bad-team " })),
    ).toThrow(/teamId/i);
    expect(() =>
      normalizeDiamondCommand(
        command({
          payload: {
            pitcherId: "pitcher-1",
            batterId: "batter-1",
            result: "ball",
            actorUid: "spoofed",
          },
        }),
      ),
    ).toThrow(/unsupported payload fields/i);
  });

  it("enforces payload shape, finite values, depth, array, string, and prototype boundaries", () => {
    const cyclic = {};
    cyclic.self = cyclic;
    expect(() => normalizeDiamondPayload(cyclic)).toThrow(/cyclic/i);
    expect(() => normalizeDiamondPayload({ number: Number.NaN })).toThrow(
      /finite/i,
    );
    expect(() =>
      normalizeDiamondPayload({ list: Array.from({ length: 101 }, () => 1) }),
    ).toThrow(/oversized array/i);
    expect(() => normalizeDiamondPayload({ text: "x".repeat(4_001) })).toThrow(
      /overlong string/i,
    );
    expect(() => normalizeDiamondPayload({ value: undefined })).toThrow(
      /plain JSON/i,
    );
    const polluted = {};
    Object.defineProperty(polluted, "__proto__", {
      enumerable: true,
      value: { admin: true },
    });
    expect(() => normalizeDiamondPayload(polluted)).toThrow(
      /invalid object key/i,
    );
  });

  it("requires explicit confirmation and prevents raw audio from entering official commands", () => {
    expect(() =>
      normalizeDiamondCommand(
        command({ type: "finalize", payload: { confirmed: false } }),
      ),
    ).toThrow(/confirmation/i);
    expect(() =>
      normalizeDiamondCommand(
        command({
          type: "private_note",
          payload: {
            text: "Pitching note",
            audioUrl: "https://private.example/audio",
          },
        }),
      ),
    ).toThrow(/unsupported payload fields|raw audio/i);
    expect(() =>
      normalizeDiamondCommand(
        command({
          type: "private_note",
          payload: {
            text: "Pitching note",
            visibility: { recording: "bytes" },
          },
        }),
      ),
    ).toThrow(/raw audio/i);
    expect(() =>
      normalizeDiamondCommand(
        command({
          type: "private_note",
          payload: { text: "x".repeat(2_001) },
        }),
      ),
    ).toThrow(/2,000/i);
    expect(
      normalizeDiamondCommand(
        command({
          type: "private_note",
          payload: { text: "Pitching note", attachedEventId: "event-1" },
        }),
      ).payload,
    ).toEqual({ text: "Pitching note", attachedEventId: "event-1" });
    expect(() =>
      normalizeDiamondCommand(
        command({
          type: "set_lineup",
          payload: {
            side: "home",
            entries: [
              {
                slot: 1,
                playerId: "player-1",
                displayName: "Maya",
                parentEmail: "private@example.com",
              },
            ],
          },
        }),
      ),
    ).toThrow(/private contact data/i);
  });

  it("canonicalizes keys and hashes commands exactly like the shared browser/native core", () => {
    const reordered = command({
      payload: {
        result: "called_strike",
        batterId: "batter-1",
        pitcherId: "pitcher-1",
      },
    });
    expect(canonicalDiamondJson({ z: 1, a: { y: -0, x: true } })).toBe(
      '{"a":{"x":true,"y":0},"z":1}',
    );
    expect(hashDiamondCommand(command())).toBe(hashDiamondCommand(reordered));
    expect(hashDiamondCommand(command())).toBe(
      clientHashDiamondValue(command()),
    );
    expect(
      hashDiamondCommand(command({ commandId: secondCommandId })),
    ).not.toBe(hashDiamondCommand(command()));
  });

  it("returns an exact duplicate result but rejects command ID reuse with different details", () => {
    const incomingHash = hashDiamondCommand(command());
    const stored = {
      commandHash: incomingHash,
      result: {
        outcome: "accepted",
        revision: 4,
        eventId: "event-4",
        state: { revision: 4 },
      },
    };
    expect(
      decideDiamondCommandIdempotency({ existingCommand: null, incomingHash }),
    ).toMatchObject({
      allowed: true,
      action: "append",
    });
    expect(
      decideDiamondCommandIdempotency({
        existingCommand: stored,
        incomingHash,
      }),
    ).toMatchObject({
      allowed: true,
      action: "return-existing",
      outcome: "duplicate",
      result: stored.result,
    });
    expect(
      decideDiamondCommandIdempotency({
        existingCommand: stored,
        incomingHash: hashDiamondCommand(
          command({
            payload: {
              pitcherId: "pitcher-1",
              batterId: "batter-1",
              result: "ball",
            },
          }),
        ),
      }),
    ).toMatchObject({
      allowed: false,
      code: "idempotency-conflict",
      action: "reject",
    });
  });

  it("never treats incomplete or malformed command-receipt evidence as a new command", () => {
    const incomingHash = hashDiamondCommand(command());
    expect(
      decideDiamondCommandIdempotency({
        existingCommand: null,
        incomingHash,
        readStatus: "partial",
      }),
    ).toMatchObject({
      allowed: false,
      code: "idempotency-read-incomplete",
      retryable: true,
      action: "retry",
    });
    expect(
      decideDiamondCommandIdempotency({
        existingCommand: { commandHash: incomingHash, result: {} },
        incomingHash,
      }),
    ).toMatchObject({ allowed: false, code: "command-record-invalid" });
  });

  it("separates current, stale, future, and malformed revisions", () => {
    expect(
      decideDiamondExpectedRevision({
        expectedRevision: 7,
        currentRevision: 7,
      }),
    ).toMatchObject({
      allowed: true,
      authoritativeRevision: 7,
    });
    expect(
      decideDiamondExpectedRevision({
        expectedRevision: 6,
        currentRevision: 7,
      }),
    ).toMatchObject({
      allowed: false,
      code: "stale-revision",
      retryable: true,
      authoritativeRevision: 7,
    });
    expect(
      decideDiamondExpectedRevision({
        expectedRevision: 8,
        currentRevision: 7,
      }),
    ).toMatchObject({
      allowed: false,
      code: "future-revision",
      retryable: false,
    });
    expect(
      decideDiamondExpectedRevision({
        expectedRevision: "7",
        currentRevision: 7,
      }),
    ).toMatchObject({
      allowed: false,
      code: "invalid-revision",
    });
  });
});

describe("Diamond lifecycle and scorer lease decisions", () => {
  it("keeps lifecycle transitions explicit and rejects alternate paths", () => {
    expect(
      decideDiamondLifecycle({
        lifecycle: "configured",
        commandType: "activate",
      }),
    ).toMatchObject({ allowed: true });
    expect(
      decideDiamondLifecycle({ lifecycle: "ready", commandType: "start" }),
    ).toMatchObject({ allowed: true });
    expect(
      decideDiamondLifecycle({
        lifecycle: "active",
        commandType: "record_plate_appearance",
      }),
    ).toMatchObject({ allowed: true });
    expect(
      decideDiamondLifecycle({ lifecycle: "suspended", commandType: "resume" }),
    ).toMatchObject({ allowed: true });
    expect(
      decideDiamondLifecycle({
        lifecycle: "final",
        commandType: "reopen_for_correction",
      }),
    ).toMatchObject({ allowed: true });
    expect(
      decideDiamondLifecycle({
        lifecycle: "correction",
        commandType: "void_event",
      }),
    ).toMatchObject({ allowed: true });
    expect(
      decideDiamondLifecycle({
        lifecycle: "final",
        commandType: "record_pitch",
      }),
    ).toMatchObject({
      allowed: false,
      code: "lifecycle-conflict",
    });
    expect(
      decideDiamondLifecycle({
        lifecycle: "mystery",
        commandType: "record_pitch",
      }),
    ).toMatchObject({
      allowed: false,
      code: "invalid-lifecycle",
    });
  });

  it("requires the current holder and exact lease token for normal scoring", () => {
    expect(
      decideDiamondScorerLease({
        operation: "score",
        lease: lease(),
        actorUid: "scorer-1",
        presentedLeaseId: "lease-1",
        nowMillis: 10_000,
      }),
    ).toMatchObject({ allowed: true, code: "lease-current" });
    expect(
      decideDiamondScorerLease({
        operation: "score",
        lease: lease(),
        actorUid: "scorer-2",
        presentedLeaseId: "lease-1",
        nowMillis: 10_000,
      }),
    ).toMatchObject({
      allowed: false,
      code: "lease-held-by-other",
      retryable: true,
    });
    expect(
      decideDiamondScorerLease({
        operation: "score",
        lease: lease(),
        actorUid: "scorer-1",
        presentedLeaseId: "stale-lease",
        nowMillis: 10_000,
      }),
    ).toMatchObject({
      allowed: false,
      code: "lease-token-mismatch",
      retryable: true,
    });
    expect(
      decideDiamondScorerLease({
        operation: "score",
        lease: lease(),
        actorUid: "scorer-1",
        presentedLeaseId: "lease-1",
        nowMillis: 20_000,
      }),
    ).toMatchObject({ allowed: false, code: "lease-expired", retryable: true });
  });

  it("rotates the lease on explicit handoff and rejects ineligible targets", () => {
    expect(
      decideDiamondScorerLease({
        operation: "handoff",
        lease: lease(),
        actorUid: "scorer-1",
        presentedLeaseId: "lease-1",
        targetUid: "scorer-2",
        replacementLeaseId: "lease-2",
        eligibleTargetUids: ["scorer-1", "scorer-2"],
        nowMillis: 10_000,
      }),
    ).toMatchObject({
      allowed: true,
      code: "lease-handed-off",
      nextLease: { holderUid: "scorer-2", leaseId: "lease-2", epoch: 3 },
    });
    expect(
      decideDiamondScorerLease({
        operation: "handoff",
        lease: lease(),
        actorUid: "scorer-1",
        presentedLeaseId: "lease-1",
        targetUid: "fan-1",
        replacementLeaseId: "lease-2",
        eligibleTargetUids: ["scorer-1", "scorer-2"],
        nowMillis: 10_000,
      }),
    ).toMatchObject({ allowed: false, code: "ineligible-scorer" });
  });

  it("lets managers recover only an absent or expired lease without seizing an active lease", () => {
    expect(
      decideDiamondScorerLease({
        operation: "recover",
        lease: lease({ expiresAtMillis: 9_999 }),
        actorUid: "manager-1",
        actorCanManage: true,
        replacementLeaseId: "lease-recovered",
        nowMillis: 10_000,
      }),
    ).toMatchObject({
      allowed: true,
      code: "lease-recovered",
      nextLease: { holderUid: "manager-1", epoch: 3 },
    });
    expect(
      decideDiamondScorerLease({
        operation: "recover",
        lease: lease(),
        actorUid: "manager-1",
        actorCanManage: true,
        replacementLeaseId: "lease-recovered",
        nowMillis: 10_000,
      }),
    ).toMatchObject({ allowed: false, code: "lease-active" });
    expect(
      decideDiamondScorerLease({
        operation: "recover",
        lease: null,
        actorUid: "member-1",
        actorCanManage: false,
        replacementLeaseId: "lease-recovered",
        nowMillis: 10_000,
      }),
    ).toMatchObject({ allowed: false, code: "manager-required" });
  });
});

describe("Diamond public/private projections and bounded event reads", () => {
  it("uses a public allowlist and recursively strips private scorer, roster, note, AI, and lease data", () => {
    expect(
      sanitizeDiamondPublicProjection({
        schemaVersion: 2,
        trackingEngine: "diamond-v2",
        teamId: "team-1",
        gameId: "game-1",
        revision: 7,
        score: { home: 3, away: 2, scorerUid: "private-scorer" },
        currentBatter: {
          playerId: "player-1",
          displayName: "Maya",
          birthDate: "2014-01-01",
          parentEmail: "parent@example.com",
        },
        recentPlays: [
          {
            eventId: "event-7",
            description: "Single",
            transcript: "private words",
          },
        ],
        lease: { leaseId: "private-lease", holderUid: "private-scorer" },
        notes: ["private"],
        aiPrompt: "private",
        arbitraryFutureField: true,
      }),
    ).toEqual({
      schemaVersion: 2,
      trackingEngine: "diamond-v2",
      teamId: "team-1",
      gameId: "game-1",
      revision: 7,
      score: { home: 3, away: 2 },
      currentBatter: { playerId: "player-1", displayName: "Maya" },
      recentPlays: [{ eventId: "event-7", description: "Single" }],
    });
  });

  it("preserves authorized private notes and audit identity while still removing raw audio and secrets", () => {
    expect(
      sanitizeDiamondPrivateProjection({
        revision: 7,
        actorUid: "scorer-1",
        transcript: "private dictated note",
        notes: [
          {
            text: "Watch the bunt defense",
            rawAudio: "bytes",
            accessToken: "secret-token",
          },
        ],
        nested: { audioUrl: "https://private.example/audio", safe: true },
      }),
    ).toEqual({
      revision: 7,
      actorUid: "scorer-1",
      transcript: "private dictated note",
      notes: [{ text: "Watch the bunt defense" }],
      nested: { safe: true },
    });
  });

  it("sanitizes public replay events independently of canonical event storage", () => {
    expect(
      sanitizeDiamondPublicEvent({
        eventId: "event-7",
        revision: 7,
        type: "record_plate_appearance",
        description: "Maya singled to left",
        actorUid: "scorer-1",
        commandId,
        commandHash: "sha256:private",
        transcript: "Maya single left",
        payload: { private: true },
      }),
    ).toEqual({
      eventId: "event-7",
      revision: 7,
      type: "record_plate_appearance",
      description: "Maya singled to left",
    });
  });

  it("accepts complete empty pages as authoritative absence", () => {
    expect(
      buildDiamondEventPage({ events: [], sourceRevision: 0 }),
    ).toMatchObject({
      items: [],
      complete: true,
      collectionComplete: true,
      absenceConfirmed: true,
      cacheableAsComplete: true,
      retryable: false,
    });
  });

  it("never turns a partial empty read into absence and preserves a last complete page as stale", () => {
    const result = buildDiamondEventPage({
      events: [],
      readStatus: "partial",
      sourceRevision: 8,
      lastCompleteItems: [
        {
          eventId: "event-7",
          revision: 7,
          description: "Prior complete play",
          actorUid: "private",
        },
      ],
    });
    expect(result).toMatchObject({
      items: [
        { eventId: "event-7", revision: 7, description: "Prior complete play" },
      ],
      complete: false,
      absenceConfirmed: false,
      cacheableAsComplete: false,
      servedFromLastComplete: true,
      stale: true,
      retryable: true,
      error: { code: "incomplete-empty-event-read", retryable: true },
    });
  });

  it("exposes partial nonempty evidence without populating a completeness cache", () => {
    expect(
      buildDiamondEventPage({
        events: [
          { eventId: "event-8", revision: 8, description: "Known play" },
        ],
        readStatus: "partial",
        sourceRevision: 9,
      }),
    ).toMatchObject({
      items: [{ eventId: "event-8", revision: 8, description: "Known play" }],
      complete: false,
      absenceConfirmed: false,
      cacheableAsComplete: false,
      servedFromLastComplete: false,
      retryable: true,
      error: { code: "incomplete-event-read" },
    });
  });

  it("requires an opaque cursor when a bounded page is truncated", () => {
    expect(
      buildDiamondEventPage({
        events: [{ eventId: "event-1" }, { eventId: "event-2" }],
        limit: 1,
        hasMore: true,
        nextCursor: "cursor:event-1",
        sourceRevision: 2,
      }),
    ).toMatchObject({
      items: [{ eventId: "event-1" }],
      nextCursor: "cursor:event-1",
      truncated: true,
      collectionComplete: false,
      absenceConfirmed: false,
    });
    expect(() =>
      buildDiamondEventPage({
        events: [{ eventId: "event-1" }, { eventId: "event-2" }],
        limit: 1,
        sourceRevision: 2,
      }),
    ).toThrow(/next cursor/i);
  });
});

describe("Diamond voice, notification, rollback, and deletion boundaries", () => {
  it("accepts a non-mutating voice play proposal but never returns the transcript", () => {
    expect(
      validateDiamondVoiceProposal({
        schemaVersion: 1,
        type: "record_plate_appearance",
        payload: {
          batterId: "player-1",
          pitcherId: "player-9",
          playEventId: "prior-play",
          result: "single",
        },
        confidence: 0.92,
        unresolvedFields: [],
        requiresConfirmation: true,
        mutatesState: false,
      }),
    ).toEqual({
      schemaVersion: 1,
      type: "record_plate_appearance",
      payload: {
        batterId: "player-1",
        pitcherId: "player-9",
        playEventId: "prior-play",
        result: "single",
      },
      confidence: 0.92,
      unresolvedFields: [],
      requiresConfirmation: true,
      mutatesState: false,
      confirmable: true,
    });
    expect(
      validateDiamondVoiceProposal({
        schemaVersion: 1,
        type: "record_plate_appearance",
        payload: { batterId: "player-1" },
        confidence: 0.4,
        unresolvedFields: ["runner from second"],
        requiresConfirmation: true,
        mutatesState: false,
      }),
    ).toMatchObject({ confirmable: false });
  });

  it.each([
    [
      "mutation claim",
      {
        type: "record_pitch",
        payload: {},
        confidence: 1,
        unresolvedFields: [],
        requiresConfirmation: false,
        mutatesState: true,
      },
    ],
    [
      "administrative command",
      {
        type: "finalize",
        payload: { confirmed: true },
        confidence: 1,
        unresolvedFields: [],
        requiresConfirmation: true,
        mutatesState: false,
      },
    ],
    [
      "embedded transcript",
      {
        type: "record_pitch",
        payload: { transcript: "raw words" },
        confidence: 1,
        unresolvedFields: [],
        requiresConfirmation: true,
        mutatesState: false,
      },
    ],
    [
      "embedded audio",
      {
        type: "record_pitch",
        payload: { audioBlob: "bytes" },
        confidence: 1,
        unresolvedFields: [],
        requiresConfirmation: true,
        mutatesState: false,
      },
    ],
    [
      "committed command ID",
      {
        type: "record_pitch",
        payload: { commandId },
        confidence: 1,
        unresolvedFields: [],
        requiresConfirmation: true,
        mutatesState: false,
      },
    ],
  ])("rejects a voice proposal with %s", (_label, proposal) => {
    expect(() =>
      validateDiamondVoiceProposal({ schemaVersion: 1, ...proposal }),
    ).toThrow(/voice proposal|transcripts|confirmation boundary/i);
  });

  it("emits only a new accepted public live event notification", () => {
    expect(
      decideDiamondNotification({
        commandOutcome: "accepted",
        eventType: "record_plate_appearance",
        revision: 8,
        lastNotifiedRevision: 7,
      }),
    ).toEqual({ send: true, reason: "new-public-live-event", revision: 8 });
    expect(
      decideDiamondNotification({
        commandOutcome: "duplicate",
        eventType: "record_plate_appearance",
        revision: 8,
        lastNotifiedRevision: 7,
      }),
    ).toEqual({ send: false, reason: "duplicate-command" });
    expect(
      decideDiamondNotification({
        commandOutcome: "accepted",
        eventType: "void_event",
        revision: 8,
        lastNotifiedRevision: 7,
      }),
    ).toEqual({ send: false, reason: "correction-update" });
    expect(
      decideDiamondNotification({
        commandOutcome: "accepted",
        eventType: "record_plate_appearance",
        source: "projection-rebuild",
        revision: 8,
        lastNotifiedRevision: 7,
      }),
    ).toEqual({ send: false, reason: "derived-or-replayed-update" });
    expect(
      decideDiamondNotification({
        commandOutcome: "accepted",
        eventType: "private_note",
        isPublic: false,
        revision: 8,
        lastNotifiedRevision: 7,
      }),
    ).toEqual({ send: false, reason: "private-event" });
    expect(
      decideDiamondNotification({
        commandOutcome: "accepted",
        eventType: "finalize",
        revision: 7,
        lastNotifiedRevision: 7,
      }),
    ).toEqual({ send: false, reason: "revision-already-notified" });
  });

  it("stops activation first, then normal commands, while preserving existing-game safety work", () => {
    const enabled = parseDiamondPolicy(policy());
    const disabled = parseDiamondPolicy(policy({ mode: "disabled" }));
    const diamondGame = game({ trackingEngine: DIAMOND_ENGINE });
    expect(
      decideDiamondOperation({
        operation: "activate",
        policy: enabled,
        teamId: "team-1",
        game: game(),
        rollbackStage: "activation-disabled",
      }),
    ).toMatchObject({ allowed: false, code: "activation-stopped" });
    expect(
      decideDiamondOperation({
        operation: "score",
        policy: enabled,
        teamId: "team-1",
        game: diamondGame,
        rollbackStage: "activation-disabled",
      }),
    ).toMatchObject({ allowed: true, code: "policy-allows" });
    expect(
      decideDiamondOperation({
        operation: "score",
        policy: enabled,
        teamId: "team-1",
        game: diamondGame,
        rollbackStage: "commands-disabled",
      }),
    ).toMatchObject({ allowed: false, code: "scoring-stopped" });
    expect(
      decideDiamondOperation({
        operation: "score",
        policy: disabled,
        teamId: "team-1",
        game: diamondGame,
      }),
    ).toMatchObject({ allowed: false, code: "policy-disabled" });

    for (const operation of [
      "read",
      "replay",
      "correct",
      "project",
      "cleanup",
    ]) {
      expect(
        decideDiamondOperation({
          operation,
          policy: parseDiamondPolicy(null, { readStatus: "error" }),
          teamId: "team-1",
          game: diamondGame,
          rollbackStage: "commands-disabled",
        }),
      ).toMatchObject({
        allowed: true,
        code: "existing-game-operation-preserved",
        operation,
      });
    }
    expect(
      decideDiamondOperation({
        operation: "read",
        policy: enabled,
        teamId: "team-1",
        game: game({ trackingEngine: "diamond-v3" }),
      }),
    ).toMatchObject({ allowed: false, code: "unknown-tracking-engine" });
  });

  it("performs generation-bound, parent-revalidated, idempotent cleanup only for deleted Diamond games", () => {
    const deleted = game({
      trackingEngine: DIAMOND_ENGINE,
      trackingEngineRevision: 1,
    });
    expect(
      decideDiamondDeletionCleanup({
        deletedGame: game({ trackingEngine: "legacy-v1" }),
      }),
    ).toMatchObject({
      allowed: true,
      action: "ignore",
      complete: true,
    });
    expect(
      decideDiamondDeletionCleanup({
        deletedGame: game({ trackingEngine: "diamond-v3" }),
      }),
    ).toMatchObject({
      allowed: false,
      action: "retain",
      code: "unknown-tracking-engine",
    });
    expect(
      decideDiamondDeletionCleanup({
        deletedGame: game({ trackingEngine: DIAMOND_ENGINE }),
        currentGame: null,
      }),
    ).toMatchObject({
      allowed: false,
      action: "retain",
      code: "missing-cleanup-generation",
    });
    expect(
      decideDiamondDeletionCleanup({
        deletedGame: deleted,
        currentReadStatus: "error",
      }),
    ).toMatchObject({
      allowed: false,
      action: "retain",
      code: "parent-read-incomplete",
      retryable: true,
    });
    expect(
      decideDiamondDeletionCleanup({
        deletedGame: deleted,
        currentGame: game({ trackingEngine: DIAMOND_ENGINE }),
      }),
    ).toMatchObject({
      allowed: false,
      action: "retain",
      code: "game-recreated",
    });
    expect(
      decideDiamondDeletionCleanup({ deletedGame: deleted }),
    ).toMatchObject({
      allowed: true,
      action: "delete-descendants",
      complete: false,
      generation: "revision:1",
      requireParentAbsentRecheck: true,
      requireDescendantGenerationMatch: true,
    });
    expect(
      decideDiamondDeletionCleanup({
        deletedGame: deleted,
        descendantsPresent: false,
        cleanupReceipt: { complete: true, generation: "revision:1" },
      }),
    ).toMatchObject({
      allowed: true,
      action: "none",
      complete: true,
      code: "cleanup-already-complete",
    });
    expect(
      decideDiamondDeletionCleanup({
        deletedGame: deleted,
        descendantsPresent: false,
      }),
    ).toMatchObject({
      allowed: true,
      action: "record-complete",
      complete: true,
    });
  });
});
