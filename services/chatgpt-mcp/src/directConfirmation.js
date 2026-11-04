import { DomainError } from './core.js';

const labels = Object.freeze({ notifyTeam: 'I also approve the team notification effects described above' });
export function confirmationFields(preview) {
    const required = preview?.requiredAcknowledgements ?? [];
    if (!Array.isArray(required) || required.some((key) => !Object.hasOwn(labels, key)) || new Set(required).size !== required.length) {
        throw new DomainError('confirmation_unavailable', 'This action requires an unsupported confirmation. Use app review.');
    }
    return { approve: { type: 'boolean', title: 'Apply this exact displayed change once', default: false },
        ...Object.fromEntries(required.map((key) => [key, { type: 'boolean', title: labels[key], default: false }])) };
}
export function approvedContent(preview, answer) {
    const keys = Object.keys(confirmationFields(preview));
    return answer?.action === 'accept' && keys.every((key) => answer.content?.[key] === true)
        ? Object.fromEntries(keys.map((key) => [key, true])) : null;
}
