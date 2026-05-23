export const VOLUNTEER_SCREENING_BLOCK_MESSAGE = 'Screening must be cleared before volunteer or staff access can be granted.';

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
