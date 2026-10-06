'use client';

import { Handle, Position, type NodeProps } from '@xyflow/react';
import { useTransition } from 'react';
import type { FlowStep } from '@postwerk/core/flow';
import { catalog } from '@postwerk/providers/catalog';
import { Composer } from '@/components/composer';
import { LocalTime } from '@/components/local-time';
import { RelativeTime } from '@/components/relative-time';
import { TeamPanel } from '@/components/team';
import { ThemePreview } from '@/components/theme-preview';
import { retryPostAction, submitPost } from '@/app/(app)/posts/actions';
import { chooseThemeAction, installBuiltinPluginAction } from '@/app/(world)/canvas/actions';
import { useWorld } from './context';
import { describeActivity, isWarning } from '@/lib/activity';
import { useLocale, useMessages } from '@/lib/i18n';
import { intlLocale } from '@/lib/locale';
import { canEdit, canPostAgain, canRetry } from '@/lib/post-status';
import { Calendar } from '@/components/calendar';
import { canvasMessages, formatMinutes } from '@/messages/canvas';
import { commonMessages } from '@/messages/common';
import { mediaSummary, networksMessages, usageCost } from '@/messages/networks';
import { themesMessages } from '@/messages/themes';
import { ids, type WorldNode } from './layout';
import type { WorldData } from './types';

type Props<T extends WorldNode['type']> = NodeProps<Extract<WorldNode, { type: T }>>;

export function RegionNode({ data }: Props<'region'>) {
  const { title, subtitle } = useMessages(canvasMessages).regions[data.region];
  return (
    <div className={`region region-${data.region}`}>
      <header className="region-drag">
        <h2>{title}</h2>
        <p>{subtitle}</p>
      </header>
    </div>
  );
}

export function NetworkNode({ data, selected }: Props<'network'>) {
  const t = useMessages(networksMessages);
  const locale = useLocale();
  const { info, available, bridge } = data.network;
  const status = data.accountCount > 0 ? 'connected' : available ? 'ready' : 'setup';
  const label = { connected: t.statusConnected(data.accountCount), ready: bridge ? t.statusReadyVia(bridge) : t.statusReady, setup: t.statusSetup }[status];
  return (
    <div className={`world-card network-node ${selected ? 'is-selected' : ''}`}>
      <div className="row-tight">
        <strong className="grow">{info.name}</strong>
        <span className={`dot dot-${status}`} aria-hidden />
      </div>
      <span className={`status-text status-${status}`}>{label}</span>
      <small className="muted">
        {t.chars(info.capabilities.text.maxLength.toLocaleString(intlLocale(locale)))} · {mediaSummary(info.capabilities.media, t)}
      </small>
      <Handle type="source" position={Position.Right} id="out" isConnectable={false} />
    </div>
  );
}

export function AccountNode({ data, selected }: Props<'account'>) {
  const common = useMessages(commonMessages);
  const networks = useMessages(networksMessages);
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
            {account.bridge && ` · ${networks.via(account.bridge)}`}
          </small>
        </div>
      </div>
      {account.status === 'needs_reauth' && <span className="badge badge-warn">{common.reconnectNeeded}</span>}
    </div>
  );
}

export function BridgeUsageNode({ selected }: Props<'bridgeUsage'>) {
  const t = useMessages(networksMessages);
  const locale = intlLocale(useLocale());
  const usage = useWorld().data.bridgeUsage;
  if (!usage) return null;
  const month = usage.months[0]!;
  return (
    <div className={`world-card ${selected ? 'is-selected' : ''}`}>
      <strong>{t.usageTitle(usage.name)}</strong>
      <span>{t.usageNow(usage)}</span>
      <small className="muted">
        {t.usageThisMonth(month.peakAccounts)}
        {usage.price && ` · ${t.usageCost(usageCost(month.peakAccounts, usage.price, locale))}`}
      </small>
    </div>
  );
}

export function FlowNode({ data, selected }: Props<'flow'>) {
  const t = useMessages(canvasMessages);
  const world = useWorld();
  const plan = world.plans[data.flowId];
  const save = world.saveState[data.flowId] ?? 'saved';
  return (
    <div className={`flow-frame ${selected ? 'is-selected' : ''}`}>
      <header className="flow-header">
        <span className="flow-drag" title={t.dragFlow}>⠿</span>
        <input
          className="nodrag flow-name"
          aria-label={t.flowName}
          defaultValue={data.name}
          onBlur={(e) => e.target.value !== data.name && world.renameFlow(data.flowId, e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
        />
        <div className="flow-tools nodrag">
          <button type="button" className="secondary small" onClick={() => world.addStep(data.flowId, 'addText')}>{t.addText}</button>
          <button type="button" className="secondary small" onClick={() => world.addStep(data.flowId, 'shorten')}>{t.addShorten}</button>
          <button type="button" className="secondary small" onClick={() => world.addStep(data.flowId, 'delay')}>{t.addWait}</button>
          <button type="button" className="small" onClick={() => world.addStep(data.flowId, 'target')}>{t.addAccount}</button>
        </div>
        <span className={`save-state save-${save}`}>{t.saveState[save]}</span>
      </header>
      {plan && (
        <p className={plan.errors.length ? 'flow-plan error' : 'flow-plan muted'}>
          {plan.errors.length ? plan.errors[0] : t.publishesTo(plan.targets.length)}
        </p>
      )}
    </div>
  );
}

export function StepNode({ data, selected }: Props<'step'>) {
  const t = useMessages(canvasMessages);
  const world = useWorld();
  const { step, flowId } = data;
  const update = (patch: Partial<FlowStep>) => world.updateStep(flowId, step.id, patch);
  const account = step.type === 'target' ? world.data.accounts.find((a) => a.id === step.accountId) : undefined;

  return (
    <div className={`world-card step-node step-${step.type} ${selected ? 'is-selected' : ''}`}>
      {step.type !== 'trigger' && <Handle type="target" position={Position.Left} id="in" />}
      <div className="row-tight">
        <strong className="grow">{t.steps[step.type]}</strong>
        {step.type !== 'trigger' && (
          <button type="button" className="icon-button nodrag" aria-label={t.removeStep} onClick={() => world.removeStep(flowId, step.id)}>
            ×
          </button>
        )}
      </div>

      {step.type === 'trigger' && <small className="muted">{t.triggerHint}</small>}

      {step.type === 'addText' && (
        <>
          <select className="nodrag" aria-label={t.placement} value={step.placement} onChange={(e) => update({ placement: e.target.value as 'start' | 'end' })}>
            <option value="end">{t.atEnd}</option>
            <option value="start">{t.atStart}</option>
          </select>
          <textarea
            className="nodrag nowheel"
            rows={2}
            aria-label={t.textToAdd}
            placeholder="#physio #rückengesundheit"
            defaultValue={step.text}
            onChange={(e) => update({ text: e.target.value })}
          />
        </>
      )}

      {step.type === 'shorten' && <small className="muted">{t.shortenHint}</small>}

      {step.type === 'delay' && (
        <label className="row-tight nodrag">
          <input
            type="number"
            min={0}
            step={5}
            aria-label={t.minutes}
            defaultValue={step.minutes}
            onChange={(e) => update({ minutes: Math.max(0, Number(e.target.value) || 0) })}
          />
          <span className="muted">
            {t.minutesUnit}
            {step.minutes >= 60 ? ` (${formatMinutes(step.minutes, t)})` : ''}
          </span>
        </label>
      )}

      {step.type === 'target' && (
        <>
          <select className="nodrag" aria-label={t.account} value={step.accountId} onChange={(e) => update({ accountId: e.target.value })}>
            <option value="">{t.chooseAccount}</option>
            {world.data.accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {catalog[a.provider].name}: {a.handle}
              </option>
            ))}
          </select>
          {step.accountId && !account && <small className="error">{t.accountGone}</small>}
          {account && (
            <a className="small-link nodrag" href={`#n=${ids.account(account.id)}`}>
              {t.goToAccount}
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
  const t = useMessages(canvasMessages);
  const common = useMessages(commonMessages);
  const world = useWorld();
  const { composing } = world;
  const accounts = world.data.accounts.map((account) => ({
    id: account.id,
    handle: account.handle,
    provider: account.provider,
    maxLength: account.maxLength,
    disabledReason: account.status === 'needs_reauth' ? common.reconnectNeeded : undefined,
  }));
  return (
    <div className={`world-panel ${selected ? 'is-selected' : ''}`}>
      <header className="panel-drag">{composing?.postId ? t.editPost : composing ? t.postAgain : t.newPost}</header>
      <div className="nodrag nowheel nopan panel-body">
        {accounts.length === 0 ? (
          <p className="muted">
            {t.connectFirst.before}
            <a href={`#n=${ids.region('networks')}`}>{t.connectFirst.link}</a>
            {t.connectFirst.after}
          </p>
        ) : (
          <Composer
            key={world.composerKey}
            accounts={accounts}
            flows={world.data.flows}
            action={submitPost}
            returnTo="/canvas"
            initial={composing}
            scheduledAt={world.composeTime}
            onSaved={() => {
              world.resetComposer();
              world.focus(ids.posts);
            }}
            onCancel={composing || world.composeTime ? world.resetComposer : undefined}
          />
        )}
      </div>
    </div>
  );
}

function PostActions({ post }: { post: WorldData['posts'][number] }) {
  const t = useMessages(canvasMessages);
  const common = useMessages(commonMessages);
  const world = useWorld();
  const [pending, startTransition] = useTransition();
  const editable = canEdit(post.status);
  const retry = canRetry(post.status);
  const again = canPostAgain(post.status);
  if (!editable && !retry && !again) return null;
  return (
    <div className="row-tight post-actions">
      {editable && (
        <button type="button" className="link small-link" disabled={pending} onClick={() => startTransition(() => world.composeFrom(post.id))}>
          {common.edit}
        </button>
      )}
      {retry && (
        <button type="button" className="link small-link" disabled={pending} onClick={() => startTransition(() => retryPostAction(post.id))}>
          {pending ? t.retrying : t.retryFailed}
        </button>
      )}
      {again && (
        <button type="button" className="link small-link" disabled={pending} onClick={() => startTransition(() => world.composeFrom(post.id, true))}>
          {t.postAgain}
        </button>
      )}
    </div>
  );
}

export function PostsNode({ selected }: Props<'posts'>) {
  const t = useMessages(canvasMessages);
  const common = useMessages(commonMessages);
  const world = useWorld();
  const handles = new Map(world.data.accounts.map((account) => [account.id, account]));
  return (
    <div className={`world-panel ${selected ? 'is-selected' : ''}`}>
      <header className="panel-drag">
        {t.recentPosts} <a className="small-link nodrag" href="/posts">{t.fullList}</a>
      </header>
      <div className="nodrag nowheel nopan panel-body stack">
        {world.data.posts.length === 0 && <p className="muted">{t.nothingPublished}</p>}
        {world.data.posts.map((post) => (
          <article key={post.id} className="post-mini">
            <div className="row-tight">
              <span className={`badge status-${post.status}`}>{common.status[post.status]}</span>
              <small className="muted grow">{post.scheduledAt && <LocalTime iso={post.scheduledAt} />}</small>
              {post.mediaCount > 0 && <small className="muted">{t.mediaCount(post.mediaCount)}</small>}
            </div>
            <p className="clip-2">{post.text}</p>
            {post.media.length > 0 && (
              <div className="post-media">
                {post.media.map((item) =>
                  item.kind === 'video' ? <video key={item.url} src={item.url} muted preload="metadata" /> : <img key={item.url} src={item.url} alt={item.altText ?? ''} loading="lazy" />,
                )}
              </div>
            )}
            <PostActions post={post} />
            <div className="chips">
              {post.targets.map((target) => {
                const account = handles.get(target.accountId);
                return (
                  <a key={target.accountId} href={`#n=${ids.account(target.accountId)}`} className={`chip chip-${target.status}`} title={target.error ?? common.targetStatus[target.status]}>
                    {account ? `${catalog[account.provider].name} · ${account.handle}` : common.removedAccount}
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

export function CalendarNode({ selected }: Props<'calendar'>) {
  const t = useMessages(canvasMessages);
  const common = useMessages(commonMessages);
  const world = useWorld();
  return (
    <div className={`world-panel calendar-panel ${selected ? 'is-selected' : ''}`}>
      <header className="panel-drag">
        {common.nav.calendar} <a className="small-link nodrag" href="/calendar">{t.fullPage}</a>
      </header>
      <div className="nodrag nowheel nopan panel-body">
        <Calendar seed={world.data.calendar} onEdit={(postId, asCopy) => void world.composeFrom(postId, asCopy)} onCreate={world.composeAt} />
      </div>
    </div>
  );
}

export function PluginNode({ data, selected }: Props<'plugin'>) {
  const t = useMessages(themesMessages);
  const world = useWorld();
  const [pending, startTransition] = useTransition();
  const { manifest, builtin, installed } = data.plugin;
  const active = world.data.appearance.themeId === manifest.id;
  return (
    <div className={`world-card plugin-node ${installed ? '' : 'is-available'} ${selected ? 'is-selected' : ''}`}>
      <div className="row-tight">
        <strong className="grow clip">{manifest.name}</strong>
        {active ? (
          <span className="badge badge-active">{t.inUse}</span>
        ) : installed ? (
          <button type="button" className="secondary small nodrag" disabled={pending} onClick={() => startTransition(() => chooseThemeAction(manifest.id))}>
            {pending ? t.switching : t.use}
          </button>
        ) : (
          world.data.canManage && (
            <button type="button" className="small nodrag" disabled={pending} onClick={() => startTransition(() => installBuiltinPluginAction(manifest.id))}>
              {pending ? t.installing : t.install}
            </button>
          )
        )}
      </div>
      <small className="muted meta clip">
        {installed ? `${manifest.author} · v${manifest.version}` : t.notInstalled}
        {builtin ? t.builtinSuffix : ''}
      </small>
      <p className="clip-2 muted">{manifest.description}</p>
      <ThemePreview theme={manifest} />
    </div>
  );
}

export function PluginInstallNode({ id, selected }: Props<'pluginInstall'>) {
  const t = useMessages(themesMessages);
  const world = useWorld();
  return (
    <div className={`world-card plugin-node is-available ${selected ? 'is-selected' : ''}`}>
      <strong>{t.addTheme}</strong>
      <p className="muted">{t.addThemeHint}</p>
      <button type="button" className="small nodrag" onClick={() => world.focus(id)}>
        {t.openEditor}
      </button>
    </div>
  );
}

export function ActivityNode({ selected }: Props<'activity'>) {
  const t = useMessages(canvasMessages);
  const common = useMessages(commonMessages);
  const locale = useLocale();
  const world = useWorld();
  const items = world.data.activity;
  return (
    <div className={`world-panel ${selected ? 'is-selected' : ''}`}>
      <header className="panel-drag">
        {common.nav.activity} {items && <a className="small-link nodrag" href="/activity">{t.allActivity}</a>}
      </header>
      <div className="nodrag nowheel nopan panel-body">
        {items === null ? (
          <p className="muted">{t.activityAdminsOnly}</p>
        ) : items.length === 0 ? (
          <p className="muted">{t.nothingHappened}</p>
        ) : (
          <ul className="activity-list">
            {items.map((item) => (
              <li key={item.id} className={isWarning(item) ? 'activity-warn' : undefined}>
                <span>{describeActivity(item, locale)}</span> <small className="muted"><RelativeTime iso={item.createdAt} /></small>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

export function MembersNode({ selected }: Props<'members'>) {
  const t = useMessages(canvasMessages);
  const world = useWorld();
  return (
    <div className={`world-panel ${selected ? 'is-selected' : ''}`}>
      <header className="panel-drag">
        {world.data.workspace.name} <span className="muted">{t.members(world.data.team.members.length)}</span>
      </header>
      <div className="nodrag nowheel nopan panel-body">
        <TeamPanel data={world.data.team} />
      </div>
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
  calendar: CalendarNode,
  plugin: PluginNode,
  pluginInstall: PluginInstallNode,
  activity: ActivityNode,
  members: MembersNode,
  bridgeUsage: BridgeUsageNode,
};
