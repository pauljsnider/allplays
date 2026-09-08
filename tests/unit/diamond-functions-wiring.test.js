import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync(
  new URL("../../functions/index.js", import.meta.url),
  "utf8",
);

describe("Diamond Scorebook Functions wiring", () => {
  it("exports every server-authoritative callable from one handler factory", () => {
    expect(source).toContain("require('./diamond-scorebook-handlers.cjs')");
    expect(source).toContain(
      "const diamondScorebookHandlers = createDiamondScorebookHandlers({",
    );
    [
      "configureDiamondTeam",
      "getDiamondAccess",
      "getDiamondManagerStats",
      "activateDiamondGame",
      "acquireDiamondScorerLease",
      "listDiamondScorerCandidates",
      "submitDiamondCommand",
      "getDiamondState",
      "listDiamondEvents",
      "getPublicDiamondGame",
      "parseDiamondVoice",
      "regenerateDiamondProjection",
    ].forEach((name) => {
      expect(source).toContain(
        `exports.${name} = diamondCallableFunctions.https.onCall(`,
      );
      expect(source).toContain(`diamondScorebookHandlers.${name}`);
    });
  });

  it("routes Diamond-only live engagement through the verified server writer", () => {
    expect(source).toContain("require('firebase-admin/firestore')");
    expect(source).toContain(
      "admin.firestore.FieldPath || adminFirestore.FieldPath",
    );
    expect(source).toContain(
      "admin.firestore.FieldValue || adminFirestore.FieldValue",
    );
    expect(source).toContain(
      "admin.firestore.Timestamp || adminFirestore.Timestamp",
    );
    expect(source).toContain(
      "require('./diamond-live-engagement-handlers.cjs')",
    );
    expect(source).toContain(
      "const diamondLiveEngagementHandlers = createDiamondLiveEngagementHandlers({",
    );
    expect(source).toContain(
      "assertSensitiveWrite: assertSensitiveEmailVerified",
    );
    expect(source).toContain("FieldValue: FirestoreFieldValue");
    expect(source).not.toMatch(
      /(?:FieldValue|fieldValue): admin\.firestore\.FieldValue/,
    );
    for (const name of [
      "postDiamondLiveChat",
      "postDiamondLiveReaction",
      "moderateDiamondLiveChat",
    ]) {
      expect(source).toContain(
        `exports.${name} = diamondCallableFunctions.https.onCall(`,
      );
      expect(source).toContain(`diamondLiveEngagementHandlers.${name}`);
    }
  });

  it("keeps deletion cleanup retryable and bound to the exact game path", () => {
    expect(source).toMatch(
      /exports\.cleanupDeletedDiamondGame = functions[\s\S]*?failurePolicy: true[\s\S]*?\.document\('teams\/\{teamId\}\/games\/\{gameId\}'\)[\s\S]*?\.onDelete\(diamondScorebookHandlers\.cleanupDeletedDiamondGame\)/,
    );
    expect(source).toContain(
      "assertOpportunityRateLimit(checkPublicOpportunityBrowseRateLimit, context, 'diamond-game')",
    );
  });

  it("runs the verified projector on the exact v2 scorebook root with retries enabled", () => {
    expect(source).toContain(
      "require('./diamond-scorebook-projector-handlers.cjs')",
    );
    expect(source).toContain("require('./diamond-scorebook-runtime.cjs')");
    expect(source).toContain(
      "const diamondScorebookProjectorHandlers = createDiamondScorebookProjectorHandlers({",
    );
    expect(source).toContain("loadClipTimings: loadDiamondClipTimings");
    expect(source).toContain("resolveSharedGame: resolveDiamondSharedGame");
    expect(source).toMatch(
      /exports\.projectDiamondScorebook = functions[\s\S]*?failurePolicy: true[\s\S]*?\.document\('teams\/\{teamId\}\/games\/\{gameId\}\/diamondScorebooks\/v2'\)[\s\S]*?\.onWrite\(diamondScorebookProjectorHandlers\.onDiamondScorebookWrite\)/,
    );
  });

  it("processes a revisioned effect outbox through a durable notification sender", () => {
    expect(source).toContain(
      "require('./diamond-scorebook-effect-handlers.cjs')",
    );
    expect(source).toContain(
      "require('./diamond-scorebook-notification-sender.cjs')",
    );
    expect(source).toContain(
      "const diamondScorebookNotificationSender = createDiamondScorebookNotificationSender({",
    );
    expect(source).toContain(
      "sendNotification: diamondScorebookNotificationSender.sendDiamondNotification",
    );
    expect(source).toContain(
      "deliverNotification: deliverDiamondScorebookNotification",
    );
    expect(source).toContain(
      "delivery?.providerRequestId !== diamondNotificationProviderReceiptId(request)",
    );
    expect(source).toMatch(
      /function deliverDiamondScorebookNotification\(request, delivery, hooks = \{\}\) \{[\s\S]*?delivery\?\.instanceId !== request\.instanceId[\s\S]*?typeof hooks\.beforeProviderDispatch !== 'function'[\s\S]*?deliveryIdempotencyKey: delivery\.providerRequestId,[\s\S]*?beforeProviderDispatch: hooks\.beforeProviderDispatch,[\s\S]*?suppressResourceTelemetry: true,[\s\S]*?dedupKeys: \[\]/,
    );
    expect(source).toMatch(
      /exports\.processDiamondScorebookEffect = functions[\s\S]*?failurePolicy: true[\s\S]*?\.document\('teams\/\{teamId\}\/games\/\{gameId\}\/diamondScorebooks\/v2\/effects\/\{effectId\}'\)[\s\S]*?\.onWrite\(diamondScorebookEffectHandlers\.onDiamondEffectWrite\)/,
    );
  });

  it("wires postgame AI source and publication through bounded callables", () => {
    expect(source).toContain("require('./diamond-scorebook-ai-handlers.cjs')");
    expect(source).toContain(
      "const diamondScorebookAiHandlers = createDiamondScorebookAiHandlers({",
    );
    expect(source).toContain(
      "diamondScorebookAiHandlers.getDiamondRecapSource",
    );
    expect(source).toContain(
      "diamondScorebookAiHandlers.publishDiamondAiDraft",
    );
    expect(source).toMatch(
      /exports\.getDiamondRecapSource = diamondCallableFunctions\.https\.onCall\([\s\S]*?exports\.publishDiamondAiDraft = diamondCallableFunctions\.https\.onCall/,
    );
  });

  it("defers Auth lookup until a Diamond request is actually handled", () => {
    expect(source).toContain(
      "getUser: (...args) => admin.auth().getUser(...args)",
    );
    expect(source).toContain(
      "getUsers: (...args) => admin.auth().getUsers(...args)",
    );
  });

  it("keeps stable game, person, command, and receipt identifiers out of platform logs", () => {
    const serverModules = [
      "diamond-scorebook-handlers.cjs",
      "diamond-scorebook-projector-handlers.cjs",
      "diamond-scorebook-projections.cjs",
      "diamond-scorebook-effect-handlers.cjs",
      "diamond-scorebook-notification-sender.cjs",
      "diamond-scorebook-ai-handlers.cjs",
      "diamond-live-engagement-handlers.cjs",
      "diamond-scorebook-runtime.cjs",
    ];
    const stableIdentifier =
      /\b(?:teamId|gameId|instanceId|eventId|commandId|receiptId|effectDocumentId|actorUid|holderUid|targetUid)\s*:/;
    for (const moduleName of serverModules) {
      const moduleSource = readFileSync(
        new URL(`../../functions/${moduleName}`, import.meta.url),
        "utf8",
      );
      const logCalls =
        moduleSource.match(
          /logger\.(?:info|warn|error)\?\.\([\s\S]*?\n\s*\}\);/g,
        ) || [];
      for (const logCall of logCalls) {
        expect(logCall, moduleName).not.toMatch(stableIdentifier);
      }
    }
    const diamondRoutingLogs =
      source.match(
        /functions\.logger\.info\('Notification routing: Diamond[\s\S]*?\n\s*\}\);/g,
      ) || [];
    expect(diamondRoutingLogs).toHaveLength(2);
    for (const logCall of diamondRoutingLogs) {
      expect(logCall).not.toMatch(
        /\b(?:teamId|gameId|sourceRevision|diamondProjectionRevision)\s*:/,
      );
    }
  });
});
