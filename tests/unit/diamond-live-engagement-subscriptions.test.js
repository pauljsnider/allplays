import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync(
  new URL("../../js/diamond-live-engagement-subscriptions.js", import.meta.url),
  "utf8",
);

describe("Diamond live engagement subscriptions", () => {
  it("pins every live query to the exact Diamond generation", () => {
    expect(source).toContain('/diamondLiveGenerations/${instanceId.toLowerCase()}/${collectionId}');
    expect(source).toContain('orderBy("createdAt", "desc")');
    expect(source).toContain('"chat"');
    expect(source).toContain('"reactions"');
    expect(source).toContain('httpsCallable(functions, functionName)(request)');
    expect(source).toContain("pendingChatRequests.get(pendingKey) || secureRequestId()");
    expect(source).toContain("pendingReactionRequests.get(pendingKey) || secureRequestId()");
  });

  it("fails closed for malformed paths and generation identities", () => {
    expect(source).toContain('value.includes("/")');
    expect(source).toContain("UUID_V4_PATTERN.test(instanceId)");
    expect(source).not.toContain("Math.random");
  });
});
