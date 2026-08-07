import { describe, expect, it } from 'vitest';
import { generateKeyPairSync } from 'node:crypto';

import {
  loadListingPackage,
  readPngInfo,
  syncListing,
  validateListing,
  validatePng
} from '../../scripts/sync-play-listing.mjs';

describe('Google Play listing package', () => {
  it('contains valid copy and every required launch graphic', async () => {
    const listingPackage = await loadListingPackage();

    expect(listingPackage.listing.title).toBe('ALL PLAYS');
    expect(listingPackage.details.contactEmail).toBe('support@allplays.ai');
    expect(listingPackage.images.map((image) => image.imageType)).toEqual([
      'icon',
      'featureGraphic',
      'phoneScreenshots',
      'phoneScreenshots'
    ]);
  });

  it('rejects copy that exceeds Google Play limits', () => {
    expect(() => validateListing({
      language: 'en-US',
      title: 'ALL PLAYS',
      shortDescription: 'x'.repeat(81),
      fullDescription: 'Valid description'
    })).toThrow(/Short description exceeds 80/);
  });

  it('rejects screenshots with unsupported aspect ratios', () => {
    expect(() => validatePng({
      width: 390,
      height: 844,
      bitDepth: 8,
      colorType: 2,
      byteLength: 1000
    }, 'phoneScreenshot', 'too-tall.png')).toThrow(/longest side/);
  });

  it('reads committed PNG dimensions without image-library dependencies', async () => {
    const listingPackage = await loadListingPackage();
    const icon = listingPackage.images.find((image) => image.imageType === 'icon');

    expect(readPngInfo(icon.bytes, icon.fileName)).toMatchObject({
      width: 512,
      height: 512,
      colorType: 6
    });
  });

  it('commits listing text and every validated image in one Play edit', async () => {
    const listingPackage = await loadListingPackage();
    const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
    const serviceAccount = {
      client_email: 'publisher@example.iam.gserviceaccount.com',
      private_key: privateKey.export({ type: 'pkcs8', format: 'pem' })
    };
    const requests = [];
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (url, options = {}) => {
      requests.push({ url: String(url), method: options.method || 'GET' });
      if (String(url).includes('oauth2.googleapis.com/token')) {
        return Response.json({ access_token: 'test-token' });
      }
      if (String(url).endsWith('/edits') && options.method === 'POST') {
        return Response.json({ id: 'edit-1' });
      }
      return Response.json({});
    };

    try {
      await syncListing({ listingPackage, serviceAccount, packageName: 'ai.allplays.lite' });
    } finally {
      globalThis.fetch = originalFetch;
    }

    expect(requests.filter((request) => request.url.includes('upload/androidpublisher')).length).toBe(4);
    expect(requests.some((request) => request.url.endsWith('/details') && request.method === 'PUT')).toBe(true);
    expect(requests.some((request) => request.url.endsWith('/listings/en-US') && request.method === 'PUT')).toBe(true);
    expect(requests.at(-1)).toMatchObject({ method: 'POST' });
    expect(requests.at(-1).url.endsWith('/edits/edit-1:commit')).toBe(true);
  });

  it('abandons the edit instead of committing partial listing uploads', async () => {
    const listingPackage = await loadListingPackage();
    const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
    const serviceAccount = {
      client_email: 'publisher@example.iam.gserviceaccount.com',
      private_key: privateKey.export({ type: 'pkcs8', format: 'pem' })
    };
    const requests = [];
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (url, options = {}) => {
      requests.push({ url: String(url), method: options.method || 'GET' });
      if (String(url).includes('oauth2.googleapis.com/token')) {
        return Response.json({ access_token: 'test-token' });
      }
      if (String(url).endsWith('/edits') && options.method === 'POST') {
        return Response.json({ id: 'edit-2' });
      }
      if (String(url).includes('upload/androidpublisher')) {
        return Response.json({ error: { message: 'rejected image' } }, { status: 400 });
      }
      return Response.json({});
    };

    try {
      await expect(syncListing({ listingPackage, serviceAccount, packageName: 'ai.allplays.lite' }))
        .rejects.toThrow('rejected image');
    } finally {
      globalThis.fetch = originalFetch;
    }

    expect(requests.some((request) => request.url.endsWith('/edits/edit-2:commit'))).toBe(false);
    expect(requests.at(-1)).toMatchObject({ method: 'DELETE' });
    expect(requests.at(-1).url.endsWith('/edits/edit-2')).toBe(true);
  });
});
