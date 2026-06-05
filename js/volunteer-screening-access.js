export const VOLUNTEER_SCREENING_BLOCK_MESSAGE = 'Screening must be cleared before volunteer or staff access can be granted.';
export const VOLUNTEER_SCREENING_QUERY_FIELDS = Object.freeze({
    userId: Object.freeze([
        'userId',
        'uid',
        'createdBy',
        'submittedBy',
        'submittedByUserId',
        'participant.userId',
        'participant.uid',
        'guardian.userId',
        'guardian.uid'
    ]),
    email: Object.freeze([
        'email',
        'userEmail',
        'submittedByEmail',
        'participant.email',
        'guardian.email',
        'guardian.guardianEmail'
    ])
});

export function normalizeScreeningStatus(value = '') {
    return String(value || '').trim().toLowerCase().replace(/[\s_-]+/g, '-');
}

function normalizeRegistrationScreeningText(value = '') {
    return String(value || '').trim().toLowerCase();
}

function appCreatedRegistrationRequiresVolunteerScreening(registration = {}) {
    if (registration?.source !== 'public-registration') return false;

    const screeningText = [
        registration.programName,
        registration.title,
        registration.selectedOption?.title,
        registration.selectedOption?.label,
        registration.selectedOption?.id
    ].map(normalizeRegistrationScreeningText).filter(Boolean).join(' ');

    return /\b(volunteer|staff|scorekeeper|stream(?:ing)?|official|referee|background check)\b/.test(screeningText);
}

export function registrationRequiresVolunteerScreening(registration = {}) {
    return registration?.requiresScreening === true
        || registration?.screeningRequired === true
        || registration?.volunteerScreeningRequired === true
        || registration?.backgroundCheckRequired === true
        || registration?.screening?.required === true
        || registration?.backgroundCheck?.required === true
        || appCreatedRegistrationRequiresVolunteerScreening(registration);
}

export function getRegistrationScreeningStatus(registration = {}) {
    return normalizeScreeningStatus(
        registration?.screeningStatus
        || registration?.volunteerScreeningStatus
        || registration?.backgroundCheckStatus
        || registration?.screening?.status
        || registration?.backgroundCheck?.status
        || ''
    );
}

export function isRegistrationScreeningCleared(registration = {}) {
    return getRegistrationScreeningStatus(registration) === 'cleared';
}

export function registrationMatchesVolunteerTarget(registration = {}, target = {}) {
    const targetUserId = String(target.userId || '').trim();
    const targetEmail = String(target.email || '').trim().toLowerCase();
    if (!targetUserId && !targetEmail) return false;

    const registrationUserIds = [
        registration.userId,
        registration.uid,
        registration.createdBy,
        registration.submittedBy,
        registration.submittedByUserId,
        registration.participant?.userId,
        registration.participant?.uid,
        registration.guardian?.userId,
        registration.guardian?.uid
    ].map((value) => String(value || '').trim()).filter(Boolean);

    if (targetUserId && registrationUserIds.includes(targetUserId)) return true;

    const registrationEmails = [
        registration.email,
        registration.userEmail,
        registration.submittedByEmail,
        registration.participant?.email,
        registration.guardian?.email,
        registration.guardian?.guardianEmail
    ].map((value) => String(value || '').trim().toLowerCase()).filter(Boolean);

    return Boolean(targetEmail && registrationEmails.includes(targetEmail));
}

export function buildVolunteerScreeningTargetQueries(target = {}) {
    const normalizedTarget = {
        userId: String(target.userId || '').trim(),
        email: String(target.email || '').trim().toLowerCase()
    };

    const querySpecs = [];
    if (normalizedTarget.userId) {
        VOLUNTEER_SCREENING_QUERY_FIELDS.userId.forEach((fieldPath) => {
            querySpecs.push({ fieldPath, value: normalizedTarget.userId });
        });
    }
    if (normalizedTarget.email) {
        VOLUNTEER_SCREENING_QUERY_FIELDS.email.forEach((fieldPath) => {
            querySpecs.push({ fieldPath, value: normalizedTarget.email });
        });
    }

    const uniqueSpecs = new Map();
    querySpecs.forEach((spec) => {
        uniqueSpecs.set(`${spec.fieldPath}::${spec.value}`, spec);
    });
    return Array.from(uniqueSpecs.values());
}

function getVolunteerScreeningRegistrationKey(registration = {}) {
    const path = String(registration.refPath || registration.path || registration._path || '').trim();
    if (path) return path;

    const formId = String(registration.formId || '').trim();
    const id = String(registration.id || '').trim();
    if (formId && id) return `${formId}::${id}`;
    return id;
}

export async function loadVolunteerScreeningTargetRegistrations(target = {}, loadMatches) {
    if (typeof loadMatches !== 'function') {
        throw new Error('A registration lookup loader is required.');
    }

    const querySpecs = buildVolunteerScreeningTargetQueries(target);
    if (querySpecs.length === 0) return [];

    const registrationsByKey = new Map();
    const lookupResults = await Promise.all(querySpecs.map((spec) => Promise.resolve(loadMatches(spec))));
    lookupResults.forEach((records) => {
        (Array.isArray(records) ? records : []).forEach((registration) => {
            const key = getVolunteerScreeningRegistrationKey(registration);
            if (!key) return;
            registrationsByKey.set(key, registration);
        });
    });

    return Array.from(registrationsByKey.values());
}

export function findBlockingVolunteerScreeningRegistration(registrations = [], target = {}) {
    if (!Array.isArray(registrations)) return null;

    return registrations.find((registration) => (
        registrationMatchesVolunteerTarget(registration, target)
        && registrationRequiresVolunteerScreening(registration)
        && !isRegistrationScreeningCleared(registration)
    )) || null;
}

export function assertVolunteerScreeningCleared(registrations = [], target = {}) {
    const blockingRegistration = findBlockingVolunteerScreeningRegistration(registrations, target);
    if (!blockingRegistration) return null;

    const programName = String(blockingRegistration.programName || blockingRegistration.title || '').trim();
    throw new Error(programName
        ? `${VOLUNTEER_SCREENING_BLOCK_MESSAGE} Related registration: ${programName}.`
        : VOLUNTEER_SCREENING_BLOCK_MESSAGE);
}
