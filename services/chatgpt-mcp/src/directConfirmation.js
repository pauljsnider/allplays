import { DomainError } from './core.js';

const labels = Object.freeze({ rosterLifecycle: 'I approve these roster status effects, including family schedules, existing RSVP links and future communication eligibility; this does not revoke family links or erase history',
    trackingLifecycle: 'I approve this lifecycle change while preserving existing completion records; reactivation does not reset them',
    privatePlayerProfile: 'I approve saving or clearing this exact private text, readable by authorized team owners/admins and all parents linked to this player',
    notifyTeam: 'I also approve the team notification effects described above',
    practiceBlockContent: 'I approve replacing or removing only the displayed draft blocks; recorded coaching notes cannot be discarded here',
    staffRsvpNote: 'I approve replacing or clearing this exact note for every selected child, visible to me and authorized team staff',
    publicConfiguration: 'I approve the publicly readable configuration metadata and possible automatic analytics display changes described above',
    incentiveTerms: 'I also approve the incentive calculation changes described above; this does not transfer money or record a payment' });
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
