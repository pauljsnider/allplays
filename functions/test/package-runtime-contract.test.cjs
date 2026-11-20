'use strict';

const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const test = require('node:test');

const functionsRoot = join(__dirname, '..');

function readJson(filename) {
  return JSON.parse(readFileSync(join(functionsRoot, filename), 'utf8'));
}

test('Functions uses the Node runtime required by google-auth-library 11', () => {
  const packageJson = readJson('package.json');
  const packageLock = readJson('package-lock.json');
  const lockRoot = packageLock.packages[''];
  const authLibrary = packageLock.packages['node_modules/google-auth-library'];

  assert.equal(packageJson.engines.node, '22');
  assert.equal(lockRoot.engines.node, packageJson.engines.node);
  assert.equal(packageJson.dependencies['google-auth-library'], '11.1.0');
  assert.equal(
    authLibrary.version,
    packageJson.dependencies['google-auth-library']
  );
  assert.equal(authLibrary.engines.node, '>=22');
});
