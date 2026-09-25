"use strict";

const {
  createFirestoreFixedWindowRateLimitReservation,
} = require("./rate-limit.cjs");

const SCORER_CANDIDATE_RATE_WINDOW_MS = 60 * 1000;
const SCORER_CANDIDATE_SUSTAINED_WINDOW_MS = 10 * 60 * 1000;
const SCORER_CANDIDATE_REQUEST_LEASE_MS = 3 * 60 * 1000;
const SCORER_CANDIDATE_CALLABLE_ENVELOPE_MS = 2 * 60 * 1000;
const SCORER_CANDIDATE_RECEIPT_RETENTION_MS = 5 * 60 * 1000;
const SCORER_CANDIDATE_CONTROL_QUARANTINE_MS =
  SCORER_CANDIDATE_RECEIPT_RETENTION_MS;
const MAX_SCORER_CANDIDATE_REQUESTS_PER_WINDOW = 4;
const MAX_SCORER_CANDIDATE_GLOBAL_REQUESTS_PER_WINDOW = 8;
const MAX_SCORER_CANDIDATE_SUSTAINED_REQUESTS_PER_WINDOW = 16;
const MAX_SCORER_CANDIDATE_GLOBAL_SUSTAINED_REQUESTS_PER_WINDOW = 32;
const MAX_CONCURRENT_SCORER_CANDIDATE_REQUESTS = 1;
const MAX_CONCURRENT_SCORER_CANDIDATE_GLOBAL_REQUESTS = 2;
const MAX_SCORER_CANDIDATES = 100;
const MAX_SCORER_CANDIDATE_RECEIPT_BYTES = 256 * 1024;
const MAX_SCORER_CANDIDATE_LOCK_BYTES = 16 * 1024;
const UUID_V4_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SHA256_PATTERN = /^sha256:[0-9a-f]{64}$/;

function own(value, key) {
  return Object.prototype.hasOwnProperty.call(value || {}, key);
}

function isPlainObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function exactKeys(value, keys) {
  return (
    isPlainObject(value) &&
    Object.keys(value).length === keys.length &&
    keys.every((key) => own(value, key))
  );
}

function snapshotData(snapshot) {
  return snapshot?.exists === true && typeof snapshot.data === "function"
    ? snapshot.data() || {}
    : null;
}

function timestampMs(value) {
  const milliseconds =
    value instanceof Date ? value.getTime() : value?.toMillis?.();
  return Number.isSafeInteger(milliseconds) && milliseconds >= 0
    ? milliseconds
    : null;
}

function snapshotUpdatedAtMs(snapshot) {
  return timestampMs(snapshot?.updateTime);
}

function jsonBytes(value) {
  try {
    return Buffer.byteLength(JSON.stringify(value), "utf8");
  } catch {
    return Number.POSITIVE_INFINITY;
  }
}

function canonicalName(value, uid) {
  if (typeof value !== "string") return null;
  const name = value
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 160)
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 160);
  return name || uid;
}

function validId(value) {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= 128 &&
    value === value.trim() &&
    !value.includes("/") &&
    !/[\u0000-\u001f\u007f]/.test(value)
  );
}

function validCandidates(candidates) {
  if (!Array.isArray(candidates) || candidates.length > MAX_SCORER_CANDIDATES) {
    return false;
  }
  const ids = [];
  for (const candidate of candidates) {
    if (
      !exactKeys(candidate, ["playerId", "name"]) ||
      !validId(candidate.playerId) ||
      canonicalName(candidate.name, candidate.playerId) !== candidate.name
    ) {
      return false;
    }
    ids.push(candidate.playerId);
  }
  return (
    new Set(ids).size === ids.length &&
    ids.every(
      (id, index) => index === 0 || ids[index - 1].localeCompare(id) < 0,
    )
  );
}

function createDiamondScorerCandidateAdmission({
  firestore,
  collectionName,
  clock = () => Date.now(),
  hashValue,
  makeError,
  logger = { error() {} },
} = {}) {
  if (
    !firestore?.doc ||
    !firestore?.collection ||
    typeof firestore.runTransaction !== "function" ||
    typeof hashValue !== "function" ||
    typeof makeError !== "function"
  ) {
    throw new TypeError("Scorer candidate admission dependencies are invalid.");
  }
  if (typeof collectionName !== "string" || !collectionName.trim()) {
    throw new TypeError("Scorer candidate admission collection is required.");
  }
  const collection = collectionName.trim();
  const error = (reason, message, code = "unavailable", retryable = true) =>
    makeError(code, message, { reason, retryable });
  const now = () => {
    let value;
    try {
      value = typeof clock === "function" ? clock() : clock?.now?.();
    } catch {
      value = null;
    }
    if (value instanceof Date) value = value.getTime();
    if (!Number.isSafeInteger(value) || value < 0) {
      throw error(
        "scorer-candidate-clock-invalid",
        "Scorer candidate admission time is unavailable.",
      );
    }
    return value;
  };
  const hash = (value) => {
    const result = hashValue(value);
    if (!SHA256_PATTERN.test(result)) {
      throw error(
        "scorer-candidate-hash-invalid",
        "Scorer candidate admission could not be identified.",
      );
    }
    return result;
  };
  const invalidState = (snapshot, nowMs) => {
    const updatedAtMs = snapshotUpdatedAtMs(snapshot);
    if (
      updatedAtMs !== null &&
      updatedAtMs + SCORER_CANDIDATE_CONTROL_QUARANTINE_MS <= nowMs
    ) {
      return null;
    }
    throw error(
      "scorer-candidate-control-invalid",
      "Scorer candidate safety state is unavailable. Try again later.",
    );
  };

  // The UI makes at most two transport attempts for one immutable logical
  // request. These limits admit two immediate/eight sustained manual panel
  // loads per game and twice that caller-wide. Confirmed failures re-execute
  // and charge; an exact completed receipt has one bounded recovery replay.
  const limiter = (windowMs, maxRequests) =>
    createFirestoreFixedWindowRateLimitReservation({
      firestore,
      collectionName: collection,
      windowMs,
      maxRequests,
    });
  const limits = Object.freeze([
    ["scope-burst", "scopeHash", limiter(SCORER_CANDIDATE_RATE_WINDOW_MS, 4)],
    ["global-burst", "callerHash", limiter(SCORER_CANDIDATE_RATE_WINDOW_MS, 8)],
    [
      "scope-sustained",
      "scopeHash",
      limiter(SCORER_CANDIDATE_SUSTAINED_WINDOW_MS, 16),
    ],
    [
      "global-sustained",
      "callerHash",
      limiter(SCORER_CANDIDATE_SUSTAINED_WINDOW_MS, 32),
    ],
  ]);

  function identity(request, callerUid, executionId) {
    if (
      !exactKeys(request, [
        "requestId",
        "teamId",
        "gameId",
        "expectedInstanceId",
        "expectedRevision",
        "leaseId",
      ]) ||
      !UUID_V4_PATTERN.test(request.requestId) ||
      !validId(request.teamId) ||
      !validId(request.gameId) ||
      !UUID_V4_PATTERN.test(request.expectedInstanceId) ||
      !Number.isSafeInteger(request.expectedRevision) ||
      request.expectedRevision < 0 ||
      !validId(request.leaseId) ||
      !validId(callerUid) ||
      !UUID_V4_PATTERN.test(executionId)
    ) {
      throw error(
        "scorer-candidate-identity-invalid",
        "Scorer candidate admission identity is invalid.",
      );
    }
    const callerHash = hash({
      schemaVersion: 1,
      type: "diamond-scorer-candidate-caller",
      callerUid,
    });
    const scopeHash = hash({
      schemaVersion: 1,
      type: "diamond-scorer-candidate-scope",
      callerUid,
      teamId: request.teamId,
      gameId: request.gameId,
    });
    const inputHash = hash({
      schemaVersion: 1,
      type: "diamond-scorer-candidate-input",
      scopeHash,
      expectedInstanceId: request.expectedInstanceId,
      expectedRevision: request.expectedRevision,
      leaseId: request.leaseId,
    });
    const logicalHash = hash({
      schemaVersion: 1,
      type: "diamond-scorer-candidate-logical-request",
      callerHash,
      requestId: request.requestId,
    });
    const requestHash = hash({
      schemaVersion: 1,
      type: "diamond-scorer-candidate-request",
      logicalHash,
      inputHash,
    });
    const executionHash = hash({
      schemaVersion: 1,
      type: "diamond-scorer-candidate-execution",
      executionId,
    });
    return Object.freeze({
      callerHash,
      scopeHash,
      inputHash,
      logicalHash,
      requestHash,
      executionHash,
      globalLockRef: firestore.doc(
        `${collection}/scorer-candidate-global-${callerHash.slice(7)}`,
      ),
      scopeLockRef: firestore.doc(
        `${collection}/scorer-candidate-scope-${scopeHash.slice(7)}`,
      ),
      receiptRef: firestore.doc(
        `${collection}/scorer-candidate-receipt-${logicalHash.slice(7)}`,
      ),
    });
  }

  function lockOptions(identityValue, global) {
    return global
      ? {
          type: "diamond-scorer-candidate-global-lock",
          bindingHash: identityValue.callerHash,
          maximum: MAX_CONCURRENT_SCORER_CANDIDATE_GLOBAL_REQUESTS,
        }
      : {
          type: "diamond-scorer-candidate-scope-lock",
          bindingHash: identityValue.scopeHash,
          maximum: MAX_CONCURRENT_SCORER_CANDIDATE_REQUESTS,
          scopeHash: identityValue.scopeHash,
        };
  }

  function parseLock(snapshot, options, nowMs) {
    if (!snapshot?.exists) return null;
    const value = snapshotData(snapshot);
    if (
      !exactKeys(value, [
        "schemaVersion",
        "type",
        "bindingHash",
        "activeAttempts",
        "updatedAtMs",
        "expiresAt",
      ]) ||
      value.schemaVersion !== 1 ||
      value.type !== options.type ||
      value.bindingHash !== options.bindingHash ||
      !Array.isArray(value.activeAttempts) ||
      value.activeAttempts.length > options.maximum ||
      !Number.isSafeInteger(value.updatedAtMs) ||
      value.updatedAtMs < 0 ||
      value.updatedAtMs > nowMs
    ) {
      return invalidState(snapshot, nowMs);
    }
    const validAttempt = (entry) =>
      exactKeys(entry, [
        "kind",
        "scopeHash",
        "requestHash",
        "inputHash",
        "executionHash",
        "startedAtMs",
        "leaseExpiresAtMs",
      ]) &&
      (entry.kind === "execute" || entry.kind === "replay") &&
      SHA256_PATTERN.test(entry.scopeHash) &&
      (!options.scopeHash || entry.scopeHash === options.scopeHash) &&
      SHA256_PATTERN.test(entry.requestHash) &&
      SHA256_PATTERN.test(entry.inputHash) &&
      SHA256_PATTERN.test(entry.executionHash) &&
      Number.isSafeInteger(entry.startedAtMs) &&
      entry.startedAtMs >= 0 &&
      entry.startedAtMs <= value.updatedAtMs &&
      (entry.kind === "execute"
        ? entry.leaseExpiresAtMs ===
          entry.startedAtMs + SCORER_CANDIDATE_REQUEST_LEASE_MS
        : Number.isSafeInteger(entry.leaseExpiresAtMs) &&
          entry.leaseExpiresAtMs >
            entry.startedAtMs + SCORER_CANDIDATE_CALLABLE_ENVELOPE_MS &&
          entry.leaseExpiresAtMs <=
            entry.startedAtMs + SCORER_CANDIDATE_REQUEST_LEASE_MS);
    const unique = (field) =>
      new Set(value.activeAttempts.map((entry) => entry?.[field])).size ===
      value.activeAttempts.length;
    const expiresAtMs = timestampMs(value.expiresAt);
    if (
      !value.activeAttempts.every(validAttempt) ||
      !unique("scopeHash") ||
      !unique("requestHash") ||
      !unique("executionHash") ||
      expiresAtMs !==
        value.updatedAtMs + SCORER_CANDIDATE_RECEIPT_RETENTION_MS ||
      jsonBytes(value) > MAX_SCORER_CANDIDATE_LOCK_BYTES
    ) {
      return invalidState(snapshot, nowMs);
    }
    return expiresAtMs <= nowMs ? null : value;
  }

  function parseReceipt(snapshot, identityValue, nowMs) {
    if (!snapshot?.exists) return null;
    const value = snapshotData(snapshot);
    const common =
      isPlainObject(value) &&
      value.schemaVersion === 1 &&
      value.type === "diamond-scorer-candidate-receipt" &&
      value.logicalHash === identityValue.logicalHash &&
      SHA256_PATTERN.test(value.inputHash) &&
      SHA256_PATTERN.test(value.requestHash) &&
      Number.isSafeInteger(value.updatedAtMs) &&
      value.updatedAtMs >= 0 &&
      value.updatedAtMs <= nowMs;
    let baseTime = null;
    let valid = false;
    if (
      common &&
      value.status === "active" &&
      exactKeys(value, [
        "schemaVersion",
        "type",
        "logicalHash",
        "inputHash",
        "requestHash",
        "status",
        "executionHash",
        "startedAtMs",
        "leaseExpiresAtMs",
        "updatedAtMs",
        "expiresAt",
      ])
    ) {
      baseTime = value.startedAtMs;
      valid =
        SHA256_PATTERN.test(value.executionHash) &&
        Number.isSafeInteger(baseTime) &&
        baseTime === value.updatedAtMs &&
        value.leaseExpiresAtMs === baseTime + SCORER_CANDIDATE_REQUEST_LEASE_MS;
    } else if (
      common &&
      value.status === "failed" &&
      exactKeys(value, [
        "schemaVersion",
        "type",
        "logicalHash",
        "inputHash",
        "requestHash",
        "status",
        "executionHash",
        "finishedAtMs",
        "failureCode",
        "updatedAtMs",
        "expiresAt",
      ])
    ) {
      baseTime = value.finishedAtMs;
      valid =
        SHA256_PATTERN.test(value.executionHash) &&
        Number.isSafeInteger(baseTime) &&
        baseTime === value.updatedAtMs &&
        typeof value.failureCode === "string" &&
        value.failureCode.length > 0 &&
        value.failureCode.length <= 64;
    } else if (
      common &&
      value.status === "complete" &&
      exactKeys(value, [
        "schemaVersion",
        "type",
        "logicalHash",
        "inputHash",
        "requestHash",
        "status",
        "executionHash",
        "finishedAtMs",
        "responseHash",
        "candidates",
        "replayStatus",
        "replayExecutionHash",
        "updatedAtMs",
        "expiresAt",
      ])
    ) {
      baseTime = value.finishedAtMs;
      valid =
        SHA256_PATTERN.test(value.executionHash) &&
        Number.isSafeInteger(baseTime) &&
        baseTime >= 0 &&
        baseTime <= value.updatedAtMs &&
        SHA256_PATTERN.test(value.responseHash) &&
        validCandidates(value.candidates) &&
        ["available", "active", "completed", "failed"].includes(
          value.replayStatus,
        ) &&
        (value.replayStatus === "available"
          ? value.replayExecutionHash === null
          : SHA256_PATTERN.test(value.replayExecutionHash));
    }
    const expiresAtMs = timestampMs(value?.expiresAt);
    if (
      !valid ||
      expiresAtMs !== baseTime + SCORER_CANDIDATE_RECEIPT_RETENTION_MS ||
      value.updatedAtMs >= expiresAtMs ||
      jsonBytes(value) > MAX_SCORER_CANDIDATE_RECEIPT_BYTES
    ) {
      return invalidState(snapshot, nowMs);
    }
    return expiresAtMs <= nowMs ? null : value;
  }

  function liveAttempts(lock, nowMs) {
    return (lock?.activeAttempts || []).filter(
      (entry) => entry.leaseExpiresAtMs > nowMs,
    );
  }

  function comparableAttempt(entry) {
    return {
      kind: entry.kind,
      scopeHash: entry.scopeHash,
      requestHash: entry.requestHash,
      inputHash: entry.inputHash,
      executionHash: entry.executionHash,
      startedAtMs: entry.startedAtMs,
      leaseExpiresAtMs: entry.leaseExpiresAtMs,
    };
  }

  function assertLockPair(globalLock, scopeLock, identityValue, nowMs) {
    const sort = (entries) =>
      entries
        .map(comparableAttempt)
        .sort((left, right) =>
          left.executionHash.localeCompare(right.executionHash),
        );
    const globalScope = sort(
      liveAttempts(globalLock, nowMs).filter(
        (entry) => entry.scopeHash === identityValue.scopeHash,
      ),
    );
    const scope = sort(liveAttempts(scopeLock, nowMs));
    if (JSON.stringify(globalScope) !== JSON.stringify(scope)) {
      throw error(
        "scorer-candidate-admission-unconfirmed",
        "Scorer candidate admission could not be reconciled.",
      );
    }
  }

  async function readState(transaction, identityValue, nowMs) {
    let snapshots;
    try {
      snapshots = await Promise.all([
        transaction.get(identityValue.globalLockRef),
        transaction.get(identityValue.scopeLockRef),
        transaction.get(identityValue.receiptRef),
      ]);
    } catch {
      throw error(
        "scorer-candidate-admission-read-failed",
        "Scorer candidate admission could not be verified.",
      );
    }
    const globalLock = parseLock(
      snapshots[0],
      lockOptions(identityValue, true),
      nowMs,
    );
    const scopeLock = parseLock(
      snapshots[1],
      lockOptions(identityValue, false),
      nowMs,
    );
    const receipt = parseReceipt(snapshots[2], identityValue, nowMs);
    assertLockPair(globalLock, scopeLock, identityValue, nowMs);
    return { globalLock, scopeLock, receipt };
  }

  function lockValue(type, bindingHash, activeAttempts, nowMs) {
    const value = {
      schemaVersion: 1,
      type,
      bindingHash,
      activeAttempts,
      updatedAtMs: nowMs,
      expiresAt: new Date(nowMs + SCORER_CANDIDATE_RECEIPT_RETENTION_MS),
    };
    if (jsonBytes(value) > MAX_SCORER_CANDIDATE_LOCK_BYTES) {
      throw error(
        "scorer-candidate-lock-overflow",
        "Scorer candidate admission overflowed.",
      );
    }
    return value;
  }

  function activeEntry(identityValue, kind, nowMs, leaseExpiresAtMs) {
    return {
      kind,
      scopeHash: identityValue.scopeHash,
      requestHash: identityValue.requestHash,
      inputHash: identityValue.inputHash,
      executionHash: identityValue.executionHash,
      startedAtMs: nowMs,
      leaseExpiresAtMs:
        leaseExpiresAtMs ?? nowMs + SCORER_CANDIDATE_REQUEST_LEASE_MS,
    };
  }

  function writeLocks(transaction, identityValue, state, nowMs, entry = null) {
    const withoutCurrent = (lock) =>
      liveAttempts(lock, nowMs).filter(
        (attempt) => attempt.executionHash !== identityValue.executionHash,
      );
    const globalAttempts = withoutCurrent(state.globalLock);
    const scopeAttempts = withoutCurrent(state.scopeLock);
    if (entry) {
      globalAttempts.push(entry);
      scopeAttempts.push(entry);
    }
    globalAttempts.sort((left, right) =>
      left.executionHash.localeCompare(right.executionHash),
    );
    transaction.set(
      identityValue.globalLockRef,
      lockValue(
        "diamond-scorer-candidate-global-lock",
        identityValue.callerHash,
        globalAttempts,
        nowMs,
      ),
    );
    transaction.set(
      identityValue.scopeLockRef,
      lockValue(
        "diamond-scorer-candidate-scope-lock",
        identityValue.scopeHash,
        scopeAttempts,
        nowMs,
      ),
    );
  }

  function receiptValue(identityValue, status, nowMs, details = {}) {
    const common = {
      schemaVersion: 1,
      type: "diamond-scorer-candidate-receipt",
      logicalHash: identityValue.logicalHash,
      inputHash: identityValue.inputHash,
      requestHash: identityValue.requestHash,
      status,
      executionHash: identityValue.executionHash,
    };
    let value;
    if (status === "active") {
      value = {
        ...common,
        startedAtMs: nowMs,
        leaseExpiresAtMs: nowMs + SCORER_CANDIDATE_REQUEST_LEASE_MS,
        updatedAtMs: nowMs,
        expiresAt: new Date(nowMs + SCORER_CANDIDATE_RECEIPT_RETENTION_MS),
      };
    } else if (status === "failed") {
      value = {
        ...common,
        finishedAtMs: nowMs,
        failureCode:
          String(details.failureCode || "scorer-candidate-failed")
            .replace(/\s+/g, " ")
            .trim()
            .slice(0, 64) || "scorer-candidate-failed",
        updatedAtMs: nowMs,
        expiresAt: new Date(nowMs + SCORER_CANDIDATE_RECEIPT_RETENTION_MS),
      };
    } else {
      value = {
        ...common,
        finishedAtMs: nowMs,
        responseHash: details.responseHash,
        candidates: details.candidates,
        replayStatus: "available",
        replayExecutionHash: null,
        updatedAtMs: nowMs,
        expiresAt: new Date(nowMs + SCORER_CANDIDATE_RECEIPT_RETENTION_MS),
      };
    }
    if (jsonBytes(value) > MAX_SCORER_CANDIDATE_RECEIPT_BYTES) {
      throw error(
        "scorer-candidate-receipt-overflow",
        "The scorer candidate response exceeds its private receipt bound.",
        "failed-precondition",
        false,
      );
    }
    return value;
  }

  function receiptMatches(receipt, identityValue) {
    return (
      receipt.inputHash === identityValue.inputHash &&
      receipt.requestHash === identityValue.requestHash
    );
  }

  function rateReservations(identityValue, nowMs) {
    return limits.map(([boundary, hashKey, prepare]) =>
      prepare(
        `diamond-scorer-candidate:v1:${boundary}:${identityValue[hashKey]}`,
        nowMs,
        identityValue.executionHash,
      ),
    );
  }

  async function readRateDecisions(transaction, identityValue, nowMs) {
    const reservations = rateReservations(identityValue, nowMs);
    let snapshots;
    try {
      snapshots = await Promise.all(
        reservations.map(({ ref }) => transaction.get(ref)),
      );
    } catch {
      throw error(
        "scorer-candidate-rate-read-failed",
        "Scorer candidate admission could not be verified.",
      );
    }
    return {
      reservations,
      decisions: reservations.map((reservation, index) =>
        reservation.evaluate(snapshots[index]),
      ),
    };
  }

  async function reserveTransaction(
    transaction,
    request,
    callerUid,
    executionId,
    nowMs,
  ) {
    const identityValue = identity(request, callerUid, executionId);
    const state = await readState(transaction, identityValue, nowMs);
    const receipt = state.receipt;
    if (receipt && !receiptMatches(receipt, identityValue)) {
      throw error(
        "scorer-candidate-request-conflict",
        "The scorer candidate request ID was already used for another request.",
        "failed-precondition",
        false,
      );
    }
    const globalAttempts = liveAttempts(state.globalLock, nowMs);
    const scopeAttempts = liveAttempts(state.scopeLock, nowMs);
    const matching = scopeAttempts.find(
      (entry) => entry.requestHash === identityValue.requestHash,
    );
    const current = scopeAttempts.find(
      (entry) => entry.executionHash === identityValue.executionHash,
    );
    if (receipt?.status === "active" && receipt.leaseExpiresAtMs > nowMs) {
      if (
        receipt.executionHash === identityValue.executionHash &&
        current?.kind === "execute" &&
        current.requestHash === identityValue.requestHash &&
        current.inputHash === identityValue.inputHash
      ) {
        const rates = await readRateDecisions(
          transaction,
          identityValue,
          nowMs,
        );
        if (
          rates.decisions.every(
            (decision) => decision.allowed && decision.nextValue === null,
          )
        ) {
          return Object.freeze({
            kind: "execute",
            identity: identityValue,
            request,
          });
        }
        throw error(
          "scorer-candidate-admission-unconfirmed",
          "Scorer candidate admission could not be reconciled.",
        );
      }
      if (
        !matching ||
        matching.kind !== "execute" ||
        matching.inputHash !== identityValue.inputHash ||
        matching.executionHash !== receipt.executionHash
      ) {
        throw error(
          "scorer-candidate-admission-unconfirmed",
          "Scorer candidate admission could not be reconciled.",
        );
      }
      throw error(
        "scorer-candidate-duplicate-active",
        "This scorer candidate request is already active.",
        "resource-exhausted",
      );
    }
    if (receipt?.status === "complete" && receipt.replayStatus === "active") {
      if (
        receipt.replayExecutionHash === identityValue.executionHash &&
        current?.kind === "replay" &&
        current.requestHash === identityValue.requestHash &&
        current.inputHash === identityValue.inputHash
      ) {
        return Object.freeze({
          kind: "replay",
          identity: identityValue,
          request,
        });
      }
      if (
        !matching ||
        matching.kind !== "replay" ||
        matching.inputHash !== identityValue.inputHash ||
        matching.executionHash !== receipt.replayExecutionHash
      ) {
        throw error(
          "scorer-candidate-replay-unconfirmed",
          "Scorer candidate response recovery could not be reconciled.",
        );
      }
      throw error(
        "scorer-candidate-duplicate-active",
        "This scorer candidate response recovery is already active.",
        "resource-exhausted",
      );
    }
    if (matching) {
      throw error(
        "scorer-candidate-admission-unconfirmed",
        "Scorer candidate admission could not be reconciled.",
      );
    }
    if (
      receipt?.status === "complete" &&
      receipt.replayStatus !== "available"
    ) {
      throw error(
        "scorer-candidate-replay-limited",
        "The scorer candidate response recovery was already used.",
        "resource-exhausted",
        false,
      );
    }
    if (
      scopeAttempts.some((entry) => entry.inputHash === identityValue.inputHash)
    ) {
      throw error(
        "scorer-candidate-duplicate-active",
        "This scorer candidate request is already loading.",
        "resource-exhausted",
      );
    }
    if (scopeAttempts.length >= MAX_CONCURRENT_SCORER_CANDIDATE_REQUESTS) {
      throw error(
        "scorer-candidate-concurrency-limited",
        "Too many scorer candidate reads are active for this game.",
        "resource-exhausted",
      );
    }
    if (
      globalAttempts.length >= MAX_CONCURRENT_SCORER_CANDIDATE_GLOBAL_REQUESTS
    ) {
      throw error(
        "scorer-candidate-global-concurrency-limited",
        "Too many scorer candidate reads are active for this account.",
        "resource-exhausted",
      );
    }
    const receiptExpiresAtMs = receipt ? timestampMs(receipt.expiresAt) : null;
    if (
      receipt?.status === "complete" &&
      receiptExpiresAtMs <= nowMs + SCORER_CANDIDATE_CALLABLE_ENVELOPE_MS
    ) {
      throw error(
        "scorer-candidate-replay-expiring",
        "The scorer candidate response is too near expiry to recover safely.",
        "resource-exhausted",
        false,
      );
    }
    const entryKind = receipt?.status === "complete" ? "replay" : "execute";
    const entry = activeEntry(
      identityValue,
      entryKind,
      nowMs,
      entryKind === "replay"
        ? Math.min(
            nowMs + SCORER_CANDIDATE_REQUEST_LEASE_MS,
            receiptExpiresAtMs,
          )
        : null,
    );
    if (entryKind === "replay") {
      writeLocks(transaction, identityValue, state, nowMs, entry);
      transaction.set(identityValue.receiptRef, {
        ...receipt,
        replayStatus: "active",
        replayExecutionHash: identityValue.executionHash,
        updatedAtMs: nowMs,
      });
    } else {
      const rates = await readRateDecisions(transaction, identityValue, nowMs);
      const denied = rates.decisions.filter((decision) => !decision.allowed);
      if (denied.length) {
        throw makeError(
          "resource-exhausted",
          "Scorer candidate reads are temporarily limited.",
          {
            reason: "scorer-candidate-rate-limited",
            retryable: true,
            retryAfterSeconds: Math.max(
              ...denied.map((decision) => decision.retryAfterSeconds),
            ),
          },
        );
      }
      rates.reservations.forEach((reservation, index) =>
        reservation.commit(transaction, rates.decisions[index]),
      );
      writeLocks(transaction, identityValue, state, nowMs, entry);
      transaction.set(
        identityValue.receiptRef,
        receiptValue(identityValue, "active", nowMs),
      );
    }
    return Object.freeze({
      kind: entryKind,
      identity: identityValue,
      request,
    });
  }

  async function reconcile(label, callback) {
    let lastError;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        return await firestore.runTransaction(callback, { maxAttempts: 1 });
      } catch (caught) {
        if (
          caught?.name === "HttpsError" ||
          caught?.name === "DiamondHandlerError"
        ) {
          throw caught;
        }
        lastError = caught;
      }
    }
    logger.error?.(`diamond_scorer_candidate_${label}_unconfirmed`, {
      code: lastError?.code || "transaction-failed",
    });
    throw error(
      `scorer-candidate-${label}-unconfirmed`,
      "Scorer candidate safety state could not be confirmed. Try again.",
    );
  }

  function responseHash(identityValue, candidates) {
    return hash({
      schemaVersion: 1,
      type: "diamond-scorer-candidate-response",
      requestHash: identityValue.requestHash,
      candidates,
    });
  }

  function exactActive(state, identityValue, kind, nowMs) {
    const global = liveAttempts(state.globalLock, nowMs).find(
      (entry) => entry.executionHash === identityValue.executionHash,
    );
    const scope = liveAttempts(state.scopeLock, nowMs).find(
      (entry) => entry.executionHash === identityValue.executionHash,
    );
    if (Boolean(global) !== Boolean(scope)) {
      throw error(
        "scorer-candidate-admission-unconfirmed",
        "Scorer candidate admission could not be reconciled.",
      );
    }
    if (!global && !scope) return null;
    const valid =
      global.kind === kind &&
      scope.kind === kind &&
      global.scopeHash === identityValue.scopeHash &&
      scope.scopeHash === identityValue.scopeHash &&
      global.requestHash === identityValue.requestHash &&
      scope.requestHash === identityValue.requestHash &&
      global.inputHash === identityValue.inputHash &&
      scope.inputHash === identityValue.inputHash;
    if (!valid) {
      throw error(
        "scorer-candidate-admission-unconfirmed",
        "Scorer candidate admission could not be reconciled.",
      );
    }
    return scope;
  }

  async function complete({ reservation, candidates, authorize }) {
    if (reservation?.kind !== "execute" || typeof authorize !== "function") {
      throw new TypeError("A fresh scorer candidate reservation is required.");
    }
    const storedCandidates = candidates.map((candidate) => ({
      playerId: candidate?.playerId,
      name: candidate?.name,
    }));
    if (!validCandidates(storedCandidates)) {
      throw error(
        "scorer-candidate-response-invalid",
        "Scorer candidate response is invalid.",
      );
    }
    const expectedResponseHash = responseHash(
      reservation.identity,
      storedCandidates,
    );
    return reconcile("completion", async (transaction) => {
      const nowMs = now();
      const state = await readState(transaction, reservation.identity, nowMs);
      const receipt = state.receipt;
      if (!receipt || !receiptMatches(receipt, reservation.identity)) {
        throw error(
          "scorer-candidate-completion-unconfirmed",
          "Scorer candidate completion could not be reconciled.",
        );
      }
      const active = exactActive(state, reservation.identity, "execute", nowMs);
      if (receipt.status === "complete" && !active) {
        if (
          receipt.executionHash === reservation.identity.executionHash &&
          receipt.responseHash === expectedResponseHash &&
          JSON.stringify(receipt.candidates) ===
            JSON.stringify(storedCandidates)
        ) {
          return;
        }
        throw error(
          "scorer-candidate-completion-unconfirmed",
          "Scorer candidate completion could not be reconciled.",
        );
      }
      if (
        receipt.status !== "active" ||
        receipt.executionHash !== reservation.identity.executionHash ||
        !active
      ) {
        throw error(
          "scorer-candidate-reservation-lost",
          "The scorer candidate reservation expired. Try again.",
          "aborted",
        );
      }
      await authorize(transaction);
      writeLocks(transaction, reservation.identity, state, nowMs);
      transaction.set(
        reservation.identity.receiptRef,
        receiptValue(reservation.identity, "complete", nowMs, {
          responseHash: expectedResponseHash,
          candidates: storedCandidates,
        }),
      );
    });
  }

  async function replay({ reservation, authorize }) {
    if (reservation?.kind !== "replay" || typeof authorize !== "function") {
      throw new TypeError("A scorer candidate replay reservation is required.");
    }
    return reconcile("replay", async (transaction) => {
      const nowMs = now();
      const state = await readState(transaction, reservation.identity, nowMs);
      const receipt = state.receipt;
      if (
        !receipt ||
        !receiptMatches(receipt, reservation.identity) ||
        receipt.status !== "complete" ||
        receipt.replayExecutionHash !== reservation.identity.executionHash ||
        receipt.responseHash !==
          responseHash(reservation.identity, receipt.candidates)
      ) {
        throw error(
          "scorer-candidate-replay-unconfirmed",
          "Scorer candidate response recovery could not be reconciled.",
        );
      }
      const active = exactActive(state, reservation.identity, "replay", nowMs);
      if (receipt.replayStatus === "completed" && !active) {
        return receipt.candidates;
      }
      if (receipt.replayStatus !== "active" || !active) {
        throw error(
          "scorer-candidate-replay-unconfirmed",
          "Scorer candidate response recovery could not be reconciled.",
        );
      }
      await authorize(transaction);
      writeLocks(transaction, reservation.identity, state, nowMs);
      transaction.set(reservation.identity.receiptRef, {
        ...receipt,
        replayStatus: "completed",
        updatedAtMs: nowMs,
      });
      return receipt.candidates;
    });
  }

  async function fail({ reservation, failureCode }) {
    let lastError;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        await firestore.runTransaction(
          async (transaction) => {
            const nowMs = now();
            const state = await readState(
              transaction,
              reservation.identity,
              nowMs,
            );
            const receipt = state.receipt;
            const active = exactActive(
              state,
              reservation.identity,
              reservation.kind,
              nowMs,
            );
            if (!active) return;
            if (
              !receipt ||
              !receiptMatches(receipt, reservation.identity) ||
              (reservation.kind === "execute"
                ? receipt.status !== "active" ||
                  receipt.executionHash !== reservation.identity.executionHash
                : receipt.status !== "complete" ||
                  receipt.replayStatus !== "active" ||
                  receipt.replayExecutionHash !==
                    reservation.identity.executionHash)
            ) {
              throw error(
                "scorer-candidate-failure-unconfirmed",
                "Scorer candidate failure state could not be reconciled.",
              );
            }
            writeLocks(transaction, reservation.identity, state, nowMs);
            transaction.set(
              reservation.identity.receiptRef,
              reservation.kind === "execute"
                ? receiptValue(reservation.identity, "failed", nowMs, {
                    failureCode,
                  })
                : {
                    ...receipt,
                    replayStatus: "failed",
                    updatedAtMs: nowMs,
                  },
            );
          },
          { maxAttempts: 1 },
        );
        return;
      } catch (caught) {
        lastError = caught;
      }
    }
    logger.error?.("diamond_scorer_candidate_failure_unconfirmed", {
      code: lastError?.code || "transaction-failed",
    });
  }

  return Object.freeze({
    reserve({ request, callerUid, executionId }) {
      const reservationNowMs = now();
      return reconcile("reservation", (transaction) =>
        reserveTransaction(
          transaction,
          request,
          callerUid,
          executionId,
          reservationNowMs,
        ),
      );
    },
    complete,
    replay,
    fail,
  });
}

module.exports = {
  MAX_CONCURRENT_SCORER_CANDIDATE_GLOBAL_REQUESTS,
  MAX_CONCURRENT_SCORER_CANDIDATE_REQUESTS,
  MAX_SCORER_CANDIDATE_GLOBAL_REQUESTS_PER_WINDOW,
  MAX_SCORER_CANDIDATE_GLOBAL_SUSTAINED_REQUESTS_PER_WINDOW,
  MAX_SCORER_CANDIDATE_LOCK_BYTES,
  MAX_SCORER_CANDIDATE_RECEIPT_BYTES,
  MAX_SCORER_CANDIDATE_REQUESTS_PER_WINDOW,
  MAX_SCORER_CANDIDATE_SUSTAINED_REQUESTS_PER_WINDOW,
  SCORER_CANDIDATE_CONTROL_QUARANTINE_MS,
  SCORER_CANDIDATE_CALLABLE_ENVELOPE_MS,
  SCORER_CANDIDATE_RATE_WINDOW_MS,
  SCORER_CANDIDATE_RECEIPT_RETENTION_MS,
  SCORER_CANDIDATE_REQUEST_LEASE_MS,
  SCORER_CANDIDATE_SUSTAINED_WINDOW_MS,
  createDiamondScorerCandidateAdmission,
};
