export const PRIVATE_AI_PENDING_PAYLOAD_MAX_JSON_BYTES = 700 * 1024;

export function getSerializedUtf8ByteLength(value: unknown) {
  const serialized = JSON.stringify(value);
  return new TextEncoder().encode(serialized).byteLength;
}

export function assertPrivateAiPendingPayloadFitsFirestore(
  workflow: 'roster' | 'schedule',
  args: Record<string, unknown>,
  artifact: Record<string, unknown> | null | undefined
) {
  const byteLength = getSerializedUtf8ByteLength({
    args,
    ...(artifact ? { artifact } : {})
  });
  if (byteLength <= PRIVATE_AI_PENDING_PAYLOAD_MAX_JSON_BYTES) return byteLength;

  throw new Error(
    `This ${workflow} import is too large to review safely in one chat. `
    + 'Split it into smaller files with fewer rows or shorter notes, then try again.'
  );
}
