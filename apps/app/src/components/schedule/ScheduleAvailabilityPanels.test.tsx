// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { AttentionPanel } from './AttentionPanel';
import { AvailabilityNotesList } from './AvailabilityNotesList';
import { QuickAvailabilityPanel } from './QuickAvailabilityPanel';
import type { ParentScheduleEvent, RsvpResponse } from '../../lib/scheduleLogic';

function buildEvent(overrides: Partial<ParentScheduleEvent> = {}): ParentScheduleEvent {
  return {
    eventKey: 'team-1::game-1::player-1::2026-06-04T18:00:00.000Z::game',
    id: 'game-1',
    teamId: 'team-1',
    teamName: 'Bears',
    type: 'game',
    date: new Date('2026-06-04T18:00:00.000Z'),
    location: 'Main Gym',
    opponent: 'Wolves',
    childId: 'player-1',
    childName: 'Avery Smith',
    isDbGame: true,
    isCancelled: false,
    status: 'scheduled',
    assignments: [],
    myRsvp: 'not_responded',
    myRsvpNote: '',
    rsvpSummary: { going: 1, maybe: 1, notGoing: 1, notResponded: 1, total: 4 },
    rideshareSummary: { offerCount: 0, seatsLeft: 0, requests: 0, pending: 0, confirmed: 0, isFull: false },
    availabilityLocked: false,
    availabilityNotesVisible: false,
    availabilityNotes: [],
    isTeamAdmin: false,
    isTeamStaff: false,
    isTeamRsvpReminderManager: false,
    canUpdateScore: false,
    calendarUrls: [],
    ...overrides
  } as ParentScheduleEvent;
}

describe('QuickAvailabilityPanel', () => {
  it('renders unsaved note state and routes actions through callbacks', () => {
    const onAvailabilityNoteChange = vi.fn();
    const onSubmit = vi.fn<(response: Exclude<RsvpResponse, 'not_responded'>) => Promise<void>>(() => Promise.resolve());

    render(
      <QuickAvailabilityPanel
        event={buildEvent({ myRsvp: 'going', myRsvpNote: 'Bring a snack', availabilityNotesVisible: true })}
        rsvp="going"
        canSubmitRsvp={true}
        submitting={null}
        availabilityNote=" Bring a bigger snack "
        onAvailabilityNoteChange={onAvailabilityNoteChange}
        onSubmit={onSubmit}
      />
    );

    expect(screen.getByText('Unsaved note changes')).toBeTruthy();
    expect(screen.getByText('Team note sharing is on for this team.')).toBeTruthy();

    fireEvent.change(screen.getByLabelText('Availability note'), { target: { value: 'Updated note' } });
    expect(onAvailabilityNoteChange).toHaveBeenCalledWith('Updated note');

    fireEvent.click(screen.getByRole('button', { name: 'Save note' }));
    expect(onSubmit).toHaveBeenCalledWith('going');
  });

  it('renders disabled controls and locked copy when availability is closed', () => {
    render(
      <QuickAvailabilityPanel
        event={buildEvent({ isDbGame: false })}
        rsvp="not_responded"
        canSubmitRsvp={false}
        submitting={null}
        availabilityNote=""
        onAvailabilityNoteChange={vi.fn()}
        onSubmit={vi.fn(() => Promise.resolve())}
      />
    );

    expect(screen.getByText('Availability needed')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Going' })).toBeDisabled();
    expect(screen.getByLabelText('Availability note')).toBeDisabled();
    expect(screen.queryByRole('button', { name: 'Save note' })).toBeNull();
    expect(screen.getByText('Availability is not open for this event.')).toBeTruthy();
  });
});

describe('AvailabilityNotesList', () => {
  it('renders nothing when note sharing is off or notes are empty', () => {
    const { rerender } = render(<AvailabilityNotesList event={buildEvent({ availabilityNotesVisible: false })} />);
    expect(screen.queryByText('Availability notes')).toBeNull();

    rerender(<AvailabilityNotesList event={buildEvent({ availabilityNotesVisible: true, availabilityNotes: [] })} />);
    expect(screen.queryByText('Availability notes')).toBeNull();
  });

  it('renders shared notes with normalized RSVP badges when populated', () => {
    render(
      <AvailabilityNotesList
        event={buildEvent({
          availabilityNotesVisible: true,
          availabilityNotes: [
            { displayName: 'Jordan Lee', response: 'going', note: 'Can bring snacks.' },
            { displayName: 'Casey Wu', response: 'unknown', note: 'Running late.' }
          ]
        })}
      />
    );

    expect(screen.getByText('Availability notes')).toBeTruthy();
    expect(screen.getByText('Jordan Lee')).toBeTruthy();
    expect(screen.getByText('Can bring snacks.')).toBeTruthy();
    expect(screen.getByText('Casey Wu')).toBeTruthy();
    expect(screen.getByText('Running late.')).toBeTruthy();
    expect(screen.getAllByText('Going').length).toBeGreaterThan(0);
    expect(screen.getAllByText('RSVP needed').length).toBeGreaterThan(0);
  });
});

describe('AttentionPanel', () => {
  it('renders the empty state when there is no attention item', () => {
    render(<AttentionPanel items={[]} onSelectSection={vi.fn()} />);

    expect(screen.getByText('All caught up')).toBeTruthy();
    expect(screen.getByText('No parent actions need attention right now.')).toBeTruthy();
  });

  it('renders primary and secondary actions and routes clicks through the callback', () => {
    const onSelectSection = vi.fn();

    render(
      <AttentionPanel
        items={[
          { title: 'Review assignments', detail: '2 assignments are still open.', section: 'assignments' },
          { title: 'Check rideshare', detail: '1 ride request needs attention.', section: 'rideshare' }
        ]}
        onSelectSection={onSelectSection}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: /Review assignments/i }));
    fireEvent.click(screen.getByRole('button', { name: 'Check rideshare' }));

    expect(onSelectSection).toHaveBeenNthCalledWith(1, 'assignments');
    expect(onSelectSection).toHaveBeenNthCalledWith(2, 'rideshare');
  });
});
