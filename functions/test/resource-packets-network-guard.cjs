'use strict';
// Install only in the isolated test processes, never in deployed Functions.
const http = require('node:http');
const https = require('node:https');
const http2 = require('node:http2');
function check(target) {
  const host = typeof target === 'string' || target instanceof URL
    ? new URL(target).hostname : target.hostname || target.host || 'localhost';
  if (!['127.0.0.1', 'localhost', '[::1]', '::1'].includes(host)) throw new Error('Test blocked non-local network access');
}
for (const module of [http, https]) {
  for (const name of ['request', 'get']) {
    const original = module[name];
    module[name] = function (target, ...args) { check(target); return original.call(this, target, ...args); };
  }
}
const connect = http2.connect;
http2.connect = function (target, ...args) { check(target); return connect.call(this, target, ...args); };
const fetch = global.fetch;
global.fetch = function (target, ...args) { check(target); return fetch.call(this, target, ...args); };
