'use client';

import { Handle, Position, type NodeProps } from '@xyflow/react';
import { useTransition } from 'react';
import { stepLabels, type FlowStep } from '@postwerk/core/flow';
import { catalog } from '@postwerk/providers/catalog';
import { Composer } from '@/components/composer';
import { LocalTime } from '@/components/local-time';
import { ThemePreview } from '@/components/theme-preview';
import { submitPost } from '@/app/(app)/posts/actions';
import { chooseThemeAction, installBuiltinPluginAction } from '@/app/(world)/canvas/actions';
import { useWorld } from './context';
import { ids, type WorldNode } from './layout';

type Props<T extends WorldNode['type']> = NodeProps<Extract<WorldNode, { type: T }>>;

export function mediaSummary(id: keyof typeof catalog): string {
  const { media } = catalog[id].capabilities;
  if (media.maxImages === 0 && media.maxVideos === 0) return 'Text only';
  const parts = [];
  if (media.maxImages > 0) parts.push(`${media.maxImages} image${media.maxImages === 1 ? '' : 's'}`);
  if (media.maxVideos > 0) parts.push(`${media.maxVideos} video${media.maxVideos === 1 ? '' : 's'}`);
  return `${parts.join(media.mixed ? ' + ' : ' or ')}${media.required ? ' · media required' : ''}`;
}

function formatMinutes(minutes: number): string {
  if (minutes < 60) return `${minutes} min`;
  const days = Math.floor(minutes / 1440);
  const hours = Math.floor((minutes % 1440) / 60);
  const rest = minutes % 60;
  return [days && `${days} d`, hours && `${hours} h`, rest && `${rest} min`].filter(Boolean).join(' ');
}

export function RegionNode({ data }: Props<'region'>) {
  return (
    <div className={`region region-${data.region}`}>
      <header className="region-drag">
        <h2>{data.title}</h2>
        <p>{data.subtitle}</p>
      </header>
    </div>
  );
}

export function NetworkNode({ data, selected }: Props<'network'>) {
  const { info, available } = data.network;
  const status = data.accountCount > 0 ? 'connected' : available ? 'ready' : 'setup';
  const label = { connected: `${data.accountCount} connected`, ready: 'Ready to connect', setup: 'Needs setup' }[status];
  return (
    <div className={`world-card network-node ${selected ? 'is-selected' : ''}`}>
      <div className="row-tight">
        <strong className="grow">{info.name}</strong>
        <span className={`dot dot-${status}`} aria-hidden />
      </div>
      <span className={`status-text status-${status}`}>{label}</span>
      <small className="muted">
        {info.capabilities.text.maxLength.toLocaleString()} chars · {mediaSummary(info.id)}
      </small>
      <Handle type="source" position={Position.Right} id="out" isConnectable={false} />
    </div>
  );
}

export function AccountNode({ data, selected }: Props<'account'>) {
  const { account } = data;
  return (
    <div className={`world-card account-node ${selected ? 'is-selected' : ''}`}>
      <Handle type="target" position={Position.Left} id="in" isConnectable={false} />
      <div className="row-tight">
        {account.avatarUrl ? <img src={account.avatarUrl} alt="" className="avatar-sm" /> : <span className="avatar-sm" />}
        <div className="grow clip">
          <strong className="clip">{account.displayName ?? account.handle}</strong>
          <small className="muted clip">
            {catalog[account.provider].name} · {account.handle}
          </small>
        </div>
      </div>
      {account.status === 'needs_reauth' && <span className="badge badge-warn">Reconnect needed</span>}
    </div>
  );
}

export function FlowNode({ data, selected }: Props<'flow'>) {
  const world = useWorld();
  const plan = world.plans[data.flowId];
  const save = world.saveState[data.flowId] ?? 'saved';
  return (
    <div className={`flow-frame ${selected ? 'is-selected' : ''}`}>
      <header className="flow-header">
        <span className="flow-drag" title="Drag to move the flow">⠿</span>
        <input
          className="nodrag flow-name"
          aria-label="Flow name"
          defaultValue={data.name}
          onBlur={(e) => e.target.value !== data.name && world.renameFlow(data.flowId, e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
        />
        <div className="flow-tools nodrag">
          <button type="button" className="secondary small" onClick={() => world.addStep(data.flowId, 'addText')}>+ Add text</button>
          <button type="button" className="secondary small" onClick={() => world.addStep(data.flowId, 'shorten')}>+ Shorten</button>
          <button type="button" className="secondary small" onClick={() => world.addStep(data.flowId, 'delay')}>+ Wait</button>
          <button type="button" className="small" onClick={() => world.addStep(data.flowId, 'target')}>+ Account</button>
        </div>
        <span className={`save-state save-${save}`}>{{ saved: 'Saved', saving: 'Saving…', unsaved: 'Unsaved', error: 'Not saved' }[save]}</span>
      </header>
      {plan && (
        <p className={plan.errors.length ? 'flow-plan error' : 'flow-plan muted'}>
          {plan.errors.length ? plan.errors[0] : `Publishes to ${plan.targets.length} account${plan.targets.length === 1 ? '' : 's'}.`}
        </p>
      )}
    </div>
  );
}

export function StepNode({ data, selected }: Props<'step'>) {
  const world = useWorld();
  const { step, flowId } = data;
  const update = (patch: Partial<FlowStep>) => world.updateStep(flowId, step.id, patch);
  const account = step.type === 'target' ? world.data.accounts.find((a) => a.id === step.accountId) : undefined;

  return (
    <div className={`world-card step-node step-${step.type} ${selected ? 'is-selected' : ''}`}>
      {step.type !== 'trigger' && <Handle type="target" position={Position.Left} id="in" />}
      <div className="row-tight">
        <strong className="grow">{stepLabels[step.type]}</strong>
        {step.type !== 'trigger' && (
          <button type="button" className="icon-button nodrag" aria-label="Remove step" onClick={() => world.removeStep(flowId, step.id)}>
            ×
          </button>
        )}
      </div>

      {step.type === 'trigger' && <small className="muted">Starts when a post is published with this flow.</small>}

      {step.type === 'addText' && (
        <>
          <select className="nodrag" aria-label="Placement" value={step.placement} onChange={(e) => update({ placement: e.target.value as 'start' | 'end' })}>
            <option value="end">At the end</option>
            <option value="start">At the start</option>
          </select>
          <textarea
            className="nodrag nowheel"
            rows={2}
            aria-label="Text to add"
            placeholder="#physio #rückengesundheit"
            defaultValue={step.text}
            onChange={(e) => update({ text: e.target.value })}
          />
        </>
      )}

      {step.type === 'shorten' && <small className="muted">Cuts the text to each network’s limit, ending with “…”.</small>}

      {step.type === 'delay' && (
        <label className="row-tight nodrag">
          <input
            type="number"
            min={0}
            step={5}
            aria-label="Minutes"
            defaultValue={step.minutes}
            onChange={(e) => update({ minutes: Math.max(0, Number(e.target.value) || 0) })}
          />
          <span className="muted">min{step.minutes >= 60 ? ` (${formatMinutes(step.minutes)})` : ''}</span>
        </label>
      )}

      {step.type === 'target' && (
        <>
          <select className="nodrag" aria-label="Account" value={step.accountId} onChange={(e) => update({ accountId: e.target.value })}>
            <option value="">Choose account…</option>
            {world.data.accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {catalog[a.provider].name}: {a.handle}
              </option>
            ))}
          </select>
          {step.accountId && !account && <small className="error">This account was disconnected.</small>}
          {account && (
            <a className="small-link nodrag" href={`#n=${ids.account(account.id)}`}>
              Go to account →
            </a>
          )}
        </>
      )}

      {step.type !== 'target' ? (
        <Handle type="source" position={Position.Right} id="out" />
      ) : (
        <Handle type="source" position={Position.Right} id="feed" isConnectable={false} className="feed-handle" />
      )}
    </div>
  );
}

export function ComposerNode({ selected }: Props<'composer'>) {
  const world = useWorld();
  const accounts = world.data.accounts.map((account) => ({
    id: account.id,
    handle: account.handle,
    provider: account.provider,
    maxLength: account.maxLength,
    disabledReason: account.status === 'needs_reauth' ? 'Reconnect needed' : undefined,
  }));
  return (
    <div className={`world-panel ${selected ? 'is-selected' : ''}`}>
      <header className="panel-drag">New post</header>
      <div className="nodrag nowheel nopan panel-body">
        {accounts.length === 0 ? (
          <p className="muted">
            Connect an account in <a href={`#n=${ids.region('networks')}`}>Networks</a> first.
          </p>
        ) : (
          <Composer accounts={accounts} flows={world.data.flows} action={submitPost} returnTo="/canvas" />
        )}
      </div>
    </div>
  );
}

const statusLabels = { draft: 'Draft', scheduled: 'Scheduled', publishing: 'Publishing', published: 'Published', partial: 'Partly published', failed: 'Failed' };

export function PostsNode({ selected }: Props<'posts'>) {
  const world = useWorld();
  const handles = new Map(world.data.accounts.map((account) => [account.id, account]));
  return (
    <div className={`world-panel ${selected ? 'is-selected' : ''}`}>
      <header className="panel-drag">
        Recent posts <a className="small-link nodrag" href="/posts">Full list →</a>
      </header>
      <div className="nodrag nowheel nopan panel-body stack">
        {world.data.posts.length === 0 && <p className="muted">Nothing published yet.</p>}
        {world.data.posts.map((post) => (
          <article key={post.id} className="post-mini">
            <div className="row-tight">
              <span className={`badge status-${post.status}`}>{statusLabels[post.status]}</span>
              <small className="muted grow">{post.scheduledAt && <LocalTime iso={post.scheduledAt} />}</small>
              {post.mediaCount > 0 && <small className="muted">{post.mediaCount} media</small>}
            </div>
            <p className="clip-2">{post.text}</p>
            <div className="chips">
              {post.targets.map((target) => {
                const account = handles.get(target.accountId);
                return (
                  <a key={target.accountId} href={`#n=${ids.account(target.accountId)}`} className={`chip chip-${target.status}`} title={target.error ?? target.status}>
                    {account ? `${catalog[account.provider].name} · ${account.handle}` : 'Removed account'}
                  </a>
                );
              })}
            </div>
          </article>
        ))}
      </div>
    </div>
  );
}

export function PluginNode({ data, selected }: Props<'plugin'>) {
  const world = useWorld();
  const [pending, startTransition] = useTransition();
  const { manifest, builtin, installed } = data.plugin;
  const active = world.data.appearance.themeId === manifest.id;
  return (
    <div className={`world-card plugin-node ${installed ? '' : 'is-available'} ${selected ? 'is-selected' : ''}`}>
      <div className="row-tight">
        <strong className="grow clip">{manifest.name}</strong>
        {active ? (
          <span className="badge badge-active">In use</span>
        ) : installed ? (
          <button type="button" className="secondary small nodrag" disabled={pending} onClick={() => startTransition(() => chooseThemeAction(manifest.id))}>
            {pending ? 'Switching…' : 'Use'}
          </button>
        ) : (
          world.data.canManage && (
            <button type="button" className="small nodrag" disabled={pending} onClick={() => startTransition(() => installBuiltinPluginAction(manifest.id))}>
              {pending ? 'Installing…' : 'Install'}
            </button>
          )
        )}
      </div>
      <small className="muted meta clip">
        {installed ? `${manifest.author} · v${manifest.version}` : 'Not installed'}
        {builtin ? ' · Built-in' : ''}
      </small>
      <p className="clip-2 muted">{manifest.description}</p>
      <ThemePreview theme={manifest} />
    </div>
  );
}

export function PluginInstallNode({ id, selected }: Props<'pluginInstall'>) {
  const world = useWorld();
  return (
    <div className={`world-card plugin-node is-available ${selected ? 'is-selected' : ''}`}>
      <strong>+ Add a theme</strong>
      <p className="muted">
        Start from any theme, change colors, fonts and shapes for light and dark mode, and install it. Or install a theme file someone shared.
      </p>
      <button type="button" className="small nodrag" onClick={() => world.focus(id)}>
        Open theme editor
      </button>
    </div>
  );
}

export const nodeTypes = {
  region: RegionNode,
  network: NetworkNode,
  account: AccountNode,
  flow: FlowNode,
  step: StepNode,
  composer: ComposerNode,
  posts: PostsNode,
  plugin: PluginNode,
  pluginInstall: PluginInstallNode,
};
