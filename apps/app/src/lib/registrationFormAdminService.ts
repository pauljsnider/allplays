import { collection, db, doc, documentId, getDoc, getDocs, limit, orderBy, query, runTransaction, serverTimestamp, setDoc, startAfter } from './adapters/legacyRegistrationFormAdminDb';
import { buildRegistrationOptionCountKey } from './adapters/legacyRegistrationFormAdmin';
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

export type RegistrationFormEditorPage = {
  forms: RegistrationFormEditorDraft[];
  lastDoc: unknown | null;
  hasMore: boolean;
};

const REGISTRATION_FORM_EDITOR_PAGE_SIZE = 25;

function buildInitialRegistrationOptionCounts(
  registrationOptions: Array<Record<string, unknown>>
) {
  const counts: Record<string, { enrolled: number; waitlisted: number }> = {};
  registrationOptions.forEach((option) => {
    const optionId = compactString(option.id);
    const countKey = buildRegistrationOptionCountKey(optionId);
    counts[countKey] = {
      enrolled: 0,
      waitlisted: 0
    };
  });
  return counts;
}

function buildMissingRegistrationOptionCountUpdates(
  registrationOptions: Array<Record<string, unknown>>,
  existingCounts: Record<string, any> = {}
) {
  const updates: Record<string, unknown> = {};
  registrationOptions.forEach((option) => {
    const optionId = compactString(option.id);
    const countKey = buildRegistrationOptionCountKey(optionId);
    if (Object.prototype.hasOwnProperty.call(existingCounts, countKey)) return;

    const legacyCounts = existingCounts[optionId] || {};
    updates[`registrationOptionCounts.${countKey}`] = {
      ...legacyCounts,
      enrolled: Math.max(0, Number(legacyCounts.enrolled) || 0),
      waitlisted: Math.max(0, Number(legacyCounts.waitlisted) || 0)
    };
  });
  return updates;
}

export async function listRegistrationFormEditorsForApp(
  user: AuthUser | null,
  teamId: string,
  afterDoc: unknown | null = null
): Promise<RegistrationFormEditorPage> {
  const normalizedTeamId = compactString(teamId);
  assertCanManageRegistrationForms(user, normalizedTeamId);

  const formsRef = collection(db, 'teams', normalizedTeamId, 'registrationForms');
  const constraints = [orderBy(documentId())];
  if (afterDoc) constraints.push(startAfter(afterDoc));
  constraints.push(limit(REGISTRATION_FORM_EDITOR_PAGE_SIZE + 1));
  const snapshot = await getDocs(query(formsRef, ...constraints));
  const pageDocs = (snapshot?.docs || []);
  return {
    forms: pageDocs.slice(0, REGISTRATION_FORM_EDITOR_PAGE_SIZE)
    .map((formDoc: any) => buildRegistrationFormEditorDraft({
      ...(formDoc?.data?.() || {}),
      id: compactString(formDoc?.id)
    }, {
      teamId: normalizedTeamId,
      formId: compactString(formDoc?.id)
    }))
    .sort((left: RegistrationFormEditorDraft, right: RegistrationFormEditorDraft) => (
      left.title.localeCompare(right.title, undefined, { sensitivity: 'base' })
    )),
    lastDoc: pageDocs[Math.min(REGISTRATION_FORM_EDITOR_PAGE_SIZE - 1, pageDocs.length - 1)] || null,
    hasMore: pageDocs.length > REGISTRATION_FORM_EDITOR_PAGE_SIZE
  };
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
  const registrationOptions = Array.isArray(result.payload.registrationOptions)
    ? result.payload.registrationOptions
    : [];
  const updatePayload = {
    ...result.payload,
    teamId: normalizedTeamId,
    updatedAt: timestamp,
    updatedBy: actorId
  };

  if (normalizedFormId) {
    // Capacity counters are updated transactionally by public submissions.
    // Read them in the same transaction as the editor update so a concurrent
    // submission or editor cannot have its counter overwritten by stale state.
    await runTransaction(db, async (transaction: any) => {
      const snapshot = await transaction.get(formRef);
      const existingForm = snapshot?.exists?.() ? snapshot.data() || {} : {};
      transaction.update(formRef, {
        ...updatePayload,
        ...buildMissingRegistrationOptionCountUpdates(
          registrationOptions,
          existingForm.registrationOptionCounts || {}
        )
      });
    });
    return {
      ...result,
      formId: normalizedFormId,
      created: false
    };
  }

  await setDoc(formRef, {
    ...updatePayload,
    registrationOptionCounts: buildInitialRegistrationOptionCounts(registrationOptions),
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
