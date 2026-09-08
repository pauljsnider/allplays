"use strict";

const COOLDOWN_MS = 300_000;
const CLAIM_MS = 600_000;
const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const HASH = /^sha256:[0-9a-f]{64}$/;
const HEAD_KEYS =
  "checkpointDigest checkpointHash instanceId orientationSnapshotHash sourceRevision statConfigSnapshotHash".split(
    " ",
  );
const COMMON_KEYS =
  "attemptId gameId instanceId schemaVersion startedAtMs status teamId trackingEngine type updatedAtMs".split(
    " ",
  );
const STATUS_KEYS = {
  reserved: ["leaseUntilMs"],
  blocked: "blockedByAttemptId reason retryAtMs".split(" "),
  accepted:
    "acceptedAtMs dedupeUntilMs resultHead resultProjectionStatus resultRevision".split(
      " ",
    ),
  failed: "failedAtMs failureCode retryAtMs".split(" "),
};

function plain(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function exact(value, keys) {
  return (
    plain(value) &&
    Object.keys(value).sort().join("\0") === [...keys].sort().join("\0")
  );
}

const uuid = (value) => typeof value === "string" && UUID.test(value);
const integer = (value) => Number.isSafeInteger(value) && value >= 0;
const id = (value) =>
  typeof value === "string" &&
  value === value.trim() &&
  value.length > 0 &&
  value.length <= 128 &&
  !value.includes("/");

function validHead(value) {
  const hashes = [
    value?.checkpointDigest,
    value?.checkpointHash,
    value?.orientationSnapshotHash,
    value?.statConfigSnapshotHash,
  ];
  return (
    exact(value, HEAD_KEYS) &&
    uuid(value.instanceId) &&
    integer(value.sourceRevision) &&
    hashes.every((hash) => HASH.test(hash))
  );
}

function sameHead(left, right, allowRepairedDigest = false) {
  return Boolean(
    validHead(left) &&
    validHead(right) &&
    HEAD_KEYS.every(
      (key) =>
        (allowRepairedDigest && key === "checkpointDigest") ||
        left[key] === right[key],
    ),
  );
}

function validCommon(value, scope) {
  return (
    value.schemaVersion === 1 &&
    value.type === scope.type &&
    value.trackingEngine === "diamond-v2" &&
    value.teamId === scope.teamId &&
    value.gameId === scope.gameId &&
    uuid(value.instanceId) &&
    uuid(value.attemptId) &&
    integer(value.startedAtMs) &&
    integer(value.updatedAtMs) &&
    value.updatedAtMs >= value.startedAtMs &&
    value.updatedAtMs <= scope.nowMs
  );
}

function validRequest(request) {
  return (
    exact(request, ["actorUid", "requestHash", "requestId"]) &&
    id(request.actorUid) &&
    uuid(request.requestId) &&
    HASH.test(request.requestHash)
  );
}

function validStatus(value, nowMs) {
  if (value.status === "reserved") {
    return (
      value.updatedAtMs === value.startedAtMs &&
      value.leaseUntilMs === value.startedAtMs + CLAIM_MS
    );
  }
  if (value.status === "blocked") {
    return (
      uuid(value.blockedByAttemptId) &&
      value.updatedAtMs === value.startedAtMs &&
      integer(value.retryAtMs) &&
      value.retryAtMs > value.startedAtMs &&
      value.retryAtMs <= value.startedAtMs + CLAIM_MS &&
      ["global-in-progress", "projector-in-progress"].includes(value.reason)
    );
  }
  const changedAt =
    value[value.status === "accepted" ? "acceptedAtMs" : "failedAtMs"];
  if (
    !integer(changedAt) ||
    changedAt < value.startedAtMs ||
    changedAt > nowMs ||
    value.updatedAtMs !== changedAt
  )
    return false;
  if (value.status === "accepted") {
    return (
      value.dedupeUntilMs === changedAt + CLAIM_MS &&
      sameHead(value.sourceHead, value.resultHead, true) &&
      value.resultRevision === value.resultHead.sourceRevision &&
      value.resultProjectionStatus === "pending"
    );
  }
  return (
    value.status === "failed" &&
    integer(value.retryAtMs) &&
    value.retryAtMs >= value.startedAtMs + COOLDOWN_MS &&
    value.retryAtMs <= value.startedAtMs + CLAIM_MS &&
    ["history-unavailable", "history-invalid", "commit-rejected"].includes(
      value.failureCode,
    )
  );
}

function parseProjectionRegenerationControl(value, scope) {
  if (!plain(value)) return null;
  const rate = scope.type === "projection-regeneration-rate";
  const receipt = scope.type === "projection-regeneration-receipt";
  const keys = rate
    ? ["actorUid", "cooldownUntilMs"]
    : [
        receipt ? "request" : "ownerUid",
        "sourceCoordinationHash",
        "sourceHead",
        ...(STATUS_KEYS[value.status] || []),
      ];
  if (!exact(value, [...COMMON_KEYS, ...keys]) || !validCommon(value, scope))
    return null;
  if (rate) {
    return value.status === "cooldown" &&
      id(value.actorUid) &&
      value.updatedAtMs === value.startedAtMs &&
      value.cooldownUntilMs === value.startedAtMs + COOLDOWN_MS
      ? value
      : null;
  }
  const principalValid = receipt
    ? validRequest(value.request)
    : id(value.ownerUid) && value.status !== "blocked";
  return HASH.test(value.sourceCoordinationHash) &&
    validHead(value.sourceHead) &&
    value.instanceId === value.sourceHead.instanceId &&
    principalValid &&
    validStatus(value, scope.nowMs)
    ? value
    : null;
}

function makeControl(scope, type, status, fields) {
  return {
    schemaVersion: 1,
    type,
    trackingEngine: "diamond-v2",
    teamId: scope.teamId,
    gameId: scope.gameId,
    instanceId: scope.head.instanceId,
    attemptId: scope.attemptId,
    startedAtMs: scope.startedAtMs ?? scope.nowMs,
    updatedAtMs: scope.updatedAtMs ?? scope.nowMs,
    status,
    ...fields,
  };
}

function buildProjectionRegenerationControls(scope) {
  const reserved = {
    sourceCoordinationHash: scope.coordinationHash,
    sourceHead: scope.head,
    leaseUntilMs: scope.nowMs + CLAIM_MS,
  };
  return {
    receipt: makeControl(scope, "projection-regeneration-receipt", "reserved", {
      request: scope.request,
      ...reserved,
    }),
    claim: makeControl(scope, "projection-regeneration-claim", "reserved", {
      ownerUid: scope.request.actorUid,
      ...reserved,
    }),
    rate: makeControl(scope, "projection-regeneration-rate", "cooldown", {
      actorUid: scope.request.actorUid,
      cooldownUntilMs: scope.nowMs + COOLDOWN_MS,
    }),
  };
}

function transition(current, status, nowMs, fields) {
  const scope = {
    ...current,
    head: current.sourceHead,
    nowMs,
    updatedAtMs: nowMs,
  };
  const principal = current.request
    ? { request: current.request }
    : { ownerUid: current.ownerUid };
  return makeControl(scope, current.type, status, {
    ...principal,
    sourceCoordinationHash: current.sourceCoordinationHash,
    sourceHead: current.sourceHead,
    ...fields,
  });
}

function acceptProjectionRegenerationAttempt(controls, resultHead, nowMs) {
  const fields = {
    acceptedAtMs: nowMs,
    dedupeUntilMs: nowMs + CLAIM_MS,
    resultHead,
    resultProjectionStatus: "pending",
    resultRevision: resultHead.sourceRevision,
  };
  return {
    receipt: transition(controls.receipt, "accepted", nowMs, fields),
    claim: transition(controls.claim, "accepted", nowMs, fields),
  };
}

function failProjectionRegenerationControl(
  control,
  failureCode,
  nowMs,
  retryAtMs = control.startedAtMs + COOLDOWN_MS,
) {
  return transition(control, "failed", nowMs, {
    failedAtMs: nowMs,
    failureCode,
    retryAtMs: Math.max(
      control.startedAtMs + COOLDOWN_MS,
      Math.min(retryAtMs, control.startedAtMs + CLAIM_MS),
    ),
  });
}

function failProjectionRegenerationAttempt(controls, failureCode, nowMs) {
  return {
    receipt: failProjectionRegenerationControl(
      controls.receipt,
      failureCode,
      nowMs,
    ),
    claim: failProjectionRegenerationControl(
      controls.claim,
      failureCode,
      nowMs,
      controls.claim.startedAtMs + CLAIM_MS,
    ),
  };
}

const requestMatches = (receipt, request) =>
  receipt?.request?.actorUid === request.actorUid &&
  receipt.request.requestId === request.requestId &&
  receipt.request.requestHash === request.requestHash;
const activeUntil = (control) =>
  control?.status === "reserved"
    ? control.leaseUntilMs
    : control?.status === "accepted"
      ? control.dedupeUntilMs
      : control?.retryAtMs;
const reject = (reason, retryAtMs) => ({
  action: "reject",
  reason,
  ...(retryAtMs ? { retryAtMs } : {}),
});

function planProjectionRegeneration(input) {
  const { receipt, request, head, claim, nowMs } = input;
  if (receipt && !requestMatches(receipt, request))
    return reject("idempotency-conflict");
  if (receipt?.status === "accepted") return { action: "accepted", receipt };
  if (receipt?.status === "blocked" && activeUntil(receipt) > nowMs) {
    if (
      claim?.status === "accepted" &&
      claim.attemptId === receipt.blockedByAttemptId &&
      sameHead(claim.resultHead, receipt.sourceHead) &&
      input.claimProven
    )
      return { action: "follow-accepted", claim };
    return reject("request-in-progress", activeUntil(receipt));
  }
  if (receipt && activeUntil(receipt) > nowMs)
    return reject(
      receipt.status === "failed" ? "retry-delayed" : "request-in-progress",
      activeUntil(receipt),
    );
  if (!head) return { action: "continue" };
  if (
    (input.expectedRevision != null &&
      input.expectedRevision !== head.sourceRevision) ||
    (receipt && !sameHead(receipt.sourceHead, head))
  )
    return reject("stale-head");
  if (
    !receipt &&
    input.rate?.instanceId === head.instanceId &&
    input.rate.cooldownUntilMs > nowMs
  )
    return reject("rate-limited", input.rate.cooldownUntilMs);
  const currentClaimHead =
    claim?.status === "accepted" ? claim.resultHead : claim?.sourceHead;
  if (claim && sameHead(currentClaimHead, head) && activeUntil(claim) > nowMs) {
    if (claim.status === "accepted" && input.claimProven)
      return { action: "follow-accepted", claim };
    return {
      action: "follow-blocked",
      claim,
      reason: "global-in-progress",
      retryAtMs: activeUntil(claim),
    };
  }
  if (integer(input.rootWorkUntilMs) && input.rootWorkUntilMs > nowMs)
    return {
      action: "follow-blocked",
      claim: null,
      reason: "projector-in-progress",
      retryAtMs: Math.min(input.rootWorkUntilMs, nowMs + CLAIM_MS),
    };
  return { action: "reserve" };
}

function buildProjectionRegenerationFollower(scope) {
  const attempt = { ...scope, attemptId: scope.receiptAttemptId };
  const controls = buildProjectionRegenerationControls(attempt);
  const receipt = scope.acceptedClaim
    ? acceptProjectionRegenerationAttempt(
        { receipt: controls.receipt, claim: controls.receipt },
        scope.acceptedClaim.resultHead,
        scope.nowMs,
      ).receipt
    : makeControl(attempt, "projection-regeneration-receipt", "blocked", {
        request: scope.request,
        sourceCoordinationHash: scope.coordinationHash,
        sourceHead: scope.head,
        blockedByAttemptId: scope.blockedByAttemptId,
        reason: scope.reason || "global-in-progress",
        retryAtMs: Math.min(scope.retryAtMs, scope.nowMs + CLAIM_MS),
      });
  return { receipt, rate: controls.rate };
}

function reservationControlsMatch(input) {
  const { receipt, claim, rate, request, head, attemptId, nowMs } = input;
  return Boolean(
    receipt?.status === "reserved" &&
    claim?.status === "reserved" &&
    rate?.status === "cooldown" &&
    requestMatches(receipt, request) &&
    [receipt, claim, rate].every((value) => value.attemptId === attemptId) &&
    rate.actorUid === request.actorUid &&
    rate.instanceId === head.instanceId &&
    receipt.sourceCoordinationHash === input.coordinationHash &&
    claim.sourceCoordinationHash === input.coordinationHash &&
    sameHead(receipt.sourceHead, head) &&
    sameHead(claim.sourceHead, head) &&
    receipt.leaseUntilMs > nowMs &&
    claim.leaseUntilMs > nowMs,
  );
}

module.exports = {
  PROJECTION_REGENERATION_COOLDOWN_MS: COOLDOWN_MS,
  PROJECTION_REGENERATION_RESERVATION_MS: CLAIM_MS,
  acceptProjectionRegenerationAttempt,
  buildProjectionRegenerationControls,
  buildProjectionRegenerationFollower,
  failProjectionRegenerationAttempt,
  failProjectionRegenerationControl,
  parseProjectionRegenerationControl,
  planProjectionRegeneration,
  reservationControlsMatch,
  sameProjectionRegenerationHead: sameHead,
};
