import type { ComponentType } from 'react';
import type { ScheduleStaffToolsProps } from './ScheduleStaffTools';

export type ScheduleStaffToolsModule = {
  default: ComponentType<ScheduleStaffToolsProps>;
};

type ScheduleStaffToolsImporter = () => Promise<ScheduleStaffToolsModule>;

export function createScheduleStaffToolsLoader(importer: ScheduleStaffToolsImporter) {
  let modulePromise: Promise<ScheduleStaffToolsModule> | null = null;
  return () => {
    if (!modulePromise) modulePromise = importer();
    return modulePromise;
  };
}

export const loadScheduleStaffTools = createScheduleStaffToolsLoader(
  () => import('./ScheduleStaffTools')
);
