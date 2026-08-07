import { describe, expect, it, vi } from 'vitest';
import { listNativeFirestoreCollectionPages } from './nativeFirestoreListPager';

describe('listNativeFirestoreCollectionPages', () => {
  it('aggregates pages and URL-encodes the returned page token', async () => {
    const request = vi.fn()
      .mockResolvedValueOnce({ documents: ['first'], nextPageToken: 'page token+/=' })
      .mockResolvedValueOnce({ documents: ['second'] });

    await expect(listNativeFirestoreCollectionPages('teams/team-1/players', request)).resolves.toEqual([
      'first',
      'second'
    ]);

    expect(request).toHaveBeenNthCalledWith(1, '/teams/team-1/players?pageSize=100');
    expect(request).toHaveBeenNthCalledWith(
      2,
      '/teams/team-1/players?pageSize=100&pageToken=page+token%2B%2F%3D'
    );
  });

  it('performs exactly one request for a completed single-page response', async () => {
    const request = vi.fn().mockResolvedValue({ documents: ['only'] });

    await expect(listNativeFirestoreCollectionPages('teams/team-1/players', request)).resolves.toEqual(['only']);
    expect(request).toHaveBeenCalledTimes(1);
  });

  it('rejects repeated page tokens instead of returning a partial collection', async () => {
    const request = vi.fn()
      .mockResolvedValueOnce({ documents: ['first'], nextPageToken: 'repeat' })
      .mockResolvedValueOnce({ documents: ['second'], nextPageToken: 'repeat' });

    await expect(listNativeFirestoreCollectionPages('teams/team-1/players', request))
      .rejects.toThrow('repeated nextPageToken');
  });

  it('rejects page and document safety-cap exhaustion', async () => {
    const unfinishedPage = vi.fn().mockResolvedValue({ documents: ['first'], nextPageToken: 'more' });
    await expect(listNativeFirestoreCollectionPages('teams/team-1/players', unfinishedPage, { maxPages: 1 }))
      .rejects.toThrow('1-page safety cap');

    const oversizedPage = vi.fn().mockResolvedValue({ documents: ['first', 'second'] });
    await expect(listNativeFirestoreCollectionPages('teams/team-1/players', oversizedPage, { maxDocuments: 1 }))
      .rejects.toThrow('1-document safety cap');
  });
});
