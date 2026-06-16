import { createContext, useContext, type ReactNode } from 'react';
import type { ParentScheduleEvent } from '../../lib/scheduleLogic';
import type { AuthState } from '../../lib/types';

type ScheduleEventDetailContextValue = {
  auth: AuthState;
  event: ParentScheduleEvent;
  childEvents: ParentScheduleEvent[];
  refreshEvent: () => Promise<void> | void;
  updateEvents: (updater: (current: ParentScheduleEvent[]) => ParentScheduleEvent[]) => void;
};

const ScheduleEventDetailContext = createContext<ScheduleEventDetailContextValue | null>(null);

export function ScheduleEventDetailProvider({
  value,
  children
}: {
  value: ScheduleEventDetailContextValue;
  children?: ReactNode;
}) {
  return <ScheduleEventDetailContext.Provider value={value}>{children}</ScheduleEventDetailContext.Provider>;
}

export function useScheduleEventDetailContext() {
  const context = useContext(ScheduleEventDetailContext);
  if (!context) {
    throw new Error('useScheduleEventDetailContext must be used within a ScheduleEventDetailProvider.');
  }
  return context;
}

export type { ScheduleEventDetailContextValue };
