import type { ComponentType } from 'react';
import { clearLazyChunkReloadAttempt, handleLazyPageLoadError } from '../../lib/lazyPage';
import type { ScheduleStaffToolsProps } from './ScheduleStaffTools';

export type ScheduleStaffToolsModule = {
  default: ComponentType<ScheduleStaffToolsProps>;
};

type ScheduleStaffToolsImporter = () => Promise<ScheduleStaffToolsModule>;

export function createScheduleStaffToolsLoader(importer: ScheduleStaffToolsImporter) {
  let modulePromise: Promise<ScheduleStaffToolsModule> | null = null;
  return () => {
    if (!modulePromise) {
      modulePromise = Promise.resolve()
        .then(importer)
        .then((module) => {
          clearLazyChunkReloadAttempt();
          return module;
        })
        .catch((error) => {
          modulePromise = null;
          return handleLazyPageLoadError(error) as Promise<ScheduleStaffToolsModule>;
        });
    }
    return modulePromise;
  };
}

export const loadScheduleStaffTools = createScheduleStaffToolsLoader(
  () => import('./ScheduleStaffTools')
);
