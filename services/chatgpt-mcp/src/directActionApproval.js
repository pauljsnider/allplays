import { createHash } from 'node:crypto';
import { DomainError } from './core.js';
import { approvedContent } from './directConfirmation.js';

const key = (actor) => JSON.stringify([actor.uid, actor.clientId, actor.grantKey]);
const digest = (preview) => createHash('sha256').update(JSON.stringify(preview)).digest('hex');
const validActor = (actor, now) => ['uid', 'clientId', 'grantKey'].every((field) => typeof actor?.[field] === 'string' && actor[field].length > 0)
    && Number.isFinite(actor.expiresAt) && actor.expiresAt > now;

// This object exists only inside one authenticated MCP session. No approval
// credential is returned to the model or persisted as a reusable permission.
export function createOneActionApproval({ getActor, now = Date.now, lifetimeMs = 120000 }) {
    if (typeof getActor !== 'function' || !Number.isSafeInteger(lifetimeMs) || lifetimeMs <= 0 || lifetimeMs > 120000) throw new DomainError('confirmation_unavailable', 'A live identity resolver and bounded approval lifetime are required.');
    return async (preview, elicit, signal) => {
        const actor = await getActor();
        if (!validActor(actor, now())) throw new DomainError('confirmation_unavailable', 'A current actor/client/grant binding is required.');
        const binding = key(actor);
        const fingerprint = digest(preview);
        const expiresAt = Math.min(actor.expiresAt, now() + lifetimeMs);
        if (signal?.aborted || !Number.isFinite(expiresAt) || expiresAt <= now()) throw new DomainError('confirmation_expired', 'Start a fresh confirmation.');
        const answer = await elicit(preview, { signal, timeout: Math.max(1, expiresAt - now()) });
        const content = approvedContent(preview, answer);
        if (!content) return answer;
        const assertCurrent = async () => {
            const current = await getActor();
            if (signal?.aborted || now() >= expiresAt || !validActor(current, now()) || key(current) !== binding || digest(preview) !== fingerprint) {
                throw new DomainError('confirmation_expired', 'The approval expired or its connected account changed. No execution was authorized.');
            }
        };
        await assertCurrent();
        let consumed = false;
        return {
            action: 'accept', content,
            consume: async () => {
                if (consumed) throw new DomainError('confirmation_replayed', 'An approval can authorize only one commit attempt.');
                consumed = true;
                await assertCurrent();
            }
        };
    };
}
