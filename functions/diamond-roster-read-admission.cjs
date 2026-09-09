"use strict";

const {
  createFirestoreFixedWindowRateLimitReservation,
} = require("./rate-limit.cjs");

const DIAMOND_ROSTER_READ_RATE_WINDOW_MS = 60 * 1000;
const DIAMOND_ROSTER_READ_SUSTAINED_WINDOW_MS = 10 * 60 * 1000;
const DIAMOND_ROSTER_READ_LEASE_MS = 3 * 60 * 1000;
const DIAMOND_ROSTER_READ_TERMINAL_RETENTION_MS = 5 * 60 * 1000;
const DIAMOND_ROSTER_READ_CONTROL_QUARANTINE_MS =
  DIAMOND_ROSTER_READ_SUSTAINED_WINDOW_MS;
const MAX_DIAMOND_ROSTER_READS_PER_WINDOW = 32;
const MAX_DIAMOND_ROSTER_SUSTAINED_READS_PER_WINDOW = 256;
const MAX_CONCURRENT_DIAMOND_ROSTER_READS = 2;
const MAX_DIAMOND_ROSTER_READ_TERMINALS = 8;
const MAX_DIAMOND_ROSTER_READ_CONTROL_BYTES = 16 * 1024;
const MAX_DIAMOND_ROSTER_READ_INPUT_BYTES = 8 * 1024;
// State is loaded on initial entry/manual refresh, report open/close, and
// bounded recovery; voice parsing uses the same service retry envelope. The
// burst admits sixteen worst-case two-attempt actions in one minute, while the
// sustained window prevents that burst from continuing indefinitely. Aligned
// fixed-window boundaries can double those request totals, but the durable
// two-request lease still caps simultaneous work for one UID/team/game.
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

function timestampMs(value) {
  const milliseconds =
    value instanceof Date ? value.getTime() : value?.toMillis?.();
  return Number.isSafeInteger(milliseconds) && milliseconds >= 0
    ? milliseconds
    : null;
}

function jsonBytes(value) {
  try {
    return Buffer.byteLength(JSON.stringify(value), "utf8");
  } catch {
    return Number.POSITIVE_INFINITY;
  }
}

function snapshotData(snapshot) {
  return snapshot?.exists === true && typeof snapshot.data === "function"
    ? snapshot.data()
    : null;
}

function snapshotUpdatedAtMs(snapshot) {
  return timestampMs(snapshot?.updateTime);
}

function createDiamondRosterReadAdmission({
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
    throw new TypeError(
      "Diamond roster read admission dependencies are invalid.",
    );
  }
  if (typeof collectionName !== "string" || !collectionName.trim()) {
    throw new TypeError(
      "Diamond roster read admission collection is required.",
    );
  }
  const controls = collectionName.trim();
  const prepareBurst = createFirestoreFixedWindowRateLimitReservation({
    firestore,
    collectionName: controls,
    windowMs: DIAMOND_ROSTER_READ_RATE_WINDOW_MS,
    maxRequests: MAX_DIAMOND_ROSTER_READS_PER_WINDOW,
  });
  const prepareSustained = createFirestoreFixedWindowRateLimitReservation({
    firestore,
    collectionName: controls,
    windowMs: DIAMOND_ROSTER_READ_SUSTAINED_WINDOW_MS,
    maxRequests: MAX_DIAMOND_ROSTER_SUSTAINED_READS_PER_WINDOW,
  });

  function error(
    reason,
    message,
    code = "unavailable",
    retryable = true,
    details = {},
  ) {
    return makeError(code, message, { reason, retryable, ...details });
  }

  function now() {
    let value;
    try {
      value = clock();
    } catch {
      value = null;
    }
    if (!Number.isSafeInteger(value) || value < 0) {
      throw error(
        "diamond-roster-read-time-unavailable",
        "Diamond roster read admission time is unavailable.",
      );
    }
    return value;
  }

  function hash(value) {
    let result;
    try {
      result = hashValue(value);
    } catch {
      result = null;
    }
    if (typeof result !== "string" || !SHA256_PATTERN.test(result)) {
      throw error(
        "diamond-roster-read-identity-unavailable",
        "Diamond roster read admission could not be identified.",
      );
    }
    return result;
  }

  function identity({
    callerUid,
    teamId,
    gameId,
    operation,
    sourceRevision,
    input,
    attemptId,
  }) {
    if (
      !validId(callerUid) ||
      !validId(teamId) ||
      !validId(gameId) ||
      !["state", "voice"].includes(operation) ||
      !Number.isSafeInteger(sourceRevision) ||
      sourceRevision < 0 ||
      sourceRevision > 20_000 ||
      !isPlainObject(input) ||
      jsonBytes(input) > MAX_DIAMOND_ROSTER_READ_INPUT_BYTES ||
      typeof attemptId !== "string" ||
      !UUID_V4_PATTERN.test(attemptId)
    ) {
      throw error(
        "diamond-roster-read-identity-invalid",
        "Diamond roster read admission identity is invalid.",
        "invalid-argument",
        false,
      );
    }
    const scopeHash = hash({
      schemaVersion: 1,
      type: "diamond-roster-read-scope",
      callerUid,
      teamId,
      gameId,
    });
    const inputHash = hash({
      schemaVersion: 1,
      type: "diamond-roster-read-input",
      scopeHash,
      operation,
      sourceRevision,
      input,
    });
    const attemptHash = hash({
      schemaVersion: 1,
      type: "diamond-roster-read-attempt",
      attemptId: attemptId.toLowerCase(),
    });
    return Object.freeze({
      scopeHash,
      inputHash,
      attemptHash,
      lockRef: firestore.doc(
        `${controls}/roster-read-lock-${scopeHash.slice(7)}`,
      ),
    });
  }

  function invalidLock(snapshot, nowMs) {
    const updatedAtMs = snapshotUpdatedAtMs(snapshot);
    if (
      updatedAtMs !== null &&
      updatedAtMs + DIAMOND_ROSTER_READ_CONTROL_QUARANTINE_MS <= nowMs
    ) {
      return { activeAttempts: [], recentTerminals: [] };
    }
    throw error(
      "diamond-roster-read-control-invalid",
      "Diamond roster read admission is temporarily unavailable.",
    );
  }

  function parseLock(snapshot, identityValue, nowMs) {
    if (snapshot?.exists !== true) {
      return { activeAttempts: [], recentTerminals: [] };
    }
    const value = snapshotData(snapshot);
    const validTopLevel = exactKeys(value, [
      "schemaVersion",
      "type",
      "scopeHash",
      "activeAttempts",
      "recentTerminals",
      "updatedAtMs",
      "expiresAt",
    ]);
    if (!validTopLevel) return invalidLock(snapshot, nowMs);
    const expiresAtMs = timestampMs(value.expiresAt);
    if (
      value.schemaVersion !== 1 ||
      value.type !== "diamond-roster-read-lock" ||
      value.scopeHash !== identityValue.scopeHash ||
      !Array.isArray(value.activeAttempts) ||
      value.activeAttempts.length > MAX_CONCURRENT_DIAMOND_ROSTER_READS ||
      !Array.isArray(value.recentTerminals) ||
      value.recentTerminals.length > MAX_DIAMOND_ROSTER_READ_TERMINALS ||
      !Number.isSafeInteger(value.updatedAtMs) ||
      value.updatedAtMs < 0 ||
      value.updatedAtMs > nowMs ||
      expiresAtMs !==
        value.updatedAtMs + DIAMOND_ROSTER_READ_CONTROL_QUARANTINE_MS ||
      jsonBytes(value) > MAX_DIAMOND_ROSTER_READ_CONTROL_BYTES
    ) {
      return invalidLock(snapshot, nowMs);
    }
    const activeAttempts = [];
    for (const entry of value.activeAttempts) {
      if (
        !exactKeys(entry, [
          "attemptHash",
          "inputHash",
          "startedAtMs",
          "leaseExpiresAtMs",
        ]) ||
        typeof entry.attemptHash !== "string" ||
        !SHA256_PATTERN.test(entry.attemptHash) ||
        typeof entry.inputHash !== "string" ||
        !SHA256_PATTERN.test(entry.inputHash) ||
        !Number.isSafeInteger(entry.startedAtMs) ||
        entry.startedAtMs < 0 ||
        entry.startedAtMs > value.updatedAtMs ||
        entry.leaseExpiresAtMs !==
          entry.startedAtMs + DIAMOND_ROSTER_READ_LEASE_MS
      ) {
        return invalidLock(snapshot, nowMs);
      }
      activeAttempts.push(entry);
    }
    const recentTerminals = [];
    for (const entry of value.recentTerminals) {
      if (
        !exactKeys(entry, [
          "attemptHash",
          "inputHash",
          "status",
          "finishedAtMs",
        ]) ||
        typeof entry.attemptHash !== "string" ||
        !SHA256_PATTERN.test(entry.attemptHash) ||
        typeof entry.inputHash !== "string" ||
        !SHA256_PATTERN.test(entry.inputHash) ||
        !["complete", "failed"].includes(entry.status) ||
        !Number.isSafeInteger(entry.finishedAtMs) ||
        entry.finishedAtMs < 0 ||
        entry.finishedAtMs > value.updatedAtMs
      ) {
        return invalidLock(snapshot, nowMs);
      }
      recentTerminals.push(entry);
    }
    const activeAttemptHashes = activeAttempts.map(
      ({ attemptHash }) => attemptHash,
    );
    const activeInputHashes = activeAttempts.map(({ inputHash }) => inputHash);
    const terminalAttemptHashes = recentTerminals.map(
      ({ attemptHash }) => attemptHash,
    );
    if (
      new Set(activeAttemptHashes).size !== activeAttemptHashes.length ||
      new Set(activeInputHashes).size !== activeInputHashes.length ||
      new Set(terminalAttemptHashes).size !== terminalAttemptHashes.length ||
      activeAttemptHashes.some((attemptHash) =>
        terminalAttemptHashes.includes(attemptHash),
      )
    ) {
      return invalidLock(snapshot, nowMs);
    }
    if (expiresAtMs <= nowMs) {
      return { activeAttempts: [], recentTerminals: [] };
    }
    return { activeAttempts, recentTerminals };
  }

  function liveAttempts(lock, nowMs) {
    return lock.activeAttempts.filter(
      ({ leaseExpiresAtMs }) => leaseExpiresAtMs > nowMs,
    );
  }

  function retainedTerminals(lock, nowMs) {
    return lock.recentTerminals.filter(
      ({ finishedAtMs }) =>
        finishedAtMs + DIAMOND_ROSTER_READ_TERMINAL_RETENTION_MS > nowMs,
    );
  }

  function lockValue(identityValue, activeAttempts, recentTerminals, nowMs) {
    const value = {
      schemaVersion: 1,
      type: "diamond-roster-read-lock",
      scopeHash: identityValue.scopeHash,
      activeAttempts: [...activeAttempts].sort((left, right) =>
        left.attemptHash.localeCompare(right.attemptHash),
      ),
      recentTerminals: [...recentTerminals]
        .sort(
          (left, right) =>
            left.finishedAtMs - right.finishedAtMs ||
            left.attemptHash.localeCompare(right.attemptHash),
        )
        .slice(-MAX_DIAMOND_ROSTER_READ_TERMINALS),
      updatedAtMs: nowMs,
      expiresAt: new Date(nowMs + DIAMOND_ROSTER_READ_CONTROL_QUARANTINE_MS),
    };
    if (jsonBytes(value) > MAX_DIAMOND_ROSTER_READ_CONTROL_BYTES) {
      throw error(
        "diamond-roster-read-control-overflow",
        "Diamond roster read admission overflowed.",
      );
    }
    return value;
  }

  function activeEntry(identityValue, nowMs) {
    return {
      attemptHash: identityValue.attemptHash,
      inputHash: identityValue.inputHash,
      startedAtMs: nowMs,
      leaseExpiresAtMs: nowMs + DIAMOND_ROSTER_READ_LEASE_MS,
    };
  }

  function terminalEntry(identityValue, status, nowMs) {
    return {
      attemptHash: identityValue.attemptHash,
      inputHash: identityValue.inputHash,
      status,
      finishedAtMs: nowMs,
    };
  }

  function exactAttempt(lock, identityValue) {
    const attempt = lock.activeAttempts.find(
      ({ attemptHash }) => attemptHash === identityValue.attemptHash,
    );
    if (attempt && attempt.inputHash !== identityValue.inputHash) {
      throw error(
        "diamond-roster-read-admission-unconfirmed",
        "Diamond roster read admission could not be reconciled.",
      );
    }
    return attempt || null;
  }

  function exactTerminal(lock, identityValue) {
    const terminal = lock.recentTerminals.find(
      ({ attemptHash }) => attemptHash === identityValue.attemptHash,
    );
    if (terminal && terminal.inputHash !== identityValue.inputHash) {
      throw error(
        "diamond-roster-read-admission-unconfirmed",
        "Diamond roster read admission could not be reconciled.",
      );
    }
    return terminal || null;
  }

  function rateReservations(identityValue, nowMs) {
    return [
      prepareBurst(
        `diamond-roster-read:v1:burst:${identityValue.scopeHash}`,
        nowMs,
        identityValue.attemptHash,
      ),
      prepareSustained(
        `diamond-roster-read:v1:sustained:${identityValue.scopeHash}`,
        nowMs,
        identityValue.attemptHash,
      ),
    ];
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
    logger.error?.(`diamond_roster_read_${label}_unconfirmed`, {
      code: lastError?.code || "transaction-failed",
    });
    throw error(
      `diamond-roster-read-${label}-unconfirmed`,
      "Diamond roster read safety state could not be confirmed. Try again.",
    );
  }

  function reservation(identityValue) {
    return Object.freeze({
      kind: "diamond-roster-read",
      identity: identityValue,
    });
  }

  function requireReservation(value) {
    const identityValue = value?.identity;
    if (
      value?.kind !== "diamond-roster-read" ||
      !identityValue?.lockRef ||
      !SHA256_PATTERN.test(identityValue.scopeHash) ||
      !SHA256_PATTERN.test(identityValue.inputHash) ||
      !SHA256_PATTERN.test(identityValue.attemptHash)
    ) {
      throw new TypeError("A Diamond roster read reservation is required.");
    }
    return identityValue;
  }

  async function reserve(request) {
    const nowMs = now();
    const identityValue = identity(request);
    const rates = rateReservations(identityValue, nowMs);
    return reconcile("admission", async (transaction) => {
      let snapshots;
      try {
        snapshots = await Promise.all([
          transaction.get(identityValue.lockRef),
          ...rates.map(({ ref }) => transaction.get(ref)),
        ]);
      } catch {
        throw error(
          "diamond-roster-read-admission-read-failed",
          "Diamond roster read admission could not be verified.",
        );
      }
      const lock = parseLock(snapshots[0], identityValue, nowMs);
      const decisions = rates.map((rate, index) =>
        rate.evaluate(snapshots[index + 1]),
      );
      const activeAttempts = liveAttempts(lock, nowMs);
      const current = exactAttempt(lock, identityValue);
      if (current?.leaseExpiresAtMs > nowMs) {
        if (
          decisions.every(
            (decision) => decision.allowed && decision.nextValue === null,
          )
        ) {
          return reservation(identityValue);
        }
        throw error(
          "diamond-roster-read-admission-unconfirmed",
          "Diamond roster read admission could not be reconciled.",
        );
      }
      if (exactTerminal(lock, identityValue)) {
        throw error(
          "diamond-roster-read-admission-unconfirmed",
          "Diamond roster read admission could not be reconciled.",
        );
      }
      if (
        activeAttempts.some(
          ({ inputHash }) => inputHash === identityValue.inputHash,
        )
      ) {
        throw error(
          "diamond-roster-read-duplicate-active",
          "This Diamond roster read is already active.",
          "resource-exhausted",
        );
      }
      if (activeAttempts.length >= MAX_CONCURRENT_DIAMOND_ROSTER_READS) {
        throw error(
          "diamond-roster-read-concurrency-limited",
          "Too many Diamond roster reads are active for this game.",
          "resource-exhausted",
        );
      }
      const denied = decisions.filter((decision) => !decision.allowed);
      if (denied.length) {
        throw error(
          "diamond-roster-read-rate-limited",
          "Diamond roster reads are temporarily limited.",
          "resource-exhausted",
          true,
          {
            retryAfterSeconds: Math.max(
              ...denied.map(({ retryAfterSeconds }) => retryAfterSeconds),
            ),
          },
        );
      }
      rates.forEach((rate, index) =>
        rate.commit(transaction, decisions[index]),
      );
      transaction.set(
        identityValue.lockRef,
        lockValue(
          identityValue,
          [...activeAttempts, activeEntry(identityValue, nowMs)],
          retainedTerminals(lock, nowMs),
          nowMs,
        ),
      );
      return reservation(identityValue);
    });
  }

  async function complete({ reservation: value, authorize }) {
    if (typeof authorize !== "function") {
      throw new TypeError("Diamond roster read authorization is required.");
    }
    const identityValue = requireReservation(value);
    const nowMs = now();
    return reconcile("completion", async (transaction) => {
      let snapshot;
      try {
        snapshot = await transaction.get(identityValue.lockRef);
      } catch {
        throw error(
          "diamond-roster-read-completion-read-failed",
          "Diamond roster read completion could not be verified.",
        );
      }
      const lock = parseLock(snapshot, identityValue, nowMs);
      const active = exactAttempt(lock, identityValue);
      const terminal = exactTerminal(lock, identityValue);
      if (terminal) {
        if (terminal.status !== "complete" || active) {
          throw error(
            "diamond-roster-read-completion-unconfirmed",
            "Diamond roster read completion could not be reconciled.",
          );
        }
        return authorize(transaction);
      }
      if (!active || active.leaseExpiresAtMs <= nowMs) {
        throw error(
          "diamond-roster-read-reservation-lost",
          "The Diamond roster read reservation expired. Try again.",
          "aborted",
        );
      }
      const authorized = await authorize(transaction);
      transaction.set(
        identityValue.lockRef,
        lockValue(
          identityValue,
          liveAttempts(lock, nowMs).filter(
            ({ attemptHash }) => attemptHash !== identityValue.attemptHash,
          ),
          [
            ...retainedTerminals(lock, nowMs),
            terminalEntry(identityValue, "complete", nowMs),
          ],
          nowMs,
        ),
      );
      return authorized;
    });
  }

  async function fail({ reservation: value }) {
    const identityValue = requireReservation(value);
    const nowMs = now();
    return reconcile("release", async (transaction) => {
      let snapshot;
      try {
        snapshot = await transaction.get(identityValue.lockRef);
      } catch {
        throw error(
          "diamond-roster-read-release-read-failed",
          "Diamond roster read release could not be verified.",
        );
      }
      const lock = parseLock(snapshot, identityValue, nowMs);
      const active = exactAttempt(lock, identityValue);
      const terminal = exactTerminal(lock, identityValue);
      if (terminal) return;
      if (!active) return;
      transaction.set(
        identityValue.lockRef,
        lockValue(
          identityValue,
          liveAttempts(lock, nowMs).filter(
            ({ attemptHash }) => attemptHash !== identityValue.attemptHash,
          ),
          [
            ...retainedTerminals(lock, nowMs),
            terminalEntry(identityValue, "failed", nowMs),
          ],
          nowMs,
        ),
      );
    });
  }

  return Object.freeze({ reserve, complete, fail });
}

module.exports = {
  DIAMOND_ROSTER_READ_CONTROL_QUARANTINE_MS,
  DIAMOND_ROSTER_READ_LEASE_MS,
  DIAMOND_ROSTER_READ_RATE_WINDOW_MS,
  DIAMOND_ROSTER_READ_SUSTAINED_WINDOW_MS,
  DIAMOND_ROSTER_READ_TERMINAL_RETENTION_MS,
  MAX_CONCURRENT_DIAMOND_ROSTER_READS,
  MAX_DIAMOND_ROSTER_READ_CONTROL_BYTES,
  MAX_DIAMOND_ROSTER_READ_INPUT_BYTES,
  MAX_DIAMOND_ROSTER_READ_TERMINALS,
  MAX_DIAMOND_ROSTER_READS_PER_WINDOW,
  MAX_DIAMOND_ROSTER_SUSTAINED_READS_PER_WINDOW,
  createDiamondRosterReadAdmission,
};
