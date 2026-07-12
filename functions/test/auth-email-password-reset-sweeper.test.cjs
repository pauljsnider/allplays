'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { createPasswordResetEmailSweeper } = require('../auth-email-password-reset-sweeper.cjs');

test('sweeper continues past five failed oldest requests to process later backlog', async () => {
  const requestDocs = Array.from({ length: 6 }, (_, index) => ({ id: `request-${index + 1}` }));
  const attempted = [];
  const warnings = [];
  const sweeper = createPasswordResetEmailSweeper({
    async listRequests() { return requestDocs; },
    async processRequest(requestDoc) {
      attempted.push(requestDoc.id);
      if (requestDoc.id !== 'request-6') {
        throw Object.assign(new Error('transient'), { code: 'unavailable' });
      }
    },
    logger: {
      warn(message, meta) { warnings.push({ message, meta }); }
    },
    concurrency: 5
  });

  assert.deepEqual(await sweeper.sweep(), { processed: 1, failed: 5 });
  assert.deepEqual(new Set(attempted), new Set(requestDocs.map((request) => request.id)));
  assert.equal(warnings.length, 5);
  assert.equal(warnings[0].message, 'Password-reset backlog request remains queued for retry.');
});

test('sweeper propagates list failures so scheduler monitoring records the outage', async () => {
  const sweeper = createPasswordResetEmailSweeper({
    async listRequests() { throw Object.assign(new Error('query failed'), { code: 'unavailable' }); },
    async processRequest() {},
    logger: { warn() {} }
  });
  await assert.rejects(sweeper.sweep(), (error) => error.code === 'unavailable');
});
