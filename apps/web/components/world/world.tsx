'use client';

import '@xyflow/react/dist/style.css';
import {
  addEdge,
  Background,
  BackgroundVariant,
  Controls,
  MiniMap,
  Panel,
  ReactFlow,
  ReactFlowProvider,
  useEdgesState,
  useNodesState,
  useReactFlow,
  type Connection,
  type Edge,
  type IsValidConnection,
  type OnNodeDrag,
  type Viewport,
} from '@xyflow/react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { planFlow, type FlowGraph, type FlowPlan, type FlowStep } from '@postwerk/core/flow';
import type { ColorMode, ThemeCanvas } from '@postwerk/core/theme';
import { catalog } from '@postwerk/providers/catalog';
import { countText } from '@postwerk/providers/text';
import { textLimit } from '@postwerk/providers/validate';
import { loadPostAction } from '@/app/(app)/posts/actions';
import { createFlowAction, deleteFlowAction, saveFlowAction, savePositionsAction } from '@/app/(world)/canvas/actions';
import type { ComposerInitial } from '@/components/composer';
import { AccountMenu } from '@/components/account-menu';
import { ModeSwitch } from '@/components/mode-switch';
import { VerifyBanner } from '@/components/verify-banner';
import { WorkspaceMenu } from '@/components/workspace-menu';
import { useLocale, useMessages } from '@/lib/i18n';
import { canvasMessages } from '@/messages/canvas';
import { commonMessages } from '@/messages/common';
import { WorldContext, type SaveState, type WorldApi } from './context';
import { Inspector } from './inspector';
import { buildWorld, flowEdges, flowFrameHeight, flowNodes, FLOW, ids, nextFlowPosition, regionKeys, STEP_WIDTH, stepNode, type WorldNode } from './layout';
import { nodeTypes } from './nodes';
import type { WorldData } from './types';

export type { WorldData } from './types';

const stepIdOf = (nodeId: string) => nodeId.split(':').slice(2).join(':');
const flowEdgePrefix = (flowId: string) => `e:flow:${flowId}:`;
const patterns: Record<Exclude<ThemeCanvas['pattern'], 'none'>, BackgroundVariant> = {
  dots: BackgroundVariant.Dots,
  lines: BackgroundVariant.Lines,
  cross: BackgroundVariant.Cross,
};
const edgeTypes: Record<ThemeCanvas['edges'], string> = { smoothstep: 'smoothstep', bezier: 'default', step: 'step', straight: 'straight' };
/** Minimap color per node type (theme tokens). */
const tints: Partial<Record<string, string>> = { pluginInstall: 'plugin', activity: 'account', members: 'account', calendar: 'posts', bridgeUsage: 'account' };

function serializeFlow(flowId: string, nodes: WorldNode[], edges: Edge[]): FlowGraph {
  const steps = nodes
    .filter((node): node is Extract<WorldNode, { type: 'step' }> => node.type === 'step' && node.data.flowId === flowId)
    .map((node) => ({ ...node.data.step, position: { x: Math.round(node.position.x), y: Math.round(node.position.y) } }) as FlowStep);
  const prefix = flowEdgePrefix(flowId);
  return {
    steps,
    edges: edges.filter((edge) => edge.id.startsWith(prefix)).map((edge) => ({ id: edge.id.slice(prefix.length), source: stepIdOf(edge.source), target: stepIdOf(edge.target) })),
  };
}

/** Grows or shrinks a flow frame to fit its steps. */
function fitFrames(nodes: WorldNode[]): WorldNode[] {
  const heights = new Map<string, number>();
  for (const node of nodes) {
    if (node.type !== 'flow') continue;
    const steps = nodes.filter((n) => n.type === 'step' && n.data.flowId === node.data.flowId);
    heights.set(node.id, flowFrameHeight(steps));
  }
  return nodes.map((node) => {
    const height = heights.get(node.id);
    return height !== undefined && height !== node.style?.height ? { ...node, style: { ...node.style, height } } : node;
  });
}

function label(node: WorldNode, t: (typeof canvasMessages)['en']): string {
  switch (node.type) {
    case 'region':
      return t.regions[node.data.region].title;
    case 'network':
      return t.destinations.network(node.data.network.info.name);
    case 'account':
      return `${node.data.account.displayName ?? node.data.account.handle} · ${catalog[node.data.account.provider].name}`;
    case 'flow':
      return t.destinations.flow(node.data.name);
    case 'composer':
      return t.destinations.composer;
    case 'posts':
      return t.destinations.posts;
    case 'calendar':
      return t.destinations.calendar;
    case 'plugin':
      return t.destinations.theme(node.data.plugin.manifest.name);
    case 'pluginInstall':
      return t.destinations.themeEditor;
    case 'activity':
      return t.destinations.activity;
    case 'members':
      return t.destinations.members;
    case 'bridgeUsage':
      return t.destinations.bridgeUsage;
    default:
      return '';
  }
}

export function World({ data }: { data: WorldData }) {
  return (
    <ReactFlowProvider>
      <WorldCanvas data={data} />
    </ReactFlowProvider>
  );
}

function WorldCanvas({ data }: { data: WorldData }) {
  const t = useMessages(canvasMessages);
  const common = useMessages(commonMessages);
  const locale = useLocale();
  const rf = useReactFlow<WorldNode>();
  const initial = useMemo(() => buildWorld(data, data.positions), []); // eslint-disable-line react-hooks/exhaustive-deps
  const [nodes, setNodes, onNodesChange] = useNodesState<WorldNode>(initial.nodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>(initial.edges);
  const [saveState, setSaveState] = useState<Record<string, SaveState>>({});
  const [selectedId, setSelectedId] = useState<string>();
  const [notice, setNotice] = useState(data.notice);
  const [mode, setMode] = useState<ColorMode>(data.appearance.mode);
  const [composing, setComposing] = useState<ComposerInitial>();
  const [composerKey, setComposerKey] = useState(0);
  const [composeTime, setComposeTime] = useState<string>();
  const state = useRef({ nodes, edges });
  state.current = { nodes, edges };
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());

  // ---------------------------------------------------------------- server sync
  const firstData = useRef(data);
  /** Flows this canvas already shows; their local state (maybe unsaved) wins over server data. */
  const knownFlows = useRef(new Set(data.flows.map((flow) => flow.id)));
  useEffect(() => {
    if (data === firstData.current) return;
    setNotice(data.notice);
    const flowIds = new Set(data.flows.map((flow) => flow.id));
    const newFlows = new Set(data.flows.filter((flow) => !knownFlows.current.has(flow.id)).map((flow) => flow.id));
    newFlows.forEach((id) => knownFlows.current.add(id));
    const flowIdOf = (node: WorldNode) => (node.type === 'flow' || node.type === 'step' ? node.data.flowId : undefined);

    setNodes((current) => {
      const positions = Object.fromEntries(current.map((node) => [node.id, node.position]));
      const fresh = buildWorld(data, { ...data.positions, ...positions }).nodes;
      const selected = new Set(current.filter((node) => node.selected).map((node) => node.id));
      const others = fresh.filter((node) => !flowIdOf(node)).map((node) => ({ ...node, selected: selected.has(node.id) }));
      const kept = current.filter((node) => flowIds.has(flowIdOf(node) ?? '') && !newFlows.has(flowIdOf(node)!));
      const added = fresh.filter((node) => newFlows.has(flowIdOf(node) ?? ''));
      return fitFrames([...others, ...kept, ...added]);
    });
    setEdges((current) => [
      ...current.filter((edge) => flowIds.has(edge.id.split(':')[2] ?? '') && !newFlows.has(edge.id.split(':')[2]!)),
      ...data.flows.filter((flow) => newFlows.has(flow.id)).flatMap(flowEdges),
    ]);
  }, [data, setNodes, setEdges]);

  // ---------------------------------------------------------------- derived
  const accountIds = useMemo(() => new Set(data.accounts.map((account) => account.id)), [data.accounts]);
  const derivedEdges = useMemo<Edge[]>(() => {
    const list: Edge[] = data.accounts.map((account) => ({
      id: `e:net:${account.id}`,
      source: ids.network(account.provider),
      target: ids.account(account.id),
      sourceHandle: 'out',
      targetHandle: 'in',
      selectable: false,
      deletable: false,
      className: 'link-edge',
    }));
    for (const node of nodes) {
      if (node.type !== 'step' || node.data.step.type !== 'target' || !accountIds.has(node.data.step.accountId)) continue;
      list.push({
        id: `e:feed:${node.id}`,
        source: node.id,
        target: ids.account(node.data.step.accountId),
        sourceHandle: 'feed',
        targetHandle: 'in',
        selectable: false,
        deletable: false,
        animated: true,
        className: 'feed-edge',
      });
    }
    return list;
  }, [data.accounts, accountIds, nodes]);

  const plans = useMemo(() => {
    const accounts = new Map(data.accounts.map((account) => [account.id, account]));
    const measure = (accountId: string, text: string) => {
      const account = accounts.get(accountId);
      if (!account) return { length: 0, max: Infinity };
      const info = catalog[account.provider];
      return { length: countText(text, info.capabilities.text.counter), max: textLimit(info, { media: [] }, { maxLength: account.maxLength ?? undefined }) };
    };
    const result: Record<string, FlowPlan> = {};
    for (const node of nodes) if (node.type === 'flow') result[node.data.flowId] = planFlow(serializeFlow(node.data.flowId, nodes, edges), t.sampleText, measure, locale);
    return result;
  }, [nodes, edges, data.accounts, t.sampleText, locale]);

  // ---------------------------------------------------------------- saving
  const scheduleFlowSave = useCallback((flowId: string) => {
    setSaveState((s) => ({ ...s, [flowId]: 'unsaved' }));
    clearTimeout(timers.current.get(flowId));
    timers.current.set(
      flowId,
      setTimeout(async () => {
        setSaveState((s) => ({ ...s, [flowId]: 'saving' }));
        const { nodes: currentNodes, edges: currentEdges } = state.current;
        const result = await saveFlowAction(flowId, { graph: serializeFlow(flowId, currentNodes, currentEdges) }).catch(() => ({ ok: false }));
        setSaveState((s) => ({ ...s, [flowId]: result.ok ? 'saved' : 'error' }));
      }, 600),
    );
  }, []);

  const pendingPositions = useRef(new Map<string, { key: string; x: number; y: number }>());
  const flushPositions = useRef<ReturnType<typeof setTimeout>>(undefined);
  const savePosition = useCallback((node: WorldNode) => {
    pendingPositions.current.set(node.id, { key: node.id, x: node.position.x, y: node.position.y });
    clearTimeout(flushPositions.current);
    flushPositions.current = setTimeout(() => {
      const batch = [...pendingPositions.current.values()];
      pendingPositions.current.clear();
      void savePositionsAction(batch);
    }, 400);
  }, []);

  const onNodeDragStop: OnNodeDrag<WorldNode> = useCallback(
    (_, __, dragged) => {
      const flows = new Set<string>();
      for (const node of dragged) {
        if (node.type === 'step') flows.add(node.data.flowId);
        else if (node.type === 'flow') void saveFlowAction(node.data.flowId, { x: node.position.x, y: node.position.y });
        else savePosition(node);
      }
      flows.forEach(scheduleFlowSave);
      if (flows.size > 0) setNodes((current) => fitFrames(current));
    },
    [savePosition, scheduleFlowSave, setNodes],
  );

  // ---------------------------------------------------------------- navigation
  const focus = useCallback(
    (id: string) => {
      const node = rf.getNode(id);
      if (!node) return;
      void rf.fitView({ nodes: [{ id }], duration: 600, padding: node.type === 'region' ? 0.08 : 0.6, maxZoom: node.type === 'region' ? 1 : 1.25 });
      setNodes((current) => current.map((n) => (n.selected === (n.id === id) ? n : { ...n, selected: n.id === id })));
      setSelectedId(id);
    },
    [rf, setNodes],
  );

  const applyHash = useCallback(() => {
    const hash = decodeURIComponent(window.location.hash.slice(1));
    if (hash.startsWith('n=')) {
      focus(hash.slice(2));
      return true;
    }
    if (hash.startsWith('@')) {
      const [x, y, zoom] = hash.slice(1).split(',').map(Number);
      if ([x, y, zoom].every(Number.isFinite)) {
        void rf.setViewport({ x: x!, y: y!, zoom: zoom! });
        return true;
      }
    }
    return false;
  }, [focus, rf]);

  useEffect(() => {
    // "#n=<node>" links anywhere on the page navigate inside the world, even when the hash is unchanged.
    const onClick = (event: MouseEvent) => {
      const anchor = (event.target as HTMLElement).closest('a');
      const href = anchor?.getAttribute('href');
      if (!href?.startsWith('#n=')) return;
      event.preventDefault();
      history.pushState(null, '', href);
      applyHash();
    };
    const onPop = () => applyHash();
    document.addEventListener('click', onClick);
    window.addEventListener('popstate', onPop);
    return () => {
      document.removeEventListener('click', onClick);
      window.removeEventListener('popstate', onPop);
    };
  }, [applyHash]);

  const onInit = useCallback(() => {
    if (window.location.search) history.replaceState(null, '', `/canvas${window.location.hash}`);
    // Wait a frame so nodes are measured before fitting.
    requestAnimationFrame(() => {
      if (!applyHash()) void rf.fitView({ padding: 0.05 });
    });
  }, [applyHash, rf]);

  const onMoveEnd = useCallback((_: unknown, viewport: Viewport) => {
    const hash = `#@${Math.round(viewport.x)},${Math.round(viewport.y)},${viewport.zoom.toFixed(2)}`;
    history.replaceState(null, '', `/canvas${hash}`);
  }, []);

  // ---------------------------------------------------------------- flow editing
  const addStep = useCallback<WorldApi['addStep']>(
    (flowId, type) => {
      const current = state.current.nodes;
      const steps = current.filter((n) => n.type === 'step' && n.data.flowId === flowId);
      const rightmost = Math.max(...steps.map((s) => s.position.x));
      const position =
        rightmost + STEP_WIDTH * 2 + 40 < FLOW.width
          ? { x: rightmost + STEP_WIDTH + 50, y: 110 }
          : { x: 40, y: Math.max(...steps.map((s) => s.position.y)) + 200 };
      const id = `${type}-${Math.random().toString(36).slice(2, 8)}`;
      const step: FlowStep =
        type === 'addText'
          ? { id, type, placement: 'end', text: '', position }
          : type === 'delay'
            ? { id, type, minutes: 60, position }
            : type === 'target'
              ? { id, type, accountId: '', position }
              : { id, type: 'shorten', position };
      const node = stepNode(flowId, step);
      // Chain from the selected step of the same flow, or from "New post" while it has no connection yet.
      const canContinue = (n: WorldNode) => n.type === 'step' && n.data.flowId === flowId && n.data.step.type !== 'target';
      const trigger = current.find((n) => n.type === 'step' && n.data.flowId === flowId && n.data.step.type === 'trigger');
      const from =
        current.find((n) => n.selected && canContinue(n)) ??
        (trigger && !state.current.edges.some((e) => e.source === trigger.id) ? trigger : undefined);
      setNodes((ns) => fitFrames([...ns.map((n) => (n.selected ? { ...n, selected: false } : n)), { ...node, selected: true }]));
      if (from) {
        setEdges((es) =>
          addEdge({ id: `${flowEdgePrefix(flowId)}${stepIdOf(from.id)}-${id}`, source: from.id, target: node.id, sourceHandle: 'out', targetHandle: 'in', className: 'flow-edge' }, es),
        );
      }
      setSelectedId(node.id);
      scheduleFlowSave(flowId);
    },
    [scheduleFlowSave, setEdges, setNodes],
  );

  const updateStep = useCallback<WorldApi['updateStep']>(
    (flowId, stepId, patch) => {
      const nodeId = ids.step(flowId, stepId);
      setNodes((ns) => ns.map((n) => (n.id === nodeId && n.type === 'step' ? { ...n, data: { ...n.data, step: { ...n.data.step, ...patch } as FlowStep } } : n)));
      scheduleFlowSave(flowId);
    },
    [scheduleFlowSave, setNodes],
  );

  const removeStep = useCallback<WorldApi['removeStep']>(
    (flowId, stepId) => {
      const nodeId = ids.step(flowId, stepId);
      setNodes((ns) => fitFrames(ns.filter((n) => n.id !== nodeId)));
      setEdges((es) => es.filter((e) => e.source !== nodeId && e.target !== nodeId));
      scheduleFlowSave(flowId);
    },
    [scheduleFlowSave, setEdges, setNodes],
  );

  const renameFlow = useCallback<WorldApi['renameFlow']>(
    (flowId, name) => {
      setNodes((ns) => ns.map((n) => (n.type === 'flow' && n.data.flowId === flowId ? { ...n, data: { ...n.data, name } } : n)));
      void saveFlowAction(flowId, { name });
    },
    [setNodes],
  );

  const deleteFlow = useCallback<WorldApi['deleteFlow']>(
    (flowId) => {
      setNodes((ns) => ns.filter((n) => !((n.type === 'flow' || n.type === 'step') && n.data.flowId === flowId)));
      setEdges((es) => es.filter((e) => !e.id.startsWith(flowEdgePrefix(flowId))));
      setSelectedId(undefined);
      void deleteFlowAction(flowId);
    },
    [setEdges, setNodes],
  );

  const createFlow = useCallback(async () => {
    const position = nextFlowPosition(state.current.nodes);
    const flow = await createFlowAction({ name: t.newFlowName, ...position });
    knownFlows.current.add(flow.id);
    setNodes((ns) => fitFrames([...ns.map((n) => (n.selected ? { ...n, selected: false } : n)), ...flowNodes(flow, position)]));
    setTimeout(() => focus(ids.flow(flow.id)), 50);
  }, [focus, setNodes, t.newFlowName]);

  const isValidConnection: IsValidConnection = useCallback((connection) => {
    const source = rf.getNode(connection.source) as WorldNode | undefined;
    const target = rf.getNode(connection.target) as WorldNode | undefined;
    if (source?.type !== 'step' || target?.type !== 'step') return false;
    if (source.data.flowId !== target.data.flowId || source.id === target.id) return false;
    if (target.data.step.type === 'trigger' || source.data.step.type === 'target') return false;
    return !state.current.edges.some((e) => e.source === source.id && e.target === target.id);
  }, [rf]);

  const onConnect = useCallback(
    (connection: Connection) => {
      const source = rf.getNode(connection.source) as WorldNode | undefined;
      if (source?.type !== 'step') return;
      const flowId = source.data.flowId;
      setEdges((es) =>
        addEdge({ ...connection, id: `${flowEdgePrefix(flowId)}${stepIdOf(connection.source)}-${stepIdOf(connection.target)}`, className: 'flow-edge' }, es),
      );
      scheduleFlowSave(flowId);
    },
    [rf, scheduleFlowSave, setEdges],
  );

  const onDelete = useCallback(
    ({ nodes: deletedNodes, edges: deletedEdges }: { nodes: WorldNode[]; edges: Edge[] }) => {
      const flows = new Set<string>();
      for (const node of deletedNodes) if (node.type === 'step') flows.add(node.data.flowId);
      for (const edge of deletedEdges) if (edge.id.startsWith('e:flow:')) flows.add(edge.id.split(':')[2]!);
      flows.forEach(scheduleFlowSave);
      if (deletedNodes.length) setNodes((ns) => fitFrames(ns));
    },
    [scheduleFlowSave, setNodes],
  );

  const composeFrom = useCallback<WorldApi['composeFrom']>(
    async (postId, asCopy = false) => {
      const result = await loadPostAction(postId, asCopy);
      if ('error' in result) {
        setNotice({ kind: 'error', text: result.error });
        return;
      }
      setComposing(result);
      setComposeTime(undefined);
      setComposerKey((key) => key + 1);
      focus(ids.composer);
    },
    [focus],
  );
  const composeAt = useCallback<WorldApi['composeAt']>(
    (iso) => {
      setComposing(undefined);
      setComposeTime(iso);
      setComposerKey((key) => key + 1);
      focus(ids.composer);
    },
    [focus],
  );
  const resetComposer = useCallback(() => {
    setComposing(undefined);
    setComposeTime(undefined);
    setComposerKey((key) => key + 1);
  }, []);

  // ---------------------------------------------------------------- render
  const api: WorldApi = useMemo(
    () => ({
      data,
      focus,
      linkTo: (id) => `${window.location.origin}/canvas#n=${encodeURIComponent(id)}`,
      addStep,
      updateStep,
      removeStep,
      renameFlow,
      deleteFlow,
      saveState,
      plans,
      composing,
      composeFrom,
      composeAt,
      composeTime,
      resetComposer,
      composerKey,
    }),
    [data, focus, addStep, updateStep, removeStep, renameFlow, deleteFlow, saveState, plans, composing, composeFrom, composeAt, composeTime, resetComposer, composerKey],
  );

  const selected = nodes.find((node) => node.id === selectedId);
  const destinations = nodes.filter((node) => label(node, t));
  // The theme decides how connections are drawn.
  const { canvas } = data.appearance;
  const allEdges = useMemo(() => [...edges, ...derivedEdges].map((edge) => ({ ...edge, type: edgeTypes[canvas.edges] })), [edges, derivedEdges, canvas.edges]);

  return (
    <WorldContext.Provider value={api}>
      <ReactFlow<WorldNode>
        nodes={nodes}
        edges={allEdges}
        nodeTypes={nodeTypes}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        isValidConnection={isValidConnection}
        onDelete={onDelete}
        onNodeDragStop={onNodeDragStop}
        onSelectionChange={({ nodes: chosen }) => setSelectedId(chosen.length === 1 ? chosen[0]!.id : undefined)}
        onInit={onInit}
        onMoveEnd={onMoveEnd}
        minZoom={0.05}
        maxZoom={2}
        colorMode={mode}
        deleteKeyCode={['Backspace', 'Delete']}
        proOptions={{ hideAttribution: true }}
        aria-label={t.canvasLabel}
      >
        {canvas.pattern !== 'none' && <Background variant={patterns[canvas.pattern]} gap={canvas.gap} size={canvas.size} lineWidth={canvas.size} />}
        <Controls showInteractive={false} position="bottom-left" />
        <MiniMap
          pannable
          zoomable
          position="bottom-right"
          nodeStrokeWidth={2}
          nodeColor={(node) => `var(--tint-${tints[node.type ?? ''] ?? node.type}, var(--muted))`}
        />

        <Panel position="top-left" className="world-toolbar">
          <strong className="brand">Postwerk</strong>
          <nav aria-label={t.regionsLabel}>
            {regionKeys.map((key) => (
              <a key={key} href={`#n=${ids.region(key)}`}>
                {t.regions[key].title}
              </a>
            ))}
          </nav>
          <input
            className="jump"
            list="world-destinations"
            placeholder={t.goToPlaceholder}
            aria-label={t.goTo}
            onChange={(e) => {
              const target = destinations.find((node) => label(node, t) === e.target.value);
              if (target) {
                history.pushState(null, '', `#n=${target.id}`);
                focus(target.id);
                e.target.value = '';
              }
            }}
          />
          <datalist id="world-destinations">
            {destinations.map((node) => (
              <option key={node.id} value={label(node, t)} />
            ))}
          </datalist>
          <button type="button" className="small" onClick={createFlow}>
            {t.newFlow}
          </button>
        </Panel>

        <Panel position="top-right" className="world-account">
          <WorkspaceMenu current={data.workspace} workspaces={data.workspaces} teamHref={`#n=${ids.region('team')}`} />
          <ModeSwitch mode={data.appearance.mode} onChange={setMode} />
          <a href={`#n=${ids.region('plugins')}`}>{t.themesLink}</a>
          <AccountMenu user={data.user} links={[{ href: '/posts', label: common.nav.listView }]} />
        </Panel>

        {notice && (
          <Panel position="top-center" className={`world-notice ${notice.kind}`} role={notice.kind === 'error' ? 'alert' : 'status'}>
            {notice.text}
            <button type="button" className="icon-button" aria-label={common.dismiss} onClick={() => setNotice(null)}>
              ×
            </button>
          </Panel>
        )}
        {data.needsVerification && (
          <Panel position="bottom-center">
            <VerifyBanner email={data.user.email} className="world-notice" />
          </Panel>
        )}
      </ReactFlow>
      <Inspector
        node={selected}
        onClose={() => {
          setSelectedId(undefined);
          setNodes((ns) => ns.map((n) => (n.selected ? { ...n, selected: false } : n)));
        }}
      />
    </WorldContext.Provider>
  );
}
