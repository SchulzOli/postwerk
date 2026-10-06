import type { Edge, Node } from '@xyflow/react';
import type { FlowStep } from '@postwerk/core/flow';
import type { AccountData, FlowData, NetworkData, PluginData, WorldData } from './types';

export type RegionKey = 'networks' | 'accounts' | 'flows' | 'compose' | 'calendar' | 'posts' | 'plugins' | 'team';

export type WorldNode =
  | Node<{ region: RegionKey }, 'region'>
  | Node<{ network: NetworkData; accountCount: number }, 'network'>
  | Node<{ account: AccountData }, 'account'>
  | Node<{ flowId: string; name: string }, 'flow'>
  | Node<{ flowId: string; step: FlowStep }, 'step'>
  | Node<Record<string, never>, 'composer'>
  | Node<Record<string, never>, 'posts'>
  | Node<Record<string, never>, 'calendar'>
  | Node<{ plugin: PluginData }, 'plugin'>
  | Node<Record<string, never>, 'pluginInstall'>
  | Node<Record<string, never>, 'activity'>
  | Node<Record<string, never>, 'members'>
  | Node<Record<string, never>, 'bridgeUsage'>;

/** Stable node ids double as deep-link targets (#n=<id>). */
export const ids = {
  region: (key: RegionKey) => `region:${key}`,
  network: (provider: string) => `network:${provider}`,
  account: (id: string) => `account:${id}`,
  flow: (id: string) => `flow:${id}`,
  step: (flowId: string, stepId: string) => `step:${flowId}:${stepId}`,
  composer: 'panel:composer',
  posts: 'panel:posts',
  calendar: 'panel:calendar',
  plugin: (id: string) => `plugin:${id}`,
  pluginInstall: 'panel:add-theme',
  activity: 'panel:activity',
  members: 'panel:members',
  bridgeUsage: 'panel:bridge-usage',
};

/** Regions in toolbar order; their titles and subtitles are in `canvasMessages.regions`. */
export const regionKeys: RegionKey[] = ['networks', 'accounts', 'flows', 'compose', 'calendar', 'posts', 'plugins', 'team'];

const NETWORK = { width: 240, height: 112, gap: 20, columns: 4 };
const ACCOUNT = { width: 250, height: 76, gap: 16, columns: 2 };
const PLUGIN = { width: 300, height: 252, gap: 20, columns: 3 };
const USAGE = { height: 104, gap: 28 };
const PAD = { x: 32, top: 88, bottom: 32 };
export const FLOW = { width: 1180, minHeight: 300, gap: 40 };
/** The panel is about 1030px high at most (month view with a post open). */
const CALENDAR = { width: 1100, height: 1180 };
export const STEP_WIDTH = 220;

function grid(index: number, cell: { width: number; height: number; gap: number; columns: number }) {
  return {
    x: PAD.x + (index % cell.columns) * (cell.width + cell.gap),
    y: PAD.top + Math.floor(index / cell.columns) * (cell.height + cell.gap),
  };
}

function gridSize(count: number, cell: { width: number; height: number; gap: number; columns: number }) {
  const rows = Math.max(1, Math.ceil(count / cell.columns));
  return {
    width: PAD.x * 2 + cell.columns * cell.width + (cell.columns - 1) * cell.gap,
    height: PAD.top + rows * cell.height + (rows - 1) * cell.gap + PAD.bottom,
  };
}

/** Height a flow frame needs for its steps (frames grow with their content). */
export function flowFrameHeight(steps: { position: { y: number } }[]): number {
  const bottom = Math.max(0, ...steps.map((step) => step.position.y + 190));
  return Math.max(FLOW.minHeight, bottom + 40);
}

export function stepNode(flowId: string, step: FlowStep): WorldNode {
  return {
    id: ids.step(flowId, step.id),
    type: 'step',
    parentId: ids.flow(flowId),
    position: step.position,
    data: { flowId, step },
    deletable: step.type !== 'trigger',
    style: { width: STEP_WIDTH },
  };
}

export function flowNodes(flow: FlowData, position: { x: number; y: number }): WorldNode[] {
  return [
    {
      id: ids.flow(flow.id),
      type: 'flow',
      parentId: ids.region('flows'),
      position,
      data: { flowId: flow.id, name: flow.name },
      deletable: false,
      dragHandle: '.flow-drag',
      style: { width: FLOW.width, height: flowFrameHeight(flow.graph.steps) },
    },
    ...flow.graph.steps.map((step) => stepNode(flow.id, step)),
  ];
}

export function flowEdges(flow: FlowData): Edge[] {
  return flow.graph.edges.map((edge) => ({
    id: `e:flow:${flow.id}:${edge.id}`,
    source: ids.step(flow.id, edge.source),
    target: ids.step(flow.id, edge.target),
    sourceHandle: 'out',
    targetHandle: 'in',
    className: 'flow-edge',
  }));
}

/**
 * Lays out the whole world. Saved positions win over the default layout;
 * `keep` lets an existing canvas keep nodes it already shows (e.g. unsaved flow edits).
 */
export function buildWorld(data: WorldData, saved: Record<string, { x: number; y: number }>): { nodes: WorldNode[]; edges: Edge[] } {
  const place = (id: string, fallback: { x: number; y: number }) => saved[id] ?? fallback;
  const accountsByProvider = new Map<string, number>();
  for (const account of data.accounts) accountsByProvider.set(account.provider, (accountsByProvider.get(account.provider) ?? 0) + 1);

  const networksSize = gridSize(data.networks.length, NETWORK);
  const accountsSize = gridSize(Math.max(2, data.accounts.length), ACCOUNT);
  // The bridge's usage card sits below the accounts.
  const usageY = accountsSize.height - PAD.bottom + USAGE.gap;
  if (data.bridgeUsage) accountsSize.height += USAGE.gap + USAGE.height;
  const topHeight = Math.max(networksSize.height, accountsSize.height, 760);
  const flowsHeight =
    PAD.top + data.flows.reduce((sum, flow) => sum + flowFrameHeight(flow.graph.steps) + FLOW.gap, 0) + 260;
  const flowsY = Math.max(topHeight, 980) + 120;
  // The "Add a theme" card comes first, so new themes are appended without moving anything.
  const pluginsSize = gridSize(data.plugins.length + 1, PLUGIN);

  const regions: { key: RegionKey; position: { x: number; y: number }; size: { width: number; height: number } }[] = [
    { key: 'networks', position: { x: 0, y: 0 }, size: { width: networksSize.width, height: topHeight } },
    { key: 'accounts', position: { x: networksSize.width + 80, y: 0 }, size: { width: accountsSize.width, height: topHeight } },
    { key: 'compose', position: { x: networksSize.width + accountsSize.width + 160, y: 0 }, size: { width: 600, height: Math.max(topHeight, 980) } },
    { key: 'posts', position: { x: networksSize.width + accountsSize.width + 840, y: 0 }, size: { width: 600, height: Math.max(topHeight, 980) } },
    { key: 'team', position: { x: networksSize.width + accountsSize.width + 1520, y: 0 }, size: { width: 1168, height: Math.max(topHeight, 980) } },
    { key: 'flows', position: { x: 0, y: flowsY }, size: { width: FLOW.width + PAD.x * 2, height: flowsHeight } },
    { key: 'plugins', position: { x: FLOW.width + PAD.x * 2 + 80, y: flowsY }, size: pluginsSize },
    {
      key: 'calendar',
      position: { x: FLOW.width + PAD.x * 2 + 80 + pluginsSize.width + 80, y: flowsY },
      size: { width: CALENDAR.width + PAD.x * 2, height: CALENDAR.height },
    },
  ];

  const nodes: WorldNode[] = regions.map(({ key, position, size }) => ({
    id: ids.region(key),
    type: 'region',
    position: place(ids.region(key), position),
    data: { region: key },
    style: { width: size.width, height: size.height },
    deletable: false,
    dragHandle: '.region-drag',
    zIndex: -1,
  }));

  data.networks.forEach((network, index) => {
    const id = ids.network(network.info.id);
    nodes.push({
      id,
      type: 'network',
      parentId: ids.region('networks'),
      position: place(id, grid(index, NETWORK)),
      data: { network, accountCount: accountsByProvider.get(network.info.id) ?? 0 },
      deletable: false,
      style: { width: NETWORK.width },
    });
  });

  data.accounts.forEach((account, index) => {
    const id = ids.account(account.id);
    nodes.push({
      id,
      type: 'account',
      parentId: ids.region('accounts'),
      position: place(id, grid(index, ACCOUNT)),
      data: { account },
      deletable: false,
      style: { width: ACCOUNT.width },
    });
  });

  if (data.bridgeUsage) {
    nodes.push({
      id: ids.bridgeUsage,
      type: 'bridgeUsage',
      parentId: ids.region('accounts'),
      position: place(ids.bridgeUsage, { x: PAD.x, y: usageY }),
      data: {},
      deletable: false,
      style: { width: ACCOUNT.columns * ACCOUNT.width + (ACCOUNT.columns - 1) * ACCOUNT.gap },
    });
  }

  nodes.push(
    { id: ids.composer, type: 'composer', parentId: ids.region('compose'), position: place(ids.composer, { x: PAD.x, y: PAD.top }), data: {}, deletable: false, dragHandle: '.panel-drag', style: { width: 536 } },
    { id: ids.posts, type: 'posts', parentId: ids.region('posts'), position: place(ids.posts, { x: PAD.x, y: PAD.top }), data: {}, deletable: false, dragHandle: '.panel-drag', style: { width: 536 } },
    { id: ids.calendar, type: 'calendar', parentId: ids.region('calendar'), position: place(ids.calendar, { x: PAD.x, y: PAD.top }), data: {}, deletable: false, dragHandle: '.panel-drag', style: { width: CALENDAR.width } },
    { id: ids.members, type: 'members', parentId: ids.region('team'), position: place(ids.members, { x: PAD.x, y: PAD.top }), data: {}, deletable: false, dragHandle: '.panel-drag', style: { width: 536 } },
    { id: ids.activity, type: 'activity', parentId: ids.region('team'), position: place(ids.activity, { x: PAD.x + 568, y: PAD.top }), data: {}, deletable: false, dragHandle: '.panel-drag', style: { width: 536 } },
  );

  nodes.push({
    id: ids.pluginInstall,
    type: 'pluginInstall',
    parentId: ids.region('plugins'),
    position: place(ids.pluginInstall, grid(0, PLUGIN)),
    data: {},
    deletable: false,
    style: { width: PLUGIN.width },
  });
  data.plugins.forEach((plugin, index) => {
    const id = ids.plugin(plugin.manifest.id);
    nodes.push({
      id,
      type: 'plugin',
      parentId: ids.region('plugins'),
      position: place(id, grid(index + 1, PLUGIN)),
      data: { plugin },
      deletable: false,
      style: { width: PLUGIN.width },
    });
  });

  let flowY = PAD.top;
  for (const flow of data.flows) {
    nodes.push(...flowNodes(flow, { x: flow.x || PAD.x, y: flow.y || flowY }));
    flowY += flowFrameHeight(flow.graph.steps) + FLOW.gap;
  }

  return { nodes, edges: data.flows.flatMap(flowEdges) };
}

/** Where a new flow frame should go: below the lowest existing one. */
export function nextFlowPosition(nodes: WorldNode[]): { x: number; y: number } {
  const frames = nodes.filter((node) => node.type === 'flow');
  const bottom = Math.max(PAD.top - FLOW.gap, ...frames.map((frame) => frame.position.y + Number(frame.style?.height ?? FLOW.minHeight)));
  return { x: PAD.x, y: bottom + FLOW.gap };
}
