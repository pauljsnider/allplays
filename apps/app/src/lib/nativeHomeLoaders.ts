import { loadManagedTeamsFromNativeCallable, loadProfileDocument } from './profileService';

export function loadNativeHomeProfile(userId: string) {
  return loadProfileDocument(userId);
}

export function loadNativeHomeManagedTeams() {
  return loadManagedTeamsFromNativeCallable({
    includeChatMetadata: true,
    timeoutMs: 15000
  });
}
