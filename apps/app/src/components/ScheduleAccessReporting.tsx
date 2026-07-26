import { createContext, useContext, type ReactNode } from 'react';

export type ScheduleAccessReport = {
  userId: string;
  hasFamily: boolean;
  hasStaff: boolean;
};

type ScheduleAccessReporter = (report: ScheduleAccessReport | null) => void;

const ScheduleAccessReportingContext = createContext<ScheduleAccessReporter>(() => {});

export function ScheduleAccessReportingProvider({
  children,
  onReport
}: {
  children: ReactNode;
  onReport: ScheduleAccessReporter;
}) {
  return (
    <ScheduleAccessReportingContext.Provider value={onReport}>
      {children}
    </ScheduleAccessReportingContext.Provider>
  );
}

export function useScheduleAccessReporter() {
  return useContext(ScheduleAccessReportingContext);
}
