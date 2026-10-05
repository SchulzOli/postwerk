import { describe, expect, it } from 'vitest';
import { emptyFlow, parseFlowGraph, planFlow, shortenToFit, type FlowGraph, type FlowStep } from '../src/flow';

const at = { x: 0, y: 0 };
type StepInput = FlowStep extends infer S ? (S extends FlowStep ? Omit<S, 'position'> : never) : never;
function graph(steps: StepInput[], edges: [string, string][]): FlowGraph {
  return {
    steps: [{ id: 'trigger', type: 'trigger', position: at }, ...steps.map((step) => ({ ...step, position: at }) as FlowStep)],
    edges: edges.map(([source, target]) => ({ id: `${source}-${target}`, source, target })),
  };
}

describe('planFlow', () => {
  it('fans out to every account with its own adaptations', () => {
    const flow = graph(
      [
        { id: 'tags', type: 'addText', placement: 'end', text: '#physio #rücken' },
        { id: 'wait', type: 'delay', minutes: 90 },
        { id: 'insta', type: 'target', accountId: 'ig' },
        { id: 'mastodon', type: 'target', accountId: 'm' },
        { id: 'linkedin', type: 'target', accountId: 'li' },
      ],
      [
        ['trigger', 'tags'],
        ['tags', 'insta'],
        ['tags', 'wait'],
        ['wait', 'linkedin'],
        ['trigger', 'mastodon'],
      ],
    );
    expect(planFlow(flow, 'Neue Übungen')).toEqual({
      targets: [
        { accountId: 'ig', text: 'Neue Übungen\n\n#physio #rücken', delayMinutes: 0 },
        { accountId: 'li', text: 'Neue Übungen\n\n#physio #rücken', delayMinutes: 90 },
        { accountId: 'm', text: 'Neue Übungen', delayMinutes: 0 },
      ],
      errors: [],
    });
  });

  it('adds text at the start', () => {
    const flow = graph(
      [
        { id: 'intro', type: 'addText', placement: 'start', text: '📣 Neu:' },
        { id: 't', type: 'target', accountId: 'a' },
      ],
      [
        ['trigger', 'intro'],
        ['intro', 't'],
      ],
    );
    expect(planFlow(flow, 'Text').targets[0]!.text).toBe('📣 Neu:\n\nText');
  });

  it('shortens to each account’s limit', () => {
    const flow = graph(
      [
        { id: 'short', type: 'shorten' },
        { id: 'x', type: 'target', accountId: 'x' },
      ],
      [
        ['trigger', 'short'],
        ['short', 'x'],
      ],
    );
    const measure = (_: string, text: string) => ({ length: [...text].length, max: 20 });
    const [target] = planFlow(flow, 'Eine sehr lange Nachricht über Rückenschmerzen', measure).targets;
    expect([...target!.text].length).toBeLessThanOrEqual(20);
    expect(target!.text.endsWith('…')).toBe(true);
  });

  it('reports loops, duplicates and empty flows', () => {
    expect(planFlow(emptyFlow(), 'x').errors).toEqual(['The flow does not reach any account yet.']);
    const loop = graph([{ id: 'a', type: 'delay', minutes: 1 }], [
      ['trigger', 'a'],
      ['a', 'a2'],
    ]);
    loop.steps.push({ id: 'a2', type: 'delay', minutes: 1, position: at });
    loop.edges.push({ id: 'back', source: 'a2', target: 'a' });
    expect(planFlow(loop, 'x').errors).toContain('The flow contains a loop.');

    const duplicate = graph(
      [
        { id: 't1', type: 'target', accountId: 'same' },
        { id: 'd', type: 'delay', minutes: 5 },
        { id: 't2', type: 'target', accountId: 'same' },
      ],
      [
        ['trigger', 't1'],
        ['trigger', 'd'],
        ['d', 't2'],
      ],
    );
    expect(planFlow(duplicate, 'x').errors[0]).toMatch(/more than one path/);
    expect(planFlow({ steps: [], edges: [] }, 'x').errors[0]).toMatch(/exactly one/);
  });
});

describe('shortenToFit', () => {
  it('keeps short text and breaks at words', () => {
    expect(shortenToFit('short', () => true)).toBe('short');
    expect(shortenToFit('one two three four five', (t) => t.length <= 15)).toBe('one two three…');
  });

  it('never splits emoji', () => {
    const result = shortenToFit('👨‍👩‍👧👨‍👩‍👧👨‍👩‍👧👨‍👩‍👧', (t) => [...new Intl.Segmenter().segment(t)].length <= 3);
    expect(result).toBe('👨‍👩‍👧👨‍👩‍👧…');
  });
});

describe('parseFlowGraph', () => {
  it('sanitizes input from the browser', () => {
    const parsed = parseFlowGraph({
      steps: [
        { id: 'trigger', type: 'trigger', position: { x: '5', y: 2 } },
        { id: 'd', type: 'delay', minutes: -4, position: {} },
        { id: 't', type: 'target', accountId: 'acc' },
      ],
      edges: [
        { source: 'trigger', target: 'd' },
        { source: 'd', target: 'ghost' },
        { source: 't', target: 't' },
      ],
    });
    expect(parsed.steps[0]!.position).toEqual({ x: 5, y: 2 });
    expect(parsed.steps[1]).toMatchObject({ type: 'delay', minutes: 0 });
    expect(parsed.edges).toEqual([{ id: 'trigger->d', source: 'trigger', target: 'd' }]);
    expect(() => parseFlowGraph({ steps: [{ id: 'x', type: 'evil' }], edges: [] })).toThrow();
  });
});
