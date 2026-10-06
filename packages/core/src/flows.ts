import { and, eq } from 'drizzle-orm';
import { canvasPositions, flows, type Database } from '@postwerk/db';
import { emptyFlow, parseFlowGraph, type FlowGraph } from './flow';

export async function listFlows(db: Database, workspaceId: string) {
  const rows = await db.query.flows.findMany({ where: eq(flows.workspaceId, workspaceId), orderBy: (f, { asc }) => [asc(f.createdAt)] });
  return rows.map((row) => ({ ...row, graph: parseFlowGraph(row.graph) }));
}

export async function getFlow(db: Database, workspaceId: string, flowId: string) {
  const row = await db.query.flows.findFirst({ where: and(eq(flows.id, flowId), eq(flows.workspaceId, workspaceId)) });
  return row ? { ...row, graph: parseFlowGraph(row.graph) } : undefined;
}

export async function createFlow(db: Database, workspaceId: string, input: { name: string; x: number; y: number }) {
  const [flow] = await db
    .insert(flows)
    .values({ workspaceId, name: input.name.trim().slice(0, 80) || 'New flow', graph: emptyFlow(), x: Math.round(input.x), y: Math.round(input.y) })
    .returning();
  return flow!;
}

/** Replaces a flow's graph and/or name; the graph is sanitized first. */
export async function saveFlow(db: Database, workspaceId: string, flowId: string, input: { name?: string; graph?: unknown; x?: number; y?: number }) {
  const set: Partial<typeof flows.$inferInsert> = { updatedAt: new Date() };
  if (input.name !== undefined) set.name = input.name.trim().slice(0, 80) || 'Untitled flow';
  if (input.graph !== undefined) set.graph = parseFlowGraph(input.graph) satisfies FlowGraph;
  if (input.x !== undefined) set.x = Math.round(input.x);
  if (input.y !== undefined) set.y = Math.round(input.y);
  const updated = await db.update(flows).set(set).where(and(eq(flows.id, flowId), eq(flows.workspaceId, workspaceId))).returning({ id: flows.id });
  return updated.length > 0;
}

/** Returns the deleted flow's name, or undefined if there was none. */
export async function deleteFlow(db: Database, workspaceId: string, flowId: string) {
  const [deleted] = await db.delete(flows).where(and(eq(flows.id, flowId), eq(flows.workspaceId, workspaceId))).returning({ name: flows.name });
  return deleted?.name;
}

export async function loadCanvasPositions(db: Database, workspaceId: string): Promise<Record<string, { x: number; y: number }>> {
  const rows = await db.select().from(canvasPositions).where(eq(canvasPositions.workspaceId, workspaceId));
  return Object.fromEntries(rows.map((row) => [row.nodeKey, { x: row.x, y: row.y }]));
}

export async function saveCanvasPositions(db: Database, workspaceId: string, positions: { key: string; x: number; y: number }[]) {
  for (const { key, x, y } of positions.slice(0, 200)) {
    const values = { workspaceId, nodeKey: key.slice(0, 120), x: Math.round(x), y: Math.round(y) };
    await db
      .insert(canvasPositions)
      .values(values)
      .onConflictDoUpdate({ target: [canvasPositions.workspaceId, canvasPositions.nodeKey], set: { x: values.x, y: values.y } });
  }
}
