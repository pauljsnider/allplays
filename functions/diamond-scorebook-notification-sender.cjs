"use strict";

const nodeCrypto = require("node:crypto");

const DIAMOND_ENGINE = "diamond-v2";
const RECEIPT_SCHEMA_VERSION = 3;
const RECEIPT_STATUS_PROCESSING = "processing";
const RECEIPT_STATUS_COMPLETED = "completed";
const RECEIPT_STATUS_UNCERTAIN = "delivery-uncertain";
const RECEIPT_STATUS_RETRYABLE = "retryable-failure";
const DEFAULT_DELIVERY_LEASE_MILLIS = 2 * 60 * 1000;
const DEFAULT_RETRY_DELAY_MILLIS = 30 * 1000;
const UUID_V4_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const RECEIPT_STATUSES = new Set([
  RECEIPT_STATUS_PROCESSING,
  RECEIPT_STATUS_COMPLETED,
  RECEIPT_STATUS_UNCERTAIN,
  RECEIPT_STATUS_RETRYABLE,
]);
const PROVIDER_OUTCOMES = new Set([
  "sent",
  "partial",
  "failed",
  "no-recipients",
  "delivery-uncertain",
]);
const REQUEST_FIELDS = new Set([
  "teamId",
  "gameId",
  "instanceId",
  "sourceRevision",
  "sourceEventId",
  "title",
  "body",
  "category",
  "liveViewerLink",
  "link",
  "viewerTeamId",
  "viewerGameId",
  "sharedGamePath",
  "dedupKey",
  "idempotencyKey",
]);

class DiamondNotificationSenderError extends Error {
  constructor(code, message, options = {}) {
    super(message);
    this.name = "DiamondNotificationSenderError";
    this.code = code;
    this.retryable = options.retryable === true;
    this.details = options.details;
  }
}

function isPlainObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function exactText(value, maximum, label) {
  if (
    typeof value !== "string" ||
    value.length < 1 ||
    value.length > maximum ||
    value !== value.trim() ||
    /[\u0000-\u001f\u007f]/.test(value)
  ) {
    throw new DiamondNotificationSenderError(
      "invalid-notification-request",
      `${label} must be a bounded, nonempty string.`,
    );
  }
  return value;
}

function requireId(core, value, label) {
  try {
    return core.normalizeDiamondId(value, label);
  } catch (error) {
    throw new DiamondNotificationSenderError(
      "invalid-notification-request",
      error.message,
    );
  }
}

function expectedViewerLink(teamId, gameId) {
  const url = new URL("/watch", "https://share.allplays.ai");
  url.searchParams.set("teamId", teamId);
  url.searchParams.set("gameId", gameId);
  return url.toString();
}

function normalizeCanonicalSharedGamePath(value) {
  const path = exactText(value, 512, "sharedGamePath");
  const segments = path.split("/");
  if (
    segments.length !== 4 ||
    !["organizations", "tournaments"].includes(segments[0]) ||
    segments[2] !== "sharedGames" ||
    segments.some(
      (segment) =>
        !segment ||
        segment === "." ||
        segment === ".." ||
        segment.length > 128,
    )
  ) {
    throw new DiamondNotificationSenderError(
      "invalid-notification-request",
      "The Diamond notification shared-game path is not canonical.",
    );
  }
  return path;
}

function normalizeRequest(core, request) {
  if (!isPlainObject(request)) {
    throw new DiamondNotificationSenderError(
      "invalid-notification-request",
      "The Diamond notification request must be an object.",
    );
  }
  const unsupported = Object.keys(request).filter(
    (field) => !REQUEST_FIELDS.has(field),
  );
  if (unsupported.length) {
    throw new DiamondNotificationSenderError(
      "invalid-notification-request",
      "The Diamond notification request contains unsupported fields.",
      { details: { fields: unsupported.sort() } },
    );
  }
  const teamId = requireId(core, request.teamId, "teamId");
  const gameId = requireId(core, request.gameId, "gameId");
  const hasViewerTeamId = Object.prototype.hasOwnProperty.call(
    request,
    "viewerTeamId",
  );
  const hasViewerGameId = Object.prototype.hasOwnProperty.call(
    request,
    "viewerGameId",
  );
  const hasSharedGamePath = Object.prototype.hasOwnProperty.call(
    request,
    "sharedGamePath",
  );
  if (hasViewerTeamId !== hasViewerGameId) {
    throw new DiamondNotificationSenderError(
      "invalid-notification-request",
      "The Diamond notification viewer identity must be complete.",
    );
  }
  const viewerTeamId = hasViewerTeamId
    ? requireId(core, request.viewerTeamId, "viewerTeamId")
    : teamId;
  const viewerGameId = hasViewerGameId
    ? requireId(core, request.viewerGameId, "viewerGameId")
    : gameId;
  if (hasViewerTeamId !== hasSharedGamePath) {
    throw new DiamondNotificationSenderError(
      "invalid-notification-request",
      "A cross-team Diamond viewer and authoritative shared-game path must be provided together.",
    );
  }
  const sharedGamePath = hasSharedGamePath
    ? normalizeCanonicalSharedGamePath(request.sharedGamePath)
    : null;
  const instanceId = requireId(core, request.instanceId, "instanceId");
  const sourceEventId = requireId(core, request.sourceEventId, "sourceEventId");
  if (
    !Number.isSafeInteger(request.sourceRevision) ||
    request.sourceRevision < 1
  ) {
    throw new DiamondNotificationSenderError(
      "invalid-notification-request",
      "sourceRevision must be a positive safe integer.",
    );
  }
  if (request.category !== "liveScore") {
    throw new DiamondNotificationSenderError(
      "invalid-notification-request",
      "Only the liveScore category is supported for Diamond effects.",
    );
  }
  const expectedKey = `${DIAMOND_ENGINE}:${teamId}:${gameId}:instance:${instanceId}:notification:r${String(request.sourceRevision).padStart(10, "0")}`;
  if (
    request.dedupKey !== expectedKey ||
    request.idempotencyKey !== expectedKey
  ) {
    throw new DiamondNotificationSenderError(
      "invalid-notification-request",
      "The Diamond notification idempotency key is not canonical.",
    );
  }
  const link = expectedViewerLink(viewerTeamId, viewerGameId);
  if (request.link !== link || request.liveViewerLink !== link) {
    throw new DiamondNotificationSenderError(
      "invalid-notification-request",
      "The Diamond notification link is not the canonical live viewer URL.",
    );
  }
  return {
    teamId,
    gameId,
    instanceId,
    sourceRevision: request.sourceRevision,
    sourceEventId,
    title: exactText(request.title, 80, "title"),
    body: exactText(request.body, 120, "body"),
    category: "liveScore",
    liveViewerLink: link,
    link,
    ...(hasViewerTeamId ? { viewerTeamId, viewerGameId } : {}),
    ...(sharedGamePath ? { sharedGamePath } : {}),
    dedupKey: expectedKey,
    idempotencyKey: expectedKey,
  };
}

function receiptPath(teamId, gameId, instanceId, idempotencyKey) {
  const digest = nodeCrypto
    .createHash("sha256")
    .update(
      `${teamId}\u0000${gameId}\u0000${instanceId}\u0000${idempotencyKey}`,
      "utf8",
    )
    .digest("hex");
  return `teams/${teamId}/games/${gameId}/diamondScorebooks/v2/notificationReceipts/receipt-${digest}`;
}

function receiptId(path) {
  return path.slice(path.lastIndexOf("/") + 1);
}

function nowMilliseconds(clock) {
  let value;
  try {
    value = typeof clock === "function" ? clock() : clock?.now?.();
  } catch {
    value = null;
  }
  if (value instanceof Date) value = value.getTime();
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new DiamondNotificationSenderError(
      "clock-unavailable",
      "Server time is unavailable for the Diamond notification receipt.",
      { retryable: true },
    );
  }
  return value;
}

function timestampIso(milliseconds) {
  return new Date(milliseconds).toISOString();
}

function secureUuid(random) {
  let value;
  try {
    value =
      typeof random === "function"
        ? random()
        : typeof random?.randomUUID === "function"
          ? random.randomUUID()
          : null;
  } catch {
    value = null;
  }
  if (typeof value !== "string" || !UUID_V4_PATTERN.test(value)) {
    throw new DiamondNotificationSenderError(
      "randomness-unavailable",
      "Secure randomness is unavailable for the Diamond notification lease.",
      { retryable: true },
    );
  }
  return value.toLowerCase();
}

function snapshotData(snapshot) {
  return snapshot?.exists === true && typeof snapshot.data === "function"
    ? snapshot.data() || {}
    : null;
}

function validateExistingReceipt(receipt, expected) {
  if (
    !isPlainObject(receipt) ||
    receipt.schemaVersion !== RECEIPT_SCHEMA_VERSION ||
    receipt.trackingEngine !== DIAMOND_ENGINE ||
    receipt.receiptId !== expected.receiptId ||
    receipt.teamId !== expected.teamId ||
    receipt.gameId !== expected.gameId ||
    receipt.instanceId !== expected.instanceId ||
    receipt.sourceRevision !== expected.sourceRevision ||
    receipt.sourceEventId !== expected.sourceEventId ||
    receipt.idempotencyKey !== expected.idempotencyKey ||
    receipt.requestHash !== expected.requestHash ||
    !RECEIPT_STATUSES.has(receipt.status)
  ) {
    throw new DiamondNotificationSenderError(
      "notification-receipt-conflict",
      "The durable Diamond notification receipt conflicts with this request.",
    );
  }
  if (
    receipt.providerOutcome !== undefined &&
    !PROVIDER_OUTCOMES.has(receipt.providerOutcome)
  ) {
    throw new DiamondNotificationSenderError(
      "notification-receipt-conflict",
      "The durable Diamond notification receipt is malformed.",
    );
  }
  const providerDispatch = receipt.providerDispatch;
  if (
    providerDispatch !== undefined &&
    providerDispatch !== null &&
    (!isPlainObject(providerDispatch) ||
      !UUID_V4_PATTERN.test(providerDispatch.attemptId || "") ||
      providerDispatch.requestHash !== expected.requestHash ||
      !Number.isSafeInteger(providerDispatch.attempt) ||
      providerDispatch.attempt < 1 ||
      providerDispatch.attempt > receipt.attemptCount ||
      !Number.isSafeInteger(providerDispatch.startedAtMs) ||
      providerDispatch.startedAtMs < 0)
  ) {
    throw new DiamondNotificationSenderError(
      "notification-receipt-conflict",
      "The durable Diamond notification provider-dispatch boundary is malformed.",
    );
  }
  if (
    !Number.isSafeInteger(receipt.attemptCount) ||
    receipt.attemptCount < 1 ||
    (receipt.status === RECEIPT_STATUS_PROCESSING &&
      (!isPlainObject(receipt.dispatchLease) ||
        !UUID_V4_PATTERN.test(receipt.dispatchLease.leaseId || "") ||
        receipt.dispatchLease.requestHash !== expected.requestHash ||
        !Number.isSafeInteger(receipt.dispatchLease.attempt) ||
        receipt.dispatchLease.attempt !== receipt.attemptCount ||
        !Number.isSafeInteger(receipt.dispatchLease.acquiredAtMs) ||
        !Number.isSafeInteger(receipt.dispatchLease.expiresAtMs) ||
        receipt.dispatchLease.expiresAtMs <=
          receipt.dispatchLease.acquiredAtMs)) ||
    ([RECEIPT_STATUS_UNCERTAIN, RECEIPT_STATUS_RETRYABLE].includes(
      receipt.status,
    ) &&
      (!Number.isSafeInteger(receipt.nextAttemptAtMs) ||
        receipt.nextAttemptAtMs < 0)) ||
    (receipt.status === RECEIPT_STATUS_COMPLETED &&
      ![
        "sent",
        "partial",
        "no-recipients",
        "delivery-uncertain",
      ].includes(receipt.providerOutcome))
  ) {
    throw new DiamondNotificationSenderError(
      "notification-receipt-conflict",
      "The durable Diamond notification receipt is malformed.",
    );
  }
  return receipt;
}

function providerReceiptId(receiptDocumentId) {
  return `diamond-${receiptDocumentId.slice("receipt-".length)}`;
}

function diamondNotificationProviderReceiptId(request) {
  return providerReceiptId(
    receiptId(
      receiptPath(
        request.teamId,
        request.gameId,
        request.instanceId,
        request.idempotencyKey,
      ),
    ),
  );
}

function normalizeDeliveryOutcome(value) {
  if (value === null) return "no-recipients";
  if (
    !isPlainObject(value) ||
    !Number.isSafeInteger(value.successCount) ||
    value.successCount < 0 ||
    !Number.isSafeInteger(value.failureCount) ||
    value.failureCount < 0 ||
    !Number.isSafeInteger(value.inboxWriteCount) ||
    value.inboxWriteCount < 0 ||
    !Number.isSafeInteger(value.inboxFailureCount) ||
    value.inboxFailureCount < 0 ||
    (value.providerDeliveryUncertain !== undefined &&
      typeof value.providerDeliveryUncertain !== "boolean") ||
    (value.providerDispatchAttempted !== undefined &&
      typeof value.providerDispatchAttempted !== "boolean") ||
    (value.uncertainFailureCount !== undefined &&
      (!Number.isSafeInteger(value.uncertainFailureCount) ||
        value.uncertainFailureCount < 0)) ||
    (value.providerDeliveryUncertain === true &&
      (value.providerDispatchAttempted !== true ||
        !Number.isSafeInteger(value.uncertainFailureCount) ||
        value.uncertainFailureCount < 1))
  ) {
    throw new DiamondNotificationSenderError(
      "notification-delivery-ambiguous",
      "The Diamond notification delivery result is malformed.",
      { retryable: true },
    );
  }
  if (value.providerDeliveryUncertain === true) {
    return "delivery-uncertain";
  }
  const delivered = value.successCount + value.inboxWriteCount;
  const failed = value.failureCount + value.inboxFailureCount;
  if (delivered === 0 && failed === 0) {
    throw new DiamondNotificationSenderError(
      "notification-delivery-ambiguous",
      "The Diamond notification delivery result contains no recipient evidence.",
      { retryable: true },
    );
  }
  if (delivered === 0) return "failed";
  if (failed > 0) return "partial";
  return "sent";
}

function safeProviderErrorCode(error) {
  const value = String(error?.code || "provider-failed")
    .replace(/[\u0000-\u001f\u007f]/g, "-")
    .trim()
    .slice(0, 80);
  return value || "provider-failed";
}

function duplicateResult(request, receiptDocumentId) {
  return {
    outcome: "deduplicated",
    instanceId: request.instanceId,
    idempotencyKey: request.idempotencyKey,
    providerReceiptId: providerReceiptId(receiptDocumentId),
  };
}

function uncertainResult(request, receiptDocumentId) {
  return {
    outcome: "delivery-uncertain",
    instanceId: request.instanceId,
    idempotencyKey: request.idempotencyKey,
    providerReceiptId: providerReceiptId(receiptDocumentId),
  };
}

function createDiamondScorebookNotificationSender(dependencies = {}) {
  const firestore = dependencies.firestore;
  const deliverNotification = dependencies.deliverNotification;
  const core = dependencies.core || require("./diamond-scorebook-core.cjs");
  const clock = dependencies.clock || (() => Date.now());
  const random = dependencies.random || { randomUUID: nodeCrypto.randomUUID };
  const logger = dependencies.logger || { info() {}, warn() {}, error() {} };
  const leaseMillis = dependencies.leaseMillis || DEFAULT_DELIVERY_LEASE_MILLIS;
  const retryDelayMillis =
    dependencies.retryDelayMillis || DEFAULT_RETRY_DELAY_MILLIS;

  if (!firestore?.doc || typeof firestore.runTransaction !== "function") {
    throw new TypeError(
      "A Firestore dependency with documents and transactions is required.",
    );
  }
  if (typeof deliverNotification !== "function") {
    throw new TypeError(
      "A Diamond notification delivery function is required.",
    );
  }
  if (
    typeof core.hashDiamondValue !== "function" ||
    typeof core.normalizeDiamondId !== "function"
  ) {
    throw new TypeError("The Diamond scorebook core dependency is required.");
  }
  if (
    !Number.isSafeInteger(leaseMillis) ||
    leaseMillis < 1_000 ||
    leaseMillis > 30 * 60 * 1000
  ) {
    throw new TypeError(
      "leaseMillis must be between one second and thirty minutes.",
    );
  }
  if (
    !Number.isSafeInteger(retryDelayMillis) ||
    retryDelayMillis < 1_000 ||
    retryDelayMillis > 30 * 60 * 1000
  ) {
    throw new TypeError(
      "retryDelayMillis must be between one second and thirty minutes.",
    );
  }

  function waitResult(receipt, nowMs) {
    if (receipt.status === RECEIPT_STATUS_COMPLETED) {
      return { acquired: false, state: "completed", receipt };
    }
    if (
      receipt.status === RECEIPT_STATUS_PROCESSING &&
      receipt.dispatchLease.expiresAtMs > nowMs
    ) {
      return { acquired: false, state: "lease-active", receipt };
    }
    if (
      receipt.status === RECEIPT_STATUS_PROCESSING &&
      receipt.providerDispatch
    ) {
      return {
        acquired: false,
        state: "provider-dispatch-uncertain",
        receipt,
      };
    }
    if (receipt.status === RECEIPT_STATUS_UNCERTAIN) {
      return {
        acquired: false,
        state: "provider-dispatch-uncertain",
        receipt,
      };
    }
    if (
      receipt.status === RECEIPT_STATUS_RETRYABLE &&
      receipt.nextAttemptAtMs > nowMs
    ) {
      return { acquired: false, state: "retry-delayed", receipt };
    }
    return null;
  }

  async function reserve(request, reference, expected, nowMs, getLeaseId) {
    let attemptedLeaseId = null;
    try {
      return await firestore.runTransaction(async (transaction) => {
        const snapshot = await transaction.get(reference);
        const existing = snapshotData(snapshot);
        if (existing) {
          const receipt = validateExistingReceipt(existing, expected);
          const waiting = waitResult(receipt, nowMs);
          if (waiting) return waiting;
        }
        attemptedLeaseId = getLeaseId();
        const attemptCount = existing ? existing.attemptCount + 1 : 1;
        const lease = {
          leaseId: attemptedLeaseId,
          requestHash: expected.requestHash,
          attempt: attemptCount,
          acquiredAtMs: nowMs,
          expiresAtMs: nowMs + leaseMillis,
        };
        const claim = {
          schemaVersion: RECEIPT_SCHEMA_VERSION,
          trackingEngine: DIAMOND_ENGINE,
          receiptId: expected.receiptId,
          teamId: request.teamId,
          gameId: request.gameId,
          instanceId: request.instanceId,
          sourceRevision: request.sourceRevision,
          sourceEventId: request.sourceEventId,
          idempotencyKey: request.idempotencyKey,
          requestHash: expected.requestHash,
          status: RECEIPT_STATUS_PROCESSING,
          attemptCount,
          dispatchLease: lease,
          providerDispatch: null,
          providerRequestId: providerReceiptId(expected.receiptId),
          updatedAt: timestampIso(nowMs),
          ...(existing ? {} : { createdAt: timestampIso(nowMs) }),
        };
        if (existing) transaction.update(reference, claim);
        else transaction.set(reference, claim);
        return { acquired: true, state: "acquired", receipt: claim, lease };
      });
    } catch (error) {
      if (error instanceof DiamondNotificationSenderError) throw error;
      try {
        const existing = snapshotData(await reference.get());
        if (existing) {
          const receipt = validateExistingReceipt(existing, expected);
          if (
            attemptedLeaseId &&
            receipt.status === RECEIPT_STATUS_PROCESSING &&
            receipt.dispatchLease?.leaseId === attemptedLeaseId
          ) {
            return {
              acquired: true,
              state: "acquired-after-reconcile",
              receipt,
              lease: receipt.dispatchLease,
            };
          }
          const waiting = waitResult(receipt, nowMs);
          if (waiting) return waiting;
        }
      } catch (reconcileError) {
        if (reconcileError instanceof DiamondNotificationSenderError) {
          throw reconcileError;
        }
      }
      throw new DiamondNotificationSenderError(
        "notification-receipt-unavailable",
        "The durable Diamond notification claim could not be verified.",
        { retryable: true, details: { causeCode: error?.code || "unknown" } },
      );
    }
  }

  async function markReceipt(reference, expected, lease, patch) {
    try {
      return await firestore.runTransaction(async (transaction) => {
        const snapshot = await transaction.get(reference);
        const existing = validateExistingReceipt(
          snapshotData(snapshot),
          expected,
        );
        if (existing.status === RECEIPT_STATUS_COMPLETED) return existing;
        if (
          existing.status !== RECEIPT_STATUS_PROCESSING ||
          existing.dispatchLease?.leaseId !== lease.leaseId
        ) {
          throw new DiamondNotificationSenderError(
            "notification-lease-lost",
            "The Diamond notification delivery lease changed.",
            { retryable: true },
          );
        }
        const mutation = {
          ...patch,
          dispatchLease: null,
          lastMutationId: lease.leaseId,
        };
        transaction.update(reference, mutation);
        return { ...existing, ...mutation };
      });
    } catch (error) {
      try {
        const existing = validateExistingReceipt(
          snapshotData(await reference.get()),
          expected,
        );
        if (
          existing.status === RECEIPT_STATUS_COMPLETED ||
          (existing.status === patch.status &&
            existing.lastMutationId === lease.leaseId)
        ) {
          return existing;
        }
      } catch (reconcileError) {
        if (reconcileError instanceof DiamondNotificationSenderError) {
          throw reconcileError;
        }
      }
      throw new DiamondNotificationSenderError(
        "notification-receipt-unavailable",
        "The Diamond notification receipt update could not be verified.",
        { retryable: true, details: { causeCode: error?.code || "unknown" } },
      );
    }
  }

  async function markProviderDispatchStarting(
    reference,
    expected,
    lease,
    startedAtMs,
  ) {
    const providerDispatch = {
      attemptId: lease.leaseId,
      requestHash: expected.requestHash,
      attempt: lease.attempt,
      startedAtMs,
    };
    try {
      return await firestore.runTransaction(async (transaction) => {
        const snapshot = await transaction.get(reference);
        const existing = validateExistingReceipt(
          snapshotData(snapshot),
          expected,
        );
        if (
          existing.status !== RECEIPT_STATUS_PROCESSING ||
          existing.dispatchLease?.leaseId !== lease.leaseId
        ) {
          throw new DiamondNotificationSenderError(
            "notification-lease-lost",
            "The Diamond notification delivery lease changed before provider dispatch.",
            { retryable: true },
          );
        }
        if (existing.providerDispatch) {
          if (
            existing.providerDispatch.attemptId === lease.leaseId &&
            existing.providerDispatch.requestHash === expected.requestHash
          ) {
            return existing.providerDispatch;
          }
          throw new DiamondNotificationSenderError(
            "notification-receipt-conflict",
            "Another provider dispatch is already bound to this notification.",
          );
        }
        transaction.update(reference, {
          providerDispatch,
          updatedAt: timestampIso(startedAtMs),
        });
        return providerDispatch;
      });
    } catch (error) {
      if (error instanceof DiamondNotificationSenderError) throw error;
      try {
        const existing = validateExistingReceipt(
          snapshotData(await reference.get()),
          expected,
        );
        if (
          existing.status === RECEIPT_STATUS_PROCESSING &&
          existing.dispatchLease?.leaseId === lease.leaseId &&
          existing.providerDispatch?.attemptId === lease.leaseId &&
          existing.providerDispatch?.requestHash === expected.requestHash
        ) {
          return existing.providerDispatch;
        }
      } catch (reconcileError) {
        if (reconcileError instanceof DiamondNotificationSenderError) {
          throw reconcileError;
        }
      }
      throw new DiamondNotificationSenderError(
        "notification-receipt-unavailable",
        "The durable provider-dispatch boundary could not be verified.",
        { retryable: true, details: { causeCode: error?.code || "unknown" } },
      );
    }
  }

  function pendingError(state) {
    return new DiamondNotificationSenderError(
      "notification-delivery-pending",
      state === "lease-active"
        ? "Another Diamond notification worker owns the active delivery lease."
        : "The Diamond notification retry delay has not elapsed.",
      { retryable: true },
    );
  }

  async function recordFailure({
    reference,
    expected,
    lease,
    nowMs,
    status,
    error,
  }) {
    await markReceipt(reference, expected, lease, {
      status,
      providerDispatch: null,
      nextAttemptAtMs: nowMs + retryDelayMillis,
      lastDeliveryError: {
        code: safeProviderErrorCode(error),
        failedAt: timestampIso(nowMs),
        attempt: lease.attempt,
      },
      updatedAt: timestampIso(nowMs),
    });
  }

  async function recordUncertainDelivery({
    reference,
    expected,
    lease,
    nowMs,
    error,
  }) {
    await markReceipt(reference, expected, lease, {
      status: RECEIPT_STATUS_COMPLETED,
      providerOutcome: "delivery-uncertain",
      providerReceiptId: providerReceiptId(expected.receiptId),
      lastDeliveryError: {
        code: safeProviderErrorCode(error),
        failedAt: timestampIso(nowMs),
        attempt: lease.attempt,
      },
      nextAttemptAtMs: null,
      completedAt: timestampIso(nowMs),
      updatedAt: timestampIso(nowMs),
    });
  }

  async function sendDiamondNotification(rawRequest) {
    const request = normalizeRequest(core, rawRequest);
    const path = receiptPath(
      request.teamId,
      request.gameId,
      request.instanceId,
      request.idempotencyKey,
    );
    const reference = firestore.doc(path);
    const documentId = receiptId(path);
    const requestHash = core.hashDiamondValue(request);
    const expected = {
      receiptId: documentId,
      teamId: request.teamId,
      gameId: request.gameId,
      instanceId: request.instanceId,
      sourceRevision: request.sourceRevision,
      sourceEventId: request.sourceEventId,
      idempotencyKey: request.idempotencyKey,
      requestHash,
    };
    const nowMs = nowMilliseconds(clock);
    let cachedLeaseId = null;
    const getLeaseId = () =>
      cachedLeaseId || (cachedLeaseId = secureUuid(random));
    const reservation = await reserve(
      request,
      reference,
      expected,
      nowMs,
      getLeaseId,
    );
    if (reservation.state === "completed") {
      return reservation.receipt.providerOutcome === "delivery-uncertain"
        ? uncertainResult(request, documentId)
        : duplicateResult(request, documentId);
    }
    if (reservation.state === "provider-dispatch-uncertain") {
      return uncertainResult(request, documentId);
    }
    if (!reservation.acquired) throw pendingError(reservation.state);
    const lease = reservation.lease;
    const deliveryMetadata = {
      attempt: lease.attempt,
      attemptId: lease.leaseId,
      instanceId: request.instanceId,
      idempotencyKey: request.idempotencyKey,
      providerRequestId: providerReceiptId(documentId),
    };
    let providerDispatchStarted = false;
    const deliveryHooks = {
      beforeProviderDispatch: async () => {
        const startedAtMs = nowMilliseconds(clock);
        await markProviderDispatchStarting(
          reference,
          expected,
          lease,
          startedAtMs,
        );
        providerDispatchStarted = true;
      },
    };

    let deliveryResult;
    try {
      deliveryResult = await deliverNotification(
        request,
        deliveryMetadata,
        deliveryHooks,
      );
    } catch (error) {
      if (providerDispatchStarted) {
        await recordUncertainDelivery({
          reference,
          expected,
          lease,
          nowMs,
          error,
        });
        return uncertainResult(request, documentId);
      }
      await recordFailure({
        reference,
        expected,
        lease,
        nowMs,
        status: RECEIPT_STATUS_RETRYABLE,
        error,
      });
      throw new DiamondNotificationSenderError(
        "notification-delivery-failed-before-provider",
        "Diamond notification delivery stopped before provider dispatch and remains retryable.",
        { retryable: true, details: { causeCode: error?.code || "unknown" } },
      );
    }

    if (
      isPlainObject(deliveryResult) &&
      ((deliveryResult.providerDispatchAttempted === true &&
        !providerDispatchStarted) ||
        (deliveryResult.providerDispatchAttempted === false &&
          providerDispatchStarted))
    ) {
      await recordUncertainDelivery({
        reference,
        expected,
        lease,
        nowMs,
        error: Object.assign(
          new Error("The delivery adapter bypassed its provider boundary."),
          { code: "provider-boundary-mismatch" },
        ),
      });
      return uncertainResult(request, documentId);
    }

    let outcome;
    try {
      outcome = normalizeDeliveryOutcome(deliveryResult);
    } catch (error) {
      if (providerDispatchStarted) {
        await recordUncertainDelivery({
          reference,
          expected,
          lease,
          nowMs,
          error,
        });
        return uncertainResult(request, documentId);
      }
      await recordFailure({
        reference,
        expected,
        lease,
        nowMs,
        status: RECEIPT_STATUS_RETRYABLE,
        error,
      });
      throw error;
    }
    if (outcome === "delivery-uncertain") {
      await recordUncertainDelivery({
        reference,
        expected,
        lease,
        nowMs,
        error: Object.assign(new Error("Provider response was uncertain."), {
          code: "provider-response-uncertain",
        }),
      });
      return uncertainResult(request, documentId);
    }
    if (outcome === "failed") {
      const error = new DiamondNotificationSenderError(
        "notification-delivery-failed",
        "No Diamond notification delivery succeeded; the request remains retryable.",
        { retryable: true },
      );
      await recordFailure({
        reference,
        expected,
        lease,
        nowMs,
        status: RECEIPT_STATUS_RETRYABLE,
        error,
      });
      throw error;
    }
    const completedAtMs = nowMilliseconds(clock);
    await markReceipt(reference, expected, lease, {
      status: RECEIPT_STATUS_COMPLETED,
      providerOutcome: outcome,
      providerReceiptId: providerReceiptId(documentId),
      completedAt: timestampIso(completedAtMs),
      updatedAt: timestampIso(completedAtMs),
    });
    return {
      outcome,
      instanceId: request.instanceId,
      idempotencyKey: request.idempotencyKey,
      providerReceiptId: providerReceiptId(documentId),
    };
  }

  return { sendDiamondNotification };
}

module.exports = {
  DIAMOND_ENGINE,
  RECEIPT_SCHEMA_VERSION,
  DiamondNotificationSenderError,
  createDiamondScorebookNotificationSender,
  diamondNotificationProviderReceiptId,
  expectedViewerLink,
  normalizeDeliveryOutcome,
  normalizeRequest,
  receiptPath,
};
