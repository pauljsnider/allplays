"use strict";

const assert = require("node:assert/strict");
const { copyFile, mkdir, mkdtemp, rm, symlink } = require("node:fs/promises");
const { tmpdir } = require("node:os");
const { dirname, join } = require("node:path");
const { pathToFileURL } = require("node:url");
const test = require("node:test");
const { Firestore } = require("firebase-admin/firestore");

const functionsRoot = join(__dirname, "..");
const repositoryRoot = join(functionsRoot, "..");

test("migration Firestore reads request the workload-identity access token", async () => {
  const bundleRoot = await mkdtemp(join(tmpdir(), "allplays-migration-credential-"));
  const migrationRoot = join(bundleRoot, "_migration");
  let db;

  try {
    await mkdir(migrationRoot);
    await copyFile(
      join(repositoryRoot, "_migration", "firebase-admin-credential.mjs"),
      join(migrationRoot, "firebase-admin-credential.mjs")
    );
    await symlink(join(functionsRoot, "node_modules"), join(bundleRoot, "node_modules"), "dir");

    const { getMigrationFirestore } = await import(
      `${pathToFileURL(join(migrationRoot, "firebase-admin-credential.mjs")).href}?test=${Date.now()}`
    );
    const requestedCredentials = [];
    let credentialRequestCount = 0;

    class CredentialRequestProbe {
      setCredentials(credentials) {
        requestedCredentials.push(credentials);
      }

      async getRequestHeaders() {
        credentialRequestCount += 1;
        throw new Error("migration credential request probe");
      }
    }

    db = getMigrationFirestore({
      projectId: "game-flow-c6311",
      env: { GOOGLE_OAUTH_ACCESS_TOKEN: "oidc-access-token" },
      FirestoreClass: Firestore,
      OAuth2ClientClass: CredentialRequestProbe
    });

    await assert.rejects(
      db.collection("teams").select("ownerId", "ownerEmail", "ownerEmailLower").get(),
      /migration credential request probe/
    );
    assert.deepEqual(requestedCredentials, [{ access_token: "oidc-access-token" }]);
    assert.ok(credentialRequestCount > 0);
  } finally {
    if (db) await db.terminate();
    await rm(bundleRoot, { recursive: true, force: true });
  }
});
