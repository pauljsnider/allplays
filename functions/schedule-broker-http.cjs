"use strict";
const { createPrivateBrokerHttpHandler, createPrivateBrokerJsonClient } = require('./private-broker-http.cjs');
// Unmounted command route. The shared ingress checks workload identity; the
// channel independently verifies the signed command and live user/session.
function createScheduleBrokerHttpHandler({ channel, ...policy }) {
    if (typeof channel?.handle !== 'function') throw new Error('A verified command channel is required.');
    return createPrivateBrokerHttpHandler({ ...policy, path: '/internal/v1/schedule-command', maxBodyBytes: 49152,
        handle: async (payload) => {
            const result = await channel.handle(payload);
            if (!result || !/^[a-f0-9]{64}$/.test(result.operationId || '') || !['not_started', 'committed', 'unverified'].includes(result.status)) {
                throw Object.assign(new Error('Invalid command response'), { status: 503 });
            }
            return { operationId: result.operationId, status: result.status };
        }
    });
}
function createScheduleBrokerCommandClient(policy) {
    if (new URL(policy.url).pathname !== '/internal/v1/schedule-command') throw new Error('The exact command endpoint is required.');
    return createPrivateBrokerJsonClient({ ...policy, validateResult: (result) => {
        if (!result || Object.keys(result).length !== 2 || !/^[a-f0-9]{64}$/.test(result.operationId || '') || !['not_started', 'committed', 'unverified'].includes(result.status)) throw new Error('Invalid command status');
        return { operationId: result.operationId, status: result.status };
    } });
}
module.exports = { createScheduleBrokerHttpHandler, createScheduleBrokerCommandClient };
