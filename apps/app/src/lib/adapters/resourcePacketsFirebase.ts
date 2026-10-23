import { functions as legacyFunctions, httpsCallable as legacyCallable } from '@legacy/firebase.js';

export async function resourcePacketCall(name: string, data: Record<string, unknown>): Promise<unknown> {
  const call = legacyCallable(legacyFunctions, name) as (input: Record<string, unknown>) => Promise<{ data: unknown }>;
  return (await call(data)).data;
}
