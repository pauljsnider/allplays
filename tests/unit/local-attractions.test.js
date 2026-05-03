import { describe, expect, it } from 'vitest';
import {
  normalizeExternalWebsiteUrl,
  normalizeLocalAttractionSponsors
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
});
