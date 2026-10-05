'use server';

import { revalidatePath } from 'next/cache';
import { createFlow, deleteFlow, parseFlowGraph, saveCanvasPositions, saveFlow } from '@postwerk/core';
import { getDb } from '@postwerk/db';
import { requireSession } from '@/lib/session';

export async function createFlowAction(input: { name: string; x: number; y: number }) {
  const { workspace } = await requireSession();
  const flow = await createFlow(getDb(), workspace.id, input);
  revalidatePath('/canvas');
  return { id: flow.id, name: flow.name, graph: parseFlowGraph(flow.graph), x: flow.x, y: flow.y };
}

export async function saveFlowAction(flowId: string, input: { name?: string; graph?: unknown; x?: number; y?: number }) {
  const { workspace } = await requireSession();
  try {
    return { ok: await saveFlow(getDb(), workspace.id, flowId, input) };
  } catch (error) {
    return { ok: false, error: (error as Error).message };
  }
}

export async function deleteFlowAction(flowId: string) {
  const { workspace } = await requireSession();
  await deleteFlow(getDb(), workspace.id, flowId);
  revalidatePath('/canvas');
}

export async function savePositionsAction(positions: { key: string; x: number; y: number }[]) {
  const { workspace } = await requireSession();
  await saveCanvasPositions(getDb(), workspace.id, positions);
}
