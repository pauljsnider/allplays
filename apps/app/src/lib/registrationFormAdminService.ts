import { collection, db, doc, getDoc, serverTimestamp, setDoc, updateDoc } from './adapters/legacyRegistrationFormAdminDb';
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
  const updatePayload = {
    ...result.payload,
    teamId: normalizedTeamId,
    updatedAt: timestamp,
    updatedBy: actorId
  };

  if (normalizedFormId) {
    await updateDoc(doc(db, 'teams', normalizedTeamId, 'registrationForms', normalizedFormId), updatePayload);
    return {
      ...result,
      formId: normalizedFormId,
      created: false
    };
  }

  const formRef = doc(collection(db, `teams/${normalizedTeamId}/registrationForms`));
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
