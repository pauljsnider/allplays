import { collection, db, doc, getDoc, getDocs, serverTimestamp, setDoc, updateDoc } from './adapters/legacyRegistrationFormAdminDb';
import {
  buildAppRegistrationFormAdminPayload,
  buildRegistrationFormEditorDraft,
  type RegistrationFormAdminPayloadResult,
  type RegistrationFormEditorDraft
} from './registrationFormAdmin';
import type { AuthUser } from './types';

export type SaveRegistrationFormEditorForAppInput = {
  user: AuthUser | null;
  teamId: string;
  formId?: string;
  draft: Partial<RegistrationFormEditorDraft>;
  now?: Date;
};

export type SaveRegistrationFormEditorForAppResult = RegistrationFormAdminPayloadResult & {
  formId: string;
  created: boolean;
};

function getRegistrationOptionCountKey(optionId: unknown) {
  return compactString(optionId).replace(/[^A-Za-z0-9_-]/g, '_') || 'option';
}

function buildRegistrationOptionCounts(
  registrationOptions: Array<Record<string, unknown>>,
  existingCounts: Record<string, any> = {}
) {
  const counts = { ...existingCounts };
  registrationOptions.forEach((option) => {
    const optionId = compactString(option.id);
    const countKey = getRegistrationOptionCountKey(optionId);
    const existing = existingCounts[countKey] || existingCounts[optionId] || {};
    counts[countKey] = {
      ...existing,
      enrolled: Math.max(0, Number(existing.enrolled) || 0),
      waitlisted: Math.max(0, Number(existing.waitlisted) || 0)
    };
  });
  return counts;
}

export async function listRegistrationFormEditorsForApp(
  user: AuthUser | null,
  teamId: string
): Promise<RegistrationFormEditorDraft[]> {
  const normalizedTeamId = compactString(teamId);
  assertCanManageRegistrationForms(user, normalizedTeamId);

  const snapshot = await getDocs(collection(db, 'teams', normalizedTeamId, 'registrationForms'));
  return (snapshot?.docs || [])
    .map((formDoc: any) => buildRegistrationFormEditorDraft({
      ...(formDoc?.data?.() || {}),
      id: compactString(formDoc?.id)
    }, {
      teamId: normalizedTeamId,
      formId: compactString(formDoc?.id)
    }))
    .sort((left: RegistrationFormEditorDraft, right: RegistrationFormEditorDraft) => (
      left.title.localeCompare(right.title, undefined, { sensitivity: 'base' })
    ));
}

export async function loadRegistrationFormEditorForApp(
  user: AuthUser | null,
  teamId: string,
  formId: string
): Promise<RegistrationFormEditorDraft> {
  const normalizedTeamId = compactString(teamId);
  const normalizedFormId = compactString(formId);
  assertCanManageRegistrationForms(user, normalizedTeamId);
  if (!normalizedFormId) throw new Error('Registration form is required.');

  const formSnap = await getDoc(doc(db, 'teams', normalizedTeamId, 'registrationForms', normalizedFormId));
  const form = formSnap?.exists?.() ? { id: normalizedFormId, ...(formSnap.data() || {}) } : null;
  if (!form) throw new Error('Registration form not found.');

  return buildRegistrationFormEditorDraft(form, {
    teamId: normalizedTeamId,
    formId: normalizedFormId
  });
}

export async function saveRegistrationFormEditorForApp({
  user,
  teamId,
  formId = '',
  draft,
  now
}: SaveRegistrationFormEditorForAppInput): Promise<SaveRegistrationFormEditorForAppResult> {
  const normalizedTeamId = compactString(teamId || draft.teamId);
  const normalizedFormId = compactString(formId || draft.formId);
  assertCanManageRegistrationForms(user, normalizedTeamId);

  const result = buildAppRegistrationFormAdminPayload({
    ...draft,
    teamId: normalizedTeamId,
    formId: normalizedFormId
  }, {
    teamId: normalizedTeamId,
    now
  });
  if (result.errors.length) {
    throw new Error(result.errors.join(' '));
  }

  const actorId = compactString(user?.uid) || null;
  const timestamp = serverTimestamp();
  const formRef = normalizedFormId
    ? doc(db, 'teams', normalizedTeamId, 'registrationForms', normalizedFormId)
    : doc(collection(db, `teams/${normalizedTeamId}/registrationForms`));
  const existingForm = normalizedFormId
    ? await getDoc(formRef).then((snapshot: any) => snapshot?.exists?.() ? snapshot.data() || {} : {})
    : {};
  const updatePayload = {
    ...result.payload,
    teamId: normalizedTeamId,
    registrationOptionCounts: buildRegistrationOptionCounts(
      Array.isArray(result.payload.registrationOptions) ? result.payload.registrationOptions : [],
      existingForm.registrationOptionCounts || {}
    ),
    updatedAt: timestamp,
    updatedBy: actorId
  };

  if (normalizedFormId) {
    await updateDoc(formRef, updatePayload);
    return {
      ...result,
      formId: normalizedFormId,
      created: false
    };
  }

  await setDoc(formRef, {
    ...updatePayload,
    createdAt: timestamp,
    createdBy: actorId
  });

  return {
    ...result,
    formId: compactString(formRef?.id),
    created: true
  };
}

export function canManageRegistrationFormsForApp(user: AuthUser | null, teamId: string) {
  const normalizedTeamId = compactString(teamId);
  if (!normalizedTeamId || !user?.uid) return false;
  if (user.isAdmin === true || user.isPlatformAdmin === true) return true;
  if (Array.isArray(user.roles) && user.roles.some((role) => role === 'admin' || role === 'platformAdmin')) return true;
  return Array.isArray(user.coachOf) && user.coachOf.map(compactString).includes(normalizedTeamId);
}

function assertCanManageRegistrationForms(user: AuthUser | null, teamId: string) {
  if (!compactString(teamId)) throw new Error('Team is required.');
  if (!canManageRegistrationFormsForApp(user, teamId)) {
    throw new Error('Admin access is required to manage registration forms.');
  }
}

function compactString(value: unknown) {
  return String(value || '').trim();
}
