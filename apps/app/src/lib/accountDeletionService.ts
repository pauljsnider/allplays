import { functions, httpsCallable } from './adapters/legacyAccountDb';

export type AccountDeletionResult = {
  success: boolean;
  status: 'queued';
  completionTargetDays: number;
};

export async function requestAccountDeletion(source = 'app'): Promise<AccountDeletionResult> {
  const callable = httpsCallable(functions, 'requestAccountDeletion');
  const response = await callable({
    confirmation: 'DELETE',
    source
  });
  return response.data as AccountDeletionResult;
}
