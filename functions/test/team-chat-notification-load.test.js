'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');

const functionsSource = readFileSync(join(__dirname, '..', 'index.js'), 'utf8');

function getDetectMentionedUids() {
    const start = functionsSource.indexOf('function detectMentionedUids(');
    const end = functionsSource.indexOf('\nasync function buildTeamChatNotificationContext');
    const slice = functionsSource.slice(start, end);
    return new Function(`${slice}; return detectMentionedUids;`)();
}

function getBuildTeamChatNotificationPlan(detectMentionedUids) {
    const start = functionsSource.indexOf('function buildTeamChatNotificationPlan(');
    const end = functionsSource.indexOf('\nexports.notifyTeamChatMessageCreated');
    const slice = functionsSource.slice(start, end);
    return new Function('detectMentionedUids', `${slice}; return buildTeamChatNotificationPlan;`)(detectMentionedUids);
}

const detectMentionedUids = getDetectMentionedUids();
const buildTeamChatNotificationPlan = getBuildTeamChatNotificationPlan(detectMentionedUids);

describe('team chat notification load path', () => {
    it('uses one preloaded recipient context for a large mixed team fixture', () => {
        const mentionedUserIds = ['user-12', 'user-87', 'user-301'];
        const members = Array.from({ length: 500 }, (_, index) => ({
            uid: `user-${index}`,
            displayName: `Player ${index}`
        }));
        members[12].displayName = 'Alice';
        members[87].displayName = 'Bob Smith';
        members[301].displayName = 'Carol';

        const liveChatTargets = members.map((member) => ({ uid: member.uid, token: `live-${member.uid}` }));
        const mentionTargets = members
            .filter((member) => mentionedUserIds.includes(member.uid))
            .map((member) => ({ uid: member.uid, token: `mention-${member.uid}` }));

        const plan = buildTeamChatNotificationPlan({
            text: 'Nice work @alice @bob @carol',
            actorUid: 'user-0',
            recipientContext: {
                members,
                mutedUids: ['user-111', 'user-222'],
                targetsByCategory: {
                    mentions: mentionTargets,
                    liveChat: liveChatTargets
                }
            }
        });

        assert.deepEqual(plan.mentionedUids.sort(), mentionedUserIds.sort());
        assert.equal(plan.mentionTargets.length, 3);
        assert.equal(plan.liveChatTargets.length, 494);
        assert.equal(plan.liveChatTargets.some((target) => target.uid === 'user-0'), false);
        assert.equal(plan.liveChatTargets.some((target) => target.uid === 'user-111'), false);
        assert.equal(plan.liveChatTargets.some((target) => target.uid === 'user-222'), false);
        assert.equal(plan.liveChatTargets.some((target) => mentionedUserIds.includes(target.uid)), false);
    });
});
