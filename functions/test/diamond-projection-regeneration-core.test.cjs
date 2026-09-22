"use strict";

const assert = require("node:assert/strict");
const { describe, it } = require("node:test");

const {
  PROJECTION_REGENERATION_COOLDOWN_MS,
  PROJECTION_REGENERATION_RESERVATION_MS,
  acceptProjectionRegenerationAttempt,
  buildProjectionRegenerationControls,
  buildProjectionRegenerationFollower,
  failProjectionRegenerationControl,
  parseProjectionRegenerationControl,
  planProjectionRegeneration,
} = require("../diamond-projection-regeneration-core.cjs");

const NOW = 1_750_000_000_000;
const UUID = "00000000-0000-4000-8000-000000000001";
const OTHER_UUID = "00000000-0000-4000-8000-000000000002";
const HASH = `sha256:${"a".repeat(64)}`;
const OTHER_HASH = `sha256:${"b".repeat(64)}`;
const request = Object.freeze({
  actorUid: "manager-1",
  requestId: UUID,
  requestHash: HASH,
});
const head = Object.freeze({
  instanceId: OTHER_UUID,
  sourceRevision: 7,
  checkpointHash: HASH,
  statConfigSnapshotHash: HASH,
  orientationSnapshotHash: HASH,
  checkpointDigest: HASH,
});

function controls(overrides = {}) {
  return buildProjectionRegenerationControls({
    teamId: "team-1",
    gameId: "game-1",
    request,
    head,
    coordinationHash: HASH,
    attemptId: "00000000-0000-4000-8000-000000000003",
    nowMs: NOW,
    ...overrides,
  });
}

describe("Diamond projection regeneration protocol", () => {
  it("prioritizes an exact queued receipt over a later head and rejects request reuse", () => {
    const original = controls();
    const accepted = acceptProjectionRegenerationAttempt(
      { receipt: original.receipt, claim: original.claim },
      { ...head, checkpointDigest: OTHER_HASH },
      NOW + 10,
    ).receipt;
    assert.deepEqual(
      planProjectionRegeneration({
        nowMs: NOW + 20,
        request,
        head: { ...head, sourceRevision: 8 },
        receipt: accepted,
      }),
      { action: "accepted", receipt: accepted },
    );
    assert.equal(
      planProjectionRegeneration({
        nowMs: NOW + 20,
        request: { ...request, requestHash: OTHER_HASH },
        head,
        receipt: accepted,
      }).reason,
      "idempotency-conflict",
    );
    assert.deepEqual(planProjectionRegeneration({ nowMs: NOW + 20, request }), {
      action: "continue",
    });
  });

  it("enforces the actor cooldown before following global work", () => {
    const original = controls();
    assert.deepEqual(
      planProjectionRegeneration({
        nowMs: NOW + 1,
        request: { ...request, requestId: OTHER_UUID },
        head,
        rate: original.rate,
        claim: original.claim,
      }),
      {
        action: "reject",
        reason: "rate-limited",
        retryAtMs: NOW + PROJECTION_REGENERATION_COOLDOWN_MS,
      },
    );
  });

  it("distinguishes proven queued followers from blocked in-progress followers", () => {
    const original = controls();
    const repairedHead = { ...head, checkpointDigest: OTHER_HASH };
    const acceptedClaim = acceptProjectionRegenerationAttempt(
      { receipt: original.receipt, claim: original.claim },
      repairedHead,
      NOW + 10,
    ).claim;
    assert.equal(
      planProjectionRegeneration({
        nowMs: NOW + 20,
        request: { ...request, requestId: OTHER_UUID },
        head: repairedHead,
        claim: acceptedClaim,
        claimProven: true,
      }).action,
      "follow-accepted",
    );
    assert.equal(
      planProjectionRegeneration({
        nowMs: NOW + 20,
        request: { ...request, requestId: OTHER_UUID },
        head: repairedHead,
        claim: acceptedClaim,
      }).action,
      "follow-blocked",
    );
    const blocked = buildProjectionRegenerationFollower({
      teamId: "team-1",
      gameId: "game-1",
      request: { ...request, requestId: OTHER_UUID },
      head: repairedHead,
      coordinationHash: HASH,
      receiptAttemptId: "00000000-0000-4000-8000-000000000004",
      blockedByAttemptId: acceptedClaim.attemptId,
      nowMs: NOW + 20,
      retryAtMs: acceptedClaim.dedupeUntilMs,
    });
    assert.equal(blocked.receipt.attemptId.endsWith("0004"), true);
    assert.equal(blocked.receipt.blockedByAttemptId, acceptedClaim.attemptId);
    assert.ok(
      parseProjectionRegenerationControl(blocked.receipt, {
        type: "projection-regeneration-receipt",
        teamId: "team-1",
        gameId: "game-1",
        nowMs: NOW + 20,
      }),
    );
    assert.equal(
      planProjectionRegeneration({
        nowMs: NOW + 30,
        request: blocked.receipt.request,
        head: repairedHead,
        receipt: blocked.receipt,
        claim: acceptedClaim,
        claimProven: true,
      }).action,
      "follow-accepted",
    );
    const follower = buildProjectionRegenerationFollower({
      teamId: "team-1",
      gameId: "game-1",
      request: { ...request, requestId: OTHER_UUID },
      head: repairedHead,
      coordinationHash: HASH,
      receiptAttemptId: "00000000-0000-4000-8000-000000000004",
      acceptedClaim,
      nowMs: NOW + 20,
    });
    assert.equal(follower.receipt.status, "accepted");
    assert.equal(follower.receipt.attemptId.endsWith("0004"), true);
  });

  it("retains failures through cooldown and permits bounded same-request recovery", () => {
    const original = controls();
    const failed = failProjectionRegenerationControl(
      original.receipt,
      "history-unavailable",
      NOW + 10,
    );
    assert.equal(
      planProjectionRegeneration({
        nowMs: NOW + 20,
        request,
        head,
        receipt: failed,
      }).action,
      "reject",
    );
    assert.deepEqual(
      planProjectionRegeneration({
        nowMs: NOW + PROJECTION_REGENERATION_COOLDOWN_MS + 1,
        request,
        head,
        receipt: failed,
      }),
      { action: "reserve" },
    );
  });

  it("validates private controls strictly and expires stale claims", () => {
    const original = controls();
    assert.ok(
      parseProjectionRegenerationControl(original.claim, {
        type: "projection-regeneration-claim",
        teamId: "team-1",
        gameId: "game-1",
        nowMs: NOW,
      }),
    );
    assert.equal(
      parseProjectionRegenerationControl(
        { ...original.claim, head: { ...head, checkpointDigest: "bad" } },
        {
          type: "projection-regeneration-claim",
          teamId: "team-1",
          gameId: "game-1",
          nowMs: NOW,
        },
      ),
      null,
    );
    assert.equal(
      parseProjectionRegenerationControl(
        { ...original.claim, sourceCoordinationHash: "bad" },
        {
          type: "projection-regeneration-claim",
          teamId: "team-1",
          gameId: "game-1",
          nowMs: NOW,
        },
      ),
      null,
    );
    const accepted = acceptProjectionRegenerationAttempt(
      { receipt: original.receipt, claim: original.claim },
      { ...head, checkpointDigest: OTHER_HASH },
      NOW + 10,
    ).claim;
    assert.ok(
      parseProjectionRegenerationControl(accepted, {
        type: "projection-regeneration-claim",
        teamId: "team-1",
        gameId: "game-1",
        nowMs: NOW + 10,
      }),
    );
    assert.equal(
      parseProjectionRegenerationControl(
        {
          ...accepted,
          resultHead: { ...accepted.resultHead, sourceRevision: 8 },
          resultRevision: 8,
        },
        {
          type: "projection-regeneration-claim",
          teamId: "team-1",
          gameId: "game-1",
          nowMs: NOW + 10,
        },
      ),
      null,
    );
    assert.equal(
      planProjectionRegeneration({
        nowMs: NOW + PROJECTION_REGENERATION_RESERVATION_MS + 1,
        request: { ...request, requestId: OTHER_UUID },
        head,
        claim: original.claim,
      }).action,
      "reserve",
    );
  });
});
