"use strict";

// Unmounted adapters. Callers supply isolated SDK-like clients in tests. No
// default Firebase client, credentials, network endpoint or trigger is created.
const { createHash } = require('node:crypto');
const { normalizeNotificationAttempt, NotificationJournalError } = require('./notification-attempt-journal.cjs');
const { buildNotificationInboxPayload } = require('./notification-inbox-core.cjs');
const { buildAppUrl } = require('./app-links-core.cjs');
const { WEB_PUSH_NOTIFICATION_ASSETS, buildNotificationDeliveryOptions } = require('./notification-delivery-metadata.cjs');
const canonical = (value) => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object'
    ? Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])])) : value;
const digest = (value) => createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
const reject = () => { throw new NotificationJournalError('provider_contract', 'The pinned provider request is invalid or unsupported.'); };
const proof = (metadata, receiptId) => ({ effectId: metadata.effectId, requestHash: metadata.requestHash,
    attemptId: metadata.attemptId, final: true, outcome: 'accepted', receiptId });

function pinScheduleProviderRequest(raw) {
    const { request, effectId } = normalizeNotificationAttempt(raw);
    if (request.provider) reject();
    const appRoute = `/schedule/${request.teamId}/${request.eventId}`;
    const link = buildAppUrl(appRoute);
    const options = buildNotificationDeliveryOptions({ category: 'schedule', teamId: request.teamId, gameId: request.eventId, eventId: request.eventId });
    const parameters = request.channel === 'inbox'
        ? { path: `users/${request.recipientUid}/notificationInbox/mcp_${effectId}`,
            data: buildNotificationInboxPayload({ category: 'schedule', title: request.title, body: request.body,
                appRoute, teamId: request.teamId, gameId: request.eventId, eventId: request.eventId,
                createdAt: new Date(request.sourceVersion).toISOString(), readAt: null }) }
        : { token: request.endpoint, notification: { title: request.title, body: request.body },
            data: { category: 'schedule', teamId: request.teamId, gameId: request.eventId, eventId: request.eventId, appRoute, link },
            webpush: { notification: { ...WEB_PUSH_NOTIFICATION_ASSETS, tag: `mcp_${effectId}` }, fcmOptions: { link } },
            android: { ...options.android, collapseKey: `mcp_${effectId}` },
            apns: { ...options.apns, headers: { ...options.apns?.headers, 'apns-collapse-id': effectId } } };
    return normalizeNotificationAttempt({ ...request, provider: { adapter: `${request.channel === 'inbox' ? 'firestore-inbox' : 'fcm-single'}-v1`, parameters } }).request;
}

function createScheduleDeliveryProviders({ firestore, messaging }) {
    const checked = (request) => {
        const normalized = normalizeNotificationAttempt(request).request;
        const { provider, ...envelope } = normalized;
        // v1 has no runtime defaults: serialize and verify the complete request.
        const expected = pinScheduleProviderRequest(envelope).provider;
        if (provider?.adapter !== expected.adapter || digest(provider.parameters) !== digest(expected.parameters)) reject();
        return provider;
    };
    const inboxReceipt = async (request, metadata, write) => {
        const { parameters } = checked(request);
        if (!firestore?.doc || !firestore?.runTransaction) reject();
        const ref = firestore.doc(parameters.path);
        const sameContent = (value) => {
            if (!value) return false;
            // readAt may be changed by the recipient. It is not delivery evidence.
            const { readAt: _readAt, ...content } = value;
            if (content.createdAt?.toDate) content.createdAt = content.createdAt.toDate().toISOString();
            else if (content.createdAt instanceof Date) content.createdAt = content.createdAt.toISOString();
            const { readAt: _initialReadAt, ...expected } = parameters.data;
            return digest(content) === digest(expected);
        };
        if (write) {
            const persisted = await firestore.runTransaction(async (transaction) => {
                const existing = await transaction.get(ref);
                if (existing.exists) { if (!sameContent(existing.data())) reject(); return true; }
                transaction.set(ref, { ...structuredClone(parameters.data), createdAt: new Date(parameters.data.createdAt) });
                return true;
            });
            if (persisted !== true) {
                const existing = await ref.get();
                if (!existing.exists || !sameContent(existing.data())) reject();
            }
        } else {
            const existing = await ref.get();
            if (!existing.exists) return null; // absence is not proof of rejection
            if (!sameContent(existing.data())) reject();
        }
        return proof(metadata, `inbox_${normalizeNotificationAttempt(request).effectId}`);
    };
    return {
        pin: pinScheduleProviderRequest,
        async send(request, metadata) {
            const provider = checked(request);
            if (request.channel === 'inbox') return inboxReceipt(request, metadata, true);
            if (!messaging?.send) reject();
            // Throws/timeouts remain uncertain. No broad SDK error -> rejection
            // conversion: that could authorize a duplicate visible push.
            const receiptId = await messaging.send(structuredClone(provider.parameters));
            if (typeof receiptId !== 'string' || !/^projects\/[A-Za-z0-9_-]+\/messages\/[A-Za-z0-9_:%.\/-]+$/.test(receiptId) || receiptId.length > 256) reject();
            return proof(metadata, receiptId);
        },
        async reconcile(request, metadata) {
            checked(request);
            return request.channel === 'inbox' ? inboxReceipt(request, metadata, false) : null;
        }
    };
}

module.exports = { pinScheduleProviderRequest, createScheduleDeliveryProviders };
