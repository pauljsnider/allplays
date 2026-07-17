import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('performance wiring', () => {
  it('boots web vitals from the app entrypoint', () => {
    const source = readFileSync('src/main.tsx', 'utf8');

    expect(source).toContain("import { initializeWebVitalsMonitoring } from './lib/webVitals';");
    expect(source).toContain('void initializeWebVitalsMonitoring();');
  });

  it('keeps high-value workflows instrumented', () => {
    const schedule = readFileSync('src/components/schedule/ScheduleStaffTools.tsx', 'utf8');
    const media = readFileSync('src/pages/TeamMedia.tsx', 'utf8');
    const tracker = readFileSync('src/pages/StandardTracker.tsx', 'utf8');

    expect(schedule).toContain('WORKFLOW_TIMING.scheduleCreateGame');
    expect(schedule).toContain('WORKFLOW_TIMING.scheduleImport');
    expect(schedule).toContain('WORKFLOW_TIMING.scheduleAiPreview');
    expect(media).toContain('WORKFLOW_TIMING.teamMediaPhotoUpload');
    expect(media).toContain('WORKFLOW_TIMING.teamMediaFileUpload');
    expect(media).toContain('WORKFLOW_TIMING.teamMediaAlbumCreate');
    expect(tracker).toContain('WORKFLOW_TIMING.standardTrackerLoad');
    expect(tracker).toContain('WORKFLOW_TIMING.standardTrackerRecordStat');
    expect(tracker).toContain('WORKFLOW_TIMING.standardTrackerUndoStat');
  });
});
