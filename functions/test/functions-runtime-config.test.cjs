"use strict";

const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { join } = require("node:path");
const test = require("node:test");

const functionsRoot = join(__dirname, "..");

function readJson(fileName) {
  return JSON.parse(readFileSync(join(functionsRoot, fileName), "utf8"));
}

test("Functions manifests pin the supported Node 22 runtime", () => {
  const packageJson = readJson("package.json");
  const packageLock = readJson("package-lock.json");

  assert.equal(packageJson.engines.node, "22");
  assert.equal(packageLock.packages[""].engines.node, "22");
});
