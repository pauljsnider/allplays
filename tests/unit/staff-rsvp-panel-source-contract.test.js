import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const detailSource = readFileSync(new URL('../../apps/app/src/pages/ScheduleEventDetail.tsx', import.meta.url), 'utf8');
const playerRowSource = readFileSync(new URL('../../apps/app/src/components/schedule/StaffRsvpPlayerRow.tsx', import.meta.url), 'utf8');

describe('staff RSVP panel decomposition contract', () => {
    it('keeps the availability section wired through named staff RSVP panels', () => {
        expect(detailSource).toContain('<StaffRsvpBreakdownPanel');
        expect(detailSource).toContain('<StaffRsvpReminderPanel auth={auth} event={event} refreshToken={staffRsvpRefreshToken} />');
        expect(detailSource).toContain('onOverride={onStaffRsvpOverride}');
        expect(detailSource).toContain('staffRsvpRefreshToken={staffRsvpRefreshToken}');
        expect(detailSource).toContain('const rsvpWorkflow = useScheduleEventRsvp({ availabilityNote });');
    });

    it('keeps staff override rows in the reusable schedule component', () => {
        expect(detailSource).toContain("import { StaffRsvpPlayerRow } from '../components/schedule/StaffRsvpPlayerRow';");
        expect(detailSource).toContain('<StaffRsvpPlayerRow');
        expect(playerRowSource).toContain('export function StaffRsvpPlayerRow');
        expect(playerRowSource).toContain('data-testid={`staff-rsvp-row-${player.playerId}`}');
        expect(playerRowSource).toContain("(['going', 'maybe', 'not_going'] as const).map");
        expect(playerRowSource).toContain('disabled={submitting || eventLocked}');
    });

    it('preserves the reminder preview and send workflow behind the staff reminder panel', () => {
        expect(detailSource).toContain('const [preview, setPreview] = useState<StaffRsvpReminderPreview | null>(null);');
        expect(detailSource).toContain('const canLoad = Boolean(auth.user && event.isTeamRsvpReminderManager && event.isDbGame && !event.isCancelled);');
        expect(detailSource).toContain('setPreview(await loadStaffRsvpReminderPreview(event, auth.user));');
        expect(detailSource).toContain('const result: StaffRsvpReminderSendResult = await sendStaffRsvpReminder(event, auth.user, auth.profile || {});');
        expect(detailSource).toContain('setStatus(`RSVP reminder sent to team chat and ${result.emailSentCount} parent/guardian ${result.emailSentCount === 1 ? \'email\' : \'emails\'}.`);');
    });
});
