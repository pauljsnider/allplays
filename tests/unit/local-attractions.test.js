import { describe, expect, it } from 'vitest';
import {
  normalizeAdSpaceSponsors,
  normalizeExternalWebsiteUrl,
  normalizeLocalAttractionSponsors,
  selectRotatingSponsor
} from '../../js/local-attractions.js';

describe('local attraction sponsor helpers', () => {
  it('filters to published local attractions and sorts by configured order', () => {
    const sponsors = normalizeLocalAttractionSponsors([
      {
        id: 'zoo',
        name: 'Zoo',
        description: 'Open late',
        phone: '555-0100',
        website: 'zoo.example.com',
        imageUrl: 'https://img.example.com/zoo.jpg',
        published: true,
        localAttraction: true,
        sortOrder: 20
      },
      {
        id: 'museum',
        businessName: 'Museum',
        status: 'published',
        placements: ['local-attraction'],
        displayOrder: 10
      },
      {
        id: 'draft',
        name: 'Draft Place',
        published: false,
        localAttraction: true,
        sortOrder: 1
      },
      {
        id: 'banner',
        name: 'Banner Only',
        published: true,
        placement: 'banner',
        sortOrder: 2
      }
    ]);

    expect(sponsors.map((sponsor) => sponsor.name)).toEqual(['Museum', 'Zoo']);
    expect(sponsors[1]).toMatchObject({
      description: 'Open late',
      phone: '555-0100',
      imageUrl: 'https://img.example.com/zoo.jpg',
      websiteUrl: 'https://zoo.example.com/'
    });
  });

  it('rejects unsafe website protocols', () => {
    expect(normalizeExternalWebsiteUrl('javascript:alert(1)')).toBe('');
    expect(normalizeExternalWebsiteUrl('mailto:test@example.com')).toBe('');
    expect(normalizeExternalWebsiteUrl('https://safe.example.com/path')).toBe('https://safe.example.com/path');
  });

  it('normalizes only published ad-space sponsors with safe links', () => {
    const sponsors = normalizeAdSpaceSponsors([
      {
        id: 'pizza',
        name: 'Pizza Place',
        status: 'active',
        placements: ['ad-space'],
        websiteUrl: 'pizza.example.com',
        adImageUrl: 'https://img.example.com/pizza.png',
        rank: 2
      },
      {
        id: 'bank',
        businessName: 'Community Bank',
        published: true,
        isAdSpace: true,
        linkUrl: 'javascript:alert(1)',
        displayOrder: 1
      },
      {
        id: 'hidden',
        name: 'Hidden Sponsor',
        published: false,
        adSpace: true
      },
      {
        id: 'attraction',
        name: 'Attraction Only',
        published: true,
        localAttraction: true
      }
    ]);

    expect(sponsors.map((sponsor) => sponsor.name)).toEqual(['Community Bank', 'Pizza Place']);
    expect(sponsors[0].websiteUrl).toBe('');
    expect(sponsors[1]).toMatchObject({
      imageUrl: 'https://img.example.com/pizza.png',
      websiteUrl: 'https://pizza.example.com/'
    });
  });

  it('rotates away from the previously shown sponsor when possible', () => {
    const sponsors = [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }, { id: 'c', name: 'C' }];

    expect(selectRotatingSponsor(sponsors, 'a')).toEqual(sponsors[1]);
    expect(selectRotatingSponsor(sponsors, 'c')).toEqual(sponsors[0]);
    expect(selectRotatingSponsor([sponsors[0]], 'a')).toEqual(sponsors[0]);
  });
});
