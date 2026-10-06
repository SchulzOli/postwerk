/**
 * Publishing flows: a small directed graph that starts at a trigger ("new
 * post"), passes through steps that adapt the post, and ends at accounts.
 * Pure (no database, no Node APIs) so the composer can preview plans in the browser.
 */

import type { Locale } from './i18n';
import { flowMessages } from './messages';

export interface XY {
  x: number;
  y: number;
}

export type FlowStep =
  | { id: string; type: 'trigger'; position: XY }
  | { id: string; type: 'addText'; position: XY; placement: 'start' | 'end'; text: string }
  | { id: string; type: 'shorten'; position: XY }
  | { id: string; type: 'delay'; position: XY; minutes: number }
  | { id: string; type: 'target'; position: XY; accountId: string };

export type FlowStepType = FlowStep['type'];

export interface FlowEdge {
  id: string;
  source: string;
  target: string;
}

export interface FlowGraph {
  steps: FlowStep[];
  edges: FlowEdge[];
}

export interface PlannedTarget {
  accountId: string;
  text: string;
  delayMinutes: number;
}

export interface FlowPlan {
  targets: PlannedTarget[];
  errors: string[];
}

/** Measures text for an account: its length in the network's counting and the limit. */
export type Measure = (accountId: string, text: string) => { length: number; max: number };

export function emptyFlow(): FlowGraph {
  // Below the flow frame's header (name, tools, preview line).
  return { steps: [{ id: 'trigger', type: 'trigger', position: { x: 40, y: 110 } }], edges: [] };
}

const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' });

/** Cuts text at grapheme boundaries until it fits, preferring a word break, and adds an ellipsis. */
export function shortenToFit(text: string, fits: (candidate: string) => boolean): string {
  if (fits(text)) return text;
  const graphemes = Array.from(segmenter.segment(text), (s) => s.segment);
  let low = 0;
  let high = graphemes.length;
  // Binary search for the longest prefix that fits with an ellipsis.
  while (low < high) {
    const mid = Math.ceil((low + high) / 2);
    if (fits(`${graphemes.slice(0, mid).join('').trimEnd()}…`)) low = mid;
    else high = mid - 1;
  }
  let prefix = graphemes.slice(0, low).join('');
  const lastSpace = prefix.lastIndexOf(' ');
  if (lastSpace > prefix.length * 0.6) prefix = prefix.slice(0, lastSpace);
  return `${prefix.trimEnd()}…`;
}

/**
 * Walks every path from the trigger to the accounts and returns what each
 * account will receive. Paths that do not end at an account are ignored.
 */
export function planFlow(graph: FlowGraph, text: string, measure?: Measure, locale: Locale = 'en'): FlowPlan {
  const m = flowMessages[locale];
  const errors: string[] = [];
  const triggers = graph.steps.filter((step) => step.type === 'trigger');
  if (triggers.length !== 1) return { targets: [], errors: [m.oneTrigger] };

  const steps = new Map(graph.steps.map((step) => [step.id, step]));
  const outgoing = new Map<string, string[]>();
  for (const edge of graph.edges) {
    if (!steps.has(edge.source) || !steps.has(edge.target)) continue;
    outgoing.set(edge.source, [...(outgoing.get(edge.source) ?? []), edge.target]);
  }

  const targets = new Map<string, PlannedTarget>();
  const visit = (id: string, current: string, delayMinutes: number, shorten: boolean, path: Set<string>) => {
    if (path.has(id)) {
      errors.push(m.loop);
      return;
    }
    const step = steps.get(id)!;
    const nextPath = new Set(path).add(id);
    let nextText = current;
    let nextDelay = delayMinutes;
    let nextShorten = shorten;
    switch (step.type) {
      case 'addText':
        if (step.text.trim()) nextText = step.placement === 'start' ? `${step.text.trim()}\n\n${current}` : `${current}\n\n${step.text.trim()}`;
        break;
      case 'shorten':
        nextShorten = true;
        break;
      case 'delay':
        nextDelay += Math.max(0, Math.round(step.minutes) || 0);
        break;
      case 'target': {
        if (!step.accountId) {
          errors.push(m.noAccount);
          return;
        }
        let finalText = current;
        if (shorten && measure) finalText = shortenToFit(current, (candidate) => measure(step.accountId, candidate).length <= measure(step.accountId, candidate).max);
        if (targets.has(step.accountId)) {
          errors.push(m.accountTwice);
          return;
        }
        targets.set(step.accountId, { accountId: step.accountId, text: finalText, delayMinutes });
        return;
      }
    }
    for (const next of outgoing.get(id) ?? []) visit(next, nextText, nextDelay, nextShorten, nextPath);
  };
  visit(triggers[0]!.id, text, 0, false, new Set());

  if (targets.size === 0 && errors.length === 0) errors.push(m.noTargets);
  return { targets: [...targets.values()], errors: [...new Set(errors)] };
}

/** Light structural check for graphs coming from the browser. */
export function parseFlowGraph(input: unknown): FlowGraph {
  const graph = input as Partial<FlowGraph> | null;
  if (!graph || !Array.isArray(graph.steps) || !Array.isArray(graph.edges)) throw new Error('Invalid flow.');
  const types: FlowStepType[] = ['trigger', 'addText', 'shorten', 'delay', 'target'];
  const position = (value: unknown): XY => {
    const p = value as Partial<XY> | undefined;
    return { x: Number(p?.x) || 0, y: Number(p?.y) || 0 };
  };
  const steps = graph.steps.slice(0, 200).map((raw): FlowStep => {
    const step = raw as Record<string, unknown>;
    const id = String(step.id ?? '').slice(0, 64);
    const type = step.type as FlowStepType;
    if (!id || !types.includes(type)) throw new Error('Invalid flow step.');
    const base = { id, position: position(step.position) };
    switch (type) {
      case 'addText':
        return { ...base, type, placement: step.placement === 'start' ? 'start' : 'end', text: String(step.text ?? '').slice(0, 5000) };
      case 'delay':
        return { ...base, type, minutes: Math.min(Math.max(0, Math.round(Number(step.minutes) || 0)), 60 * 24 * 365) };
      case 'target':
        return { ...base, type, accountId: String(step.accountId ?? '') };
      default:
        return { ...base, type } as FlowStep;
    }
  });
  const ids = new Set(steps.map((step) => step.id));
  if (ids.size !== steps.length) throw new Error('Duplicate flow step ids.');
  const edges = graph.edges
    .slice(0, 500)
    .map((raw) => {
      const edge = raw as Partial<FlowEdge>;
      return { id: String(edge.id ?? `${edge.source}->${edge.target}`).slice(0, 140), source: String(edge.source), target: String(edge.target) };
    })
    .filter((edge) => ids.has(edge.source) && ids.has(edge.target) && edge.source !== edge.target);
  return { steps, edges };
}

/** Per-network versions of a post's text ("customize for LinkedIn"), keyed by provider id. */
export type TextVariants = Partial<Record<string, string>>;

/** The text a network starts from: its own version if it has one, else the main text. */
export function baseText(text: string, variants: TextVariants, provider: string | undefined): string {
  const variant = provider ? variants[provider] : undefined;
  return variant?.trim() ? variant : text;
}

/**
 * Plans a whole post: each account starts from its network's text, then
 * either the flow adapts it (and decides the accounts and delays) or it goes
 * straight to the chosen accounts. Shared by the composer and the server.
 */
export function planPost(
  input: { text: string; variants: TextVariants; providerOf: (accountId: string) => string | undefined; graph?: FlowGraph; accountIds?: string[]; locale?: Locale },
  measure?: Measure,
): FlowPlan {
  const baseFor = (accountId: string) => baseText(input.text, input.variants, input.providerOf(accountId));
  if (!input.graph) {
    return { targets: [...new Set(input.accountIds ?? [])].map((accountId) => ({ accountId, text: baseFor(accountId), delayMinutes: 0 })), errors: [] };
  }
  // Flow errors are about the graph, not the text, so the main plan's errors cover every network's.
  const plans = new Map<string, FlowPlan>();
  const planFor = (base: string) => {
    let plan = plans.get(base);
    if (!plan) plans.set(base, (plan = planFlow(input.graph!, base, measure, input.locale)));
    return plan;
  };
  const main = planFor(input.text);
  const targets = main.targets.map((target) => {
    const base = baseFor(target.accountId);
    return base === input.text ? target : (planFor(base).targets.find((other) => other.accountId === target.accountId) ?? target);
  });
  return { targets, errors: main.errors };
}
