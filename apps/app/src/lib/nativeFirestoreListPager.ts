export const nativeFirestoreListDefaultPageSize = 100;
export const nativeFirestoreListDefaultMaxPages = 20;
export const nativeFirestoreListDefaultMaxDocuments = 2000;

type NativeFirestoreListResponse<T> = {
  documents?: T[];
  nextPageToken?: unknown;
};

type NativeFirestoreListPagerOptions = {
  pageSize?: number;
  orderBy?: string;
  maxPages?: number;
  maxDocuments?: number;
};

function requirePositiveInteger(value: number, label: string) {
  if (!Number.isInteger(value) || value < 1) {
    throw new Error(`Native Firestore roster pager ${label} must be a positive integer.`);
  }
  return value;
}

export async function listNativeFirestoreCollectionPages<T>(
  path: string,
  request: (requestPath: string) => Promise<NativeFirestoreListResponse<T>>,
  options: NativeFirestoreListPagerOptions = {}
): Promise<T[]> {
  const pageSize = requirePositiveInteger(
    options.pageSize ?? nativeFirestoreListDefaultPageSize,
    'pageSize'
  );
  const maxPages = requirePositiveInteger(
    options.maxPages ?? nativeFirestoreListDefaultMaxPages,
    'maxPages'
  );
  const maxDocuments = requirePositiveInteger(
    options.maxDocuments ?? nativeFirestoreListDefaultMaxDocuments,
    'maxDocuments'
  );
  const documents: T[] = [];
  const seenPageTokens = new Set<string>();
  let pageToken: string | null = null;

  for (let pageCount = 1; pageCount <= maxPages; pageCount += 1) {
    const params = new URLSearchParams();
    params.set('pageSize', String(pageSize));
    if (options.orderBy) params.set('orderBy', options.orderBy);
    if (pageToken !== null) params.set('pageToken', pageToken);

    const payload = await request(`/${path}?${params.toString()}`);
    const pageDocuments = Array.isArray(payload?.documents) ? payload.documents : [];
    if (documents.length + pageDocuments.length > maxDocuments) {
      throw new Error(`Native Firestore roster pager exceeded the ${maxDocuments}-document safety cap.`);
    }
    documents.push(...pageDocuments);

    const nextPageToken = payload?.nextPageToken;
    if (nextPageToken === undefined || nextPageToken === null || nextPageToken === '') {
      return documents;
    }
    if (typeof nextPageToken !== 'string') {
      throw new Error('Native Firestore roster pager received an invalid nextPageToken.');
    }
    if (seenPageTokens.has(nextPageToken)) {
      throw new Error('Native Firestore roster pager received a repeated nextPageToken.');
    }
    seenPageTokens.add(nextPageToken);

    if (documents.length >= maxDocuments) {
      throw new Error(`Native Firestore roster pager reached the ${maxDocuments}-document safety cap before completion.`);
    }
    if (pageCount === maxPages) {
      throw new Error(`Native Firestore roster pager reached the ${maxPages}-page safety cap before completion.`);
    }
    pageToken = nextPageToken;
  }

  throw new Error('Native Firestore roster pager stopped before the collection completed.');
}
