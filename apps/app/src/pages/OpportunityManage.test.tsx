// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { OpportunityManage } from './OpportunityManage';

const serviceMocks = vi.hoisted(() => ({
  closePublicOpportunity: vi.fn(),
  listMyPublicOpportunities: vi.fn(),
  listOpportunityInquiries: vi.fn(),
  listPublicOpportunityReports: vi.fn(),
  moderatePublicOpportunity: vi.fn(),
  renewPublicOpportunity: vi.fn()
}));

vi.mock('../lib/opportunityService', () => serviceMocks);

beforeEach(() => {
  vi.clearAllMocks();
  serviceMocks.listMyPublicOpportunities.mockResolvedValue([]);
  serviceMocks.listPublicOpportunityReports.mockResolvedValue([]);
});

afterEach(() => cleanup());

describe('OpportunityManage inquiry pagination', () => {
  it('keeps pagination available when inaccessible inquiries fill an empty page', async () => {
    serviceMocks.listOpportunityInquiries
      .mockResolvedValueOnce({ items: [], nextCursor: 'next-page' })
      .mockResolvedValueOnce({
        items: [{ id: 'inquiry-1', listingTitle: 'Assistant coach wanted', status: 'open' }],
        nextCursor: null
      });

    render(
      <MemoryRouter>
        <OpportunityManage auth={{ user: { uid: 'user-1' } } as any} />
      </MemoryRouter>
    );

    await screen.findByText('No listings yet');
    fireEvent.click(screen.getByRole('button', { name: 'Inquiries (0)' }));
    expect(screen.getByText('No inquiries on this page')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Load more inquiries' }));
    await waitFor(() => expect(serviceMocks.listOpportunityInquiries).toHaveBeenLastCalledWith('next-page'));
    expect(await screen.findByText('Assistant coach wanted')).toBeTruthy();
  });
});
