// @vitest-environment jsdom

import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ScheduleEventHeader } from '../../apps/app/src/components/schedule/ScheduleEventHeader';
import { EventDetailsPanel } from '../../apps/app/src/components/schedule/EventDetailsPanel';

describe('EventDetailsPanel calendar locations', () => {
  it('renders an imported calendar field detail with its venue', () => {
    render(
      <EventDetailsPanel
        open
        event={{
          eventKey: 'team-1::calendar-1::player-1',
          id: 'calendar-1',
          teamId: 'team-1',
          teamName: 'Mustangs',
          type: 'game',
          date: new Date('2026-06-19T18:00:00.000Z'),
          location: 'Blue Valley Recreation Sports Complex',
          locationDetail: 'Field 14',
          opponent: 'Jaguars',
          childId: 'player-1',
          childName: 'Avery',
          isDbGame: false,
          isCancelled: false,
          assignments: [],
          openAssignmentCount: 0
        }}
      />
    );

    expect(screen.getByText('Field 14')).toBeTruthy();
    expect(screen.getByText('Location')).toBeTruthy();
    expect(screen.getByText('Blue Valley Recreation Sports Complex')).toBeTruthy();
    expect(screen.queryByText('Field / court')).toBeNull();
  });

  it('surfaces the field in the existing event summary metadata line', () => {
    render(
      <ScheduleEventHeader
        date={new Date('2026-06-19T18:00:00.000Z')}
        teamName="Mustangs"
        eventType="game"
        title="Mustangs vs Jaguars"
        timeLabel="Starts 1:00 PM"
        location="Blue Valley Recreation Sports Complex"
        locationDetail="Field 14"
        playerSummary={<span>Avery · Mustangs</span>}
        rsvpLabel="RSVP needed"
        rsvpClassName="text-primary-800"
        briefPieces={[]}
      />
    );

    const fieldDetail = screen.getByTestId('event-location-detail');
    expect(fieldDetail.textContent).toContain('Field 14');
    expect(fieldDetail.parentElement?.textContent).toContain('Starts 1:00 PMField 14Blue Valley Recreation Sports Complex');
    expect(screen.getByLabelText('Field or court: Field 14')).toBeTruthy();
  });
});
