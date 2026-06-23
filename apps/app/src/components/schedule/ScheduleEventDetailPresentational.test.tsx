// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { Users } from 'lucide-react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { StaffPracticeAttendance } from '../../lib/scheduleService';
import type { ParentScheduleEvent } from '../../lib/scheduleLogic';
import { AttentionPanel } from './AttentionPanel';
import { AvailabilityNotesList } from './AvailabilityNotesList';
import { CompactMeta } from './CompactMeta';
import { PracticeAttendancePanel } from './PracticeAttendancePanel';
import { ScoreStepper } from './ScoreStepper';
import { Status } from './ScheduleStatus';

afterEach(() => {
  cleanup();
});

function buildAttendance(overrides: Partial<StaffPracticeAttendance> = {}): StaffPracticeAttendance {
  return {
    sessionId: 'session-1',
    teamId: 'team-1',
    eventId: 'practice-1',
    rosterSize: 2,
    checkedInCount: 1,
    players: [
      { playerId: 'p1', displayName: 'Avery Smith', playerNumber: '1', status: 'present', checkedInAt: new Date('2026-06-04T17:55:00.000Z') },
      { playerId: 'p2', displayName: 'Blake Jones', playerNumber: '2', status: 'absent', checkedInAt: null }
    ],
    ...overrides
  };
}

function buildAvailabilityNotesEvent(overrides: Partial<ParentScheduleEvent>): ParentScheduleEvent {
  return {
    availabilityNotesVisible: true,
    availabilityNotes: [],
    ...overrides
  } as unknown as ParentScheduleEvent;
}

describe('ScheduleEventDetail presentational components', () => {
  it('renders compact metadata with the supplied icon and value', () => {
    render(<CompactMeta icon={Users} value="Avery Smith · Tigers" />);

    expect(screen.getByText('Avery Smith · Tigers')).toBeTruthy();
  });

  it('renders schedule status messages for success and error tones', () => {
    const { rerender } = render(<Status tone="success" message="Game schedule was updated." />);

    expect(screen.getByText('Game schedule was updated.')).toBeTruthy();

    rerender(<Status tone="error" message="Unable to update game." />);

    expect(screen.getByText('Unable to update game.')).toBeTruthy();
  });

  it('keeps score controls disabled at zero and routes stepper clicks', () => {
    const onDecrease = vi.fn();
    const onIncrease = vi.fn();
    const { rerender } = render(
      <ScoreStepper label="Home" value={0} onDecrease={onDecrease} onIncrease={onIncrease} disabled={false} />
    );

    expect(screen.getByRole('button', { name: 'Home score down' })).toHaveProperty('disabled', true);
    fireEvent.click(screen.getByRole('button', { name: 'Home score up' }));
    expect(onIncrease).toHaveBeenCalledTimes(1);
    expect(onDecrease).not.toHaveBeenCalled();

    rerender(<ScoreStepper label="Home" value={2} onDecrease={onDecrease} onIncrease={onIncrease} disabled={false} />);
    fireEvent.click(screen.getByRole('button', { name: 'Home score down' }));
    expect(onDecrease).toHaveBeenCalledTimes(1);

    rerender(<ScoreStepper label="Home" value={2} onDecrease={onDecrease} onIncrease={onIncrease} disabled />);
    expect(screen.getByRole('button', { name: 'Home score down' })).toHaveProperty('disabled', true);
    expect(screen.getByRole('button', { name: 'Home score up' })).toHaveProperty('disabled', true);
  });

  it('renders practice attendance rows and delegates status selection', () => {
    const onSelectStatus = vi.fn(() => Promise.resolve());
    const attendance = buildAttendance();
    const { rerender } = render(
      <PracticeAttendancePanel
        attendance={null}
        loading
        saving={false}
        savingPlayerId={null}
        onSelectStatus={onSelectStatus}
      />
    );

    expect(screen.getByText('Loading practice attendance...')).toBeTruthy();

    rerender(
      <PracticeAttendancePanel
        attendance={attendance}
        loading={false}
        saving={false}
        savingPlayerId={null}
        onSelectStatus={onSelectStatus}
      />
    );

    expect(screen.getByText('1/2 checked in')).toBeTruthy();
    expect(screen.getByText('#2 Blake Jones')).toBeTruthy();

    const row = screen.getByTestId('practice-attendance-row-p2');
    fireEvent.click(within(row).getByRole('button', { name: 'Late' }));

    expect(onSelectStatus).toHaveBeenCalledWith(attendance.players[1], 'late');

    rerender(
      <PracticeAttendancePanel
        attendance={attendance}
        loading={false}
        saving
        savingPlayerId="p2"
        onSelectStatus={onSelectStatus}
      />
    );

    within(screen.getByTestId('practice-attendance-row-p2')).getAllByRole('button').forEach((button) => {
      expect(button).toHaveProperty('disabled', true);
    });
  });

  it('renders no availability notes panel when notes are hidden or empty', () => {
    const hiddenEvent = buildAvailabilityNotesEvent({
      availabilityNotesVisible: false,
      availabilityNotes: [
        { displayName: 'Avery Smith', response: 'going', note: 'Can arrive early.' }
      ]
    });
    const { rerender } = render(<AvailabilityNotesList event={hiddenEvent} />);

    expect(screen.queryByText('Availability notes')).toBeNull();

    rerender(<AvailabilityNotesList event={buildAvailabilityNotesEvent({ availabilityNotes: [] })} />);

    expect(screen.queryByText('Availability notes')).toBeNull();
  });

  it('renders populated availability notes with RSVP labels', () => {
    render(
      <AvailabilityNotesList
        event={buildAvailabilityNotesEvent({
          availabilityNotes: [
            { displayName: 'Avery Smith', response: 'going', note: 'Can arrive early.' },
            { displayName: 'Blake Jones', response: 'not_going', note: 'Out sick.' }
          ]
        })}
      />
    );

    expect(screen.getByText('Availability notes')).toBeTruthy();
    expect(screen.getByText('Avery Smith')).toBeTruthy();
    expect(screen.getByText('Going')).toBeTruthy();
    expect(screen.getByText('Can arrive early.')).toBeTruthy();
    expect(screen.getByText('Blake Jones')).toBeTruthy();
    expect(screen.getByText("Can't go")).toBeTruthy();
    expect(screen.getByText('Out sick.')).toBeTruthy();
  });

  it('renders the empty attention state when no items need action', () => {
    render(<AttentionPanel items={[]} onSelectSection={vi.fn()} />);

    expect(screen.getByText('All caught up')).toBeTruthy();
    expect(screen.getByText('No parent actions need attention right now.')).toBeTruthy();
  });

  it('renders attention items and routes section selection', () => {
    const onSelectSection = vi.fn();
    render(
      <AttentionPanel
        items={[
          { title: 'RSVP needed', detail: 'Tell coaches if Avery can attend.', section: 'availability' },
          { title: 'Ride requested', detail: 'Review rideshare details.', section: 'rideshare' }
        ]}
        onSelectSection={onSelectSection}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: /RSVP needed/i }));
    fireEvent.click(screen.getByRole('button', { name: 'Ride requested' }));

    expect(screen.getByText('Needs attention')).toBeTruthy();
    expect(screen.getByText('Tell coaches if Avery can attend.')).toBeTruthy();
    expect(onSelectSection).toHaveBeenNthCalledWith(1, 'availability');
    expect(onSelectSection).toHaveBeenNthCalledWith(2, 'rideshare');
  });
});
