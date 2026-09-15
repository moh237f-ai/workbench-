/* ==================== View Actions Context ==================== */
'use client';

import React, { createContext, useContext } from 'react';

export interface ViewActions {
  openItemForm: (parentId: string | null) => void;
  openItemDetail: (id: string) => void;
  openLabels: () => void;
  openCapture: () => void;
  openDailyPlan: () => void;
  openTimebox: (id: string, date?: string) => void;
  openDayPlanner: (date: string) => void;
  openHabitForm: (id: string | null) => void;
  openPalette: () => void;
}

export const ViewCtx = createContext<ViewActions | null>(null);

export function useViewActions(): ViewActions {
  const ctx = useContext(ViewCtx);
  if (!ctx) {
    throw new Error('useViewActions must be used inside ViewCtx');
  }
  return ctx;
}
