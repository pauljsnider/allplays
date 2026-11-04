"use strict";
const { createPrivateBrokerHttpHandler, createPrivateBrokerJsonClient } = require('./private-broker-http.cjs');
const fields = ['uid', 'clientId', 'grantKey', 'sessionId'];
const fail = () => { throw new Error('The bound session is unavailable.'); };
function checkBinding(value, now) {
    const keys = [...fields, 'expiresAt', 'purpose'];
    if (!value || Object.keys(value).length !== keys.length || !keys.every((key) => Object.hasOwn(value, key))
        || !['uid', 'sessionId'].every((key) => typeof value[key] === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(value[key]))
        || typeof value.clientId !== 'string' || !/^[A-Za-z0-9._~-]{1,256}$/.test(value.clientId)
        || typeof value.grantKey !== 'string' || !/^[a-f0-9]{64}$/.test(value.grantKey)
        || !['schedule.execute', 'schedule.status', 'schedule.recover'].includes(value.purpose) || !Number.isSafeInteger(value.expiresAt)
        || value.expiresAt <= now() || value.expiresAt - now() > 120000) fail();
    return value;
}
function resultFor(result, input, now) {
    checkBinding(input, now);
    const keys = [...fields, 'reviewRequests', 'connected', 'expiresAt'];
    if (!result || Object.keys(result).length !== keys.length || !keys.every((key) => Object.hasOwn(result, key))
        || !fields.every((key) => result[key] === input[key]) || result.reviewRequests !== true || result.connected !== true
        || !Number.isSafeInteger(result.expiresAt) || result.expiresAt < input.expiresAt || result.expiresAt <= now()) fail();
    return Object.fromEntries(keys.map((key) => [key, result[key]]));
}
// Host-only private endpoint: do not attach it to the public MCP router.
function createScheduleSessionHttpHandler({ introspectSession, now = Date.now, ...policy }) {
    if (typeof introspectSession !== 'function') throw new Error('A live broker session resolver is required.');
    return createPrivateBrokerHttpHandler({ ...policy, now, path: '/internal/v1/schedule-session', maxBodyBytes: 2048,
        handle: async (input) => resultFor(await introspectSession(checkBinding(input, now)), input, now) });
}
function createScheduleSessionIntrospector({ now = Date.now, ...policy }) {
    if (new URL(policy.url).pathname !== '/internal/v1/schedule-session') throw new Error('The exact session endpoint is required.');
    const call = createPrivateBrokerJsonClient({ ...policy, now, validateResult: (result, input) => resultFor(result, input, now) });
    return (input) => call(structuredClone(checkBinding(input, now)));
}
module.exports = { createScheduleSessionHttpHandler, createScheduleSessionIntrospector };
