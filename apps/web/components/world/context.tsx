'use client';

import { createContext, useContext } from 'react';
import type { FlowPlan, FlowStep, FlowStepType } from '@postwerk/core/flow';
import type { WorldData } from './types';

export type SaveState = 'saved' | 'saving' | 'unsaved' | 'error';

export interface WorldApi {
  data: WorldData;
  /** Focus a node by id (pans and zooms there) and update the URL. */
  focus(id: string): void;
  linkTo(id: string): string;
  addStep(flowId: string, type: Exclude<FlowStepType, 'trigger'>): void;
  updateStep(flowId: string, stepId: string, patch: Partial<FlowStep>): void;
  removeStep(flowId: string, stepId: string): void;
  renameFlow(flowId: string, name: string): void;
  deleteFlow(flowId: string): void;
  saveState: Record<string, SaveState>;
  /** Live preview of every flow for a sample post. */
  plans: Record<string, FlowPlan>;
}

export const WorldContext = createContext<WorldApi | null>(null);

export function useWorld(): WorldApi {
  const api = useContext(WorldContext);
  if (!api) throw new Error('useWorld outside <World>');
  return api;
}
