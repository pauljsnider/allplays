import { isNativeRuntime } from '../nativeRuntime';

export async function resourcePacketCall(name: string, data: Record<string, unknown>, expectedUid?: string): Promise<unknown> {
  if (isNativeRuntime()) {
    const { callNativeFirebaseFunction } = await import('../nativeCallable');
    return callNativeFirebaseFunction(name, data, { errorLabel: 'Video assignment request', ...(expectedUid ? { expectedUid } : {}) });
  }
  const { functions, httpsCallable } = await import('@legacy/firebase.js');
  const call = httpsCallable(functions, name) as (input: Record<string, unknown>) => Promise<{ data: unknown }>;
  return (await call(data)).data;
}
