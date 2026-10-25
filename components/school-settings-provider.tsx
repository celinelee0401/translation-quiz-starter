'use client';

import { createContext, useContext } from 'react';
import type { SchoolSettings } from '@/lib/school-settings';

const SchoolSettingsContext = createContext<SchoolSettings | null>(null);

/** Passes the server's school settings (class list, time zone) to client components. */
export function SchoolSettingsProvider({ settings, children }: { settings: SchoolSettings; children: React.ReactNode }) {
  return <SchoolSettingsContext.Provider value={settings}>{children}</SchoolSettingsContext.Provider>;
}

export function useSchoolSettings(): SchoolSettings {
  const settings = useContext(SchoolSettingsContext);
  if (!settings) throw new Error('SchoolSettingsProvider is missing.');
  return settings;
}
