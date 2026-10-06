'use client';

import { useActionState, useMemo, useState, useTransition } from 'react';
import { errorText } from '@postwerk/core/i18n';
import { parseThemeManifest, type ThemeManifest } from '@postwerk/core/theme';
import { catalog } from '@postwerk/providers/catalog';
import { connectMastodon, connectWithForm, disconnectAccount, startBridgeConnectAction, startOAuth } from '@/app/(app)/accounts/actions';
import { BlueskyConnect } from '@/components/bluesky-connect';
import { chooseThemeAction, installBuiltinPluginAction, installPluginAction, uninstallPluginAction } from '@/app/(world)/canvas/actions';
import { ConnectForm } from '@/components/connect-form';
import { ThemePreview } from '@/components/theme-preview';
import { useLocale, useMessages } from '@/lib/i18n';
import { intlLocale } from '@/lib/locale';
import { canvasMessages } from '@/messages/canvas';
import { commonMessages } from '@/messages/common';
import { mediaSummary, networksMessages, usageCost, usageMonthLabel } from '@/messages/networks';
import { themesMessages } from '@/messages/themes';
import { useWorld } from './context';
import { ids, type WorldNode } from './layout';
import type { BridgeUsageData } from './types';

function CopyLink({ id }: { id: string }) {
  const t = useMessages(canvasMessages);
  const common = useMessages(commonMessages);
  const world = useWorld();
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      className="secondary small"
      onClick={async () => {
        await navigator.clipboard?.writeText(world.linkTo(id)).catch(() => undefined);
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      }}
    >
      {copied ? t.linkCopied : common.copyLink}
    </button>
  );
}

function Jump({ id, children }: { id: string; children: React.ReactNode }) {
  return <a href={`#n=${id}`}>{children}</a>;
}

function NetworkInspector({ node }: { node: Extract<WorldNode, { type: 'network' }> }) {
  const t = useMessages(networksMessages);
  const locale = useLocale();
  const world = useWorld();
  const { info, available, connector, bridge, bridgeable } = node.data.network;
  const { text, media, options } = info.capabilities;
  const accounts = world.data.accounts.filter((account) => account.provider === info.id);
  return (
    <>
      <p>{info.description}</p>
      <dl className="facts">
        <dt>{t.factText}</dt>
        <dd>
          {t.upToChars({
            max: text.maxLength.toLocaleString(intlLocale(locale)),
            withMedia: text.maxLengthWithMedia ? text.maxLengthWithMedia.toLocaleString(intlLocale(locale)) : undefined,
          })}
        </dd>
        <dt>{t.factMedia}</dt>
        <dd>
          {mediaSummary(media, t)}
          {media.altText ? t.altText : ''}
        </dd>
        {options.length > 0 && (
          <>
            <dt>{t.factPerPost}</dt>
            <dd>{options.map((option) => option.label).join(', ')}</dd>
          </>
        )}
        <dt>{t.factSetup}</dt>
        <dd>{bridge ? t.setupBridge(bridge) : info.setup.operator === 'none' ? t.setupNone : t.setupOperator(info.setup.envPrefix ?? '')}</dd>
      </dl>

      {accounts.length > 0 && (
        <section className="stack-sm">
          <h3>{t.connected}</h3>
          {accounts.map((account) => (
            <Jump key={account.id} id={ids.account(account.id)}>
              {account.displayName ?? account.handle}
            </Jump>
          ))}
        </section>
      )}

      {world.data.canManage && available && (
        <section className="stack">
          <h3>{t.connectAccount(accounts.length > 0)}</h3>
          {bridge ? (
            <form action={startBridgeConnectAction.bind(null, info.id, undefined)} className="stack-sm">
              <button type="submit">{t.continueTo(info.name)}</button>
              <small className="muted">{t.bridgeNote({ network: info.name, bridge })}</small>
            </form>
          ) : (
            <>
              {connector.kind === 'mastodon' && (
                <ConnectForm
                  action={connectMastodon}
                  submitLabel={t.continueTo('Mastodon')}
                  fields={[{ name: 'instance', label: t.mastodonServer, placeholder: 'mastodon.social' }]}
                />
              )}
              {connector.kind === 'form' && <ConnectForm action={connectWithForm.bind(null, info.id)} submitLabel={t.connectNamed(info.name)} fields={connector.fields} />}
              {connector.kind === 'atproto' && <BlueskyConnect fields={connector.fields} oauth={connector.oauth} />}
              {connector.kind === 'oauth2' && (
                <form action={startOAuth.bind(null, info.id)}>
                  <button type="submit">{t.continueTo(info.name)}</button>
                </form>
              )}
            </>
          )}
        </section>
      )}

      {!available && (
        <section className="stack-sm setup-box">
          <h3>{t.setupTitle}</h3>
          <p className="muted">{info.setup.review}</p>
          <p>
            {t.envSet} <code>{info.setup.envPrefix}_CLIENT_ID</code> {t.envAnd} <code>{info.setup.envPrefix}_CLIENT_SECRET</code>
            {t.envCallback} <code>/api/connect/{info.id}/callback</code>.
          </p>
          {bridgeable && (
            <p>
              {t.orBridge(bridgeable.name).before}
              <code>{bridgeable.env}</code>
              {t.orBridge(bridgeable.name).after}
            </p>
          )}
        </section>
      )}
      <a href={info.setup.docsUrl} target="_blank" rel="noreferrer">
        {t.developerDocsLink}
      </a>
    </>
  );
}

function AccountInspector({ node }: { node: Extract<WorldNode, { type: 'account' }> }) {
  const t = useMessages(canvasMessages);
  const networks = useMessages(networksMessages);
  const world = useWorld();
  const { account } = node.data;
  const usedIn = world.data.flows.filter((flow) => flow.graph.steps.some((step) => step.type === 'target' && step.accountId === account.id));
  const recent = world.data.posts.filter((post) => post.targets.some((target) => target.accountId === account.id));
  return (
    <>
      <p>
        {account.handle}
        {t.accountOn}
        <Jump id={ids.network(account.provider)}>{catalog[account.provider].name}</Jump>
        {account.bridge && <span className="muted"> · {networks.via(account.bridge)}</span>}
      </p>
      {account.status === 'needs_reauth' &&
        (account.bridge ? (
          <form action={startBridgeConnectAction.bind(null, account.provider, account.id)} className="stack-sm">
            <p className="error">{networks.bridgeExpired}</p>
            {world.data.canManage && <button type="submit">{networks.reconnect}</button>}
          </form>
        ) : (
          <p className="error">
            {t.accessExpired.before}
            <Jump id={ids.network(account.provider)}>{t.accessExpired.link}</Jump>
            {t.accessExpired.after}
          </p>
        ))}
      <section className="stack-sm">
        <h3>{t.usedInFlows}</h3>
        {usedIn.length === 0 ? <span className="muted">{t.notUsed}</span> : usedIn.map((flow) => <Jump key={flow.id} id={ids.flow(flow.id)}>{flow.name}</Jump>)}
      </section>
      <section className="stack-sm">
        <h3>{t.recentPosts}</h3>
        {recent.length === 0 ? (
          <span className="muted">{t.noneYet}</span>
        ) : (
          <span>
            {t.recentHere(recent.length)} <Jump id={ids.posts}>{t.seePosts}</Jump>
          </span>
        )}
      </section>
      {world.data.canManage && (
        <form action={disconnectAccount}>
          <input type="hidden" name="accountId" value={account.id} />
          <button type="submit" className="secondary">{networks.disconnect}</button>
        </form>
      )}
    </>
  );
}

function FlowInspector({ node }: { node: Extract<WorldNode, { type: 'flow' }> }) {
  const t = useMessages(canvasMessages);
  const world = useWorld();
  const plan = world.plans[node.data.flowId];
  const accounts = new Map(world.data.accounts.map((account) => [account.id, account]));
  return (
    <>
      <p className="muted">
        {t.flowHint.before}
        <strong>{t.steps.trigger}</strong>
        {t.flowHint.after}
      </p>
      {plan && plan.errors.map((error) => <p key={error} className="error">{error}</p>)}
      {plan && plan.targets.length > 0 && (
        <section className="stack-sm">
          <h3>{t.previewFor(t.sampleText)}</h3>
          {plan.targets.map((target) => {
            const account = accounts.get(target.accountId);
            return (
              <div key={target.accountId} className="preview">
                <strong>{account ? `${catalog[account.provider].name} · ${account.handle}` : t.missingAccount}</strong>
                {target.delayMinutes > 0 && <small className="muted">{t.after(target.delayMinutes)}</small>}
                <pre>{target.text}</pre>
              </div>
            );
          })}
        </section>
      )}
      <button
        type="button"
        className="secondary"
        onClick={() => {
          if (confirm(t.deleteFlowConfirm(node.data.name))) world.deleteFlow(node.data.flowId);
        }}
      >
        {t.deleteFlow}
      </button>
    </>
  );
}

function RegionInspector({ node }: { node: Extract<WorldNode, { type: 'region' }> }) {
  const t = useMessages(canvasMessages);
  const themes = useMessages(themesMessages);
  const world = useWorld();
  const region = node.data.region;
  return (
    <>
      <p>{t.regions[region].subtitle}.</p>
      {region === 'networks' && (
        <p className="muted">{t.networksReady({ ready: world.data.networks.filter((n) => n.available).length, total: world.data.networks.length })}</p>
      )}
      {region === 'flows' && <p className="muted">{t.flowsHint}</p>}
      {region === 'plugins' && (
        <>
          <p className="muted">{themes.regionHint}</p>
          <p className="muted">{themes.regionWho}</p>
          <a href={`#n=${ids.pluginInstall}`}>{themes.openEditorLink}</a>
        </>
      )}
    </>
  );
}

function download(theme: ThemeManifest) {
  const url = URL.createObjectURL(new Blob([`${JSON.stringify(theme, null, 2)}\n`], { type: 'application/json' }));
  Object.assign(document.createElement('a'), { href: url, download: `${theme.id}.theme.json` }).click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function PluginInspector({ node }: { node: Extract<WorldNode, { type: 'plugin' }> }) {
  const t = useMessages(themesMessages);
  const world = useWorld();
  const [pending, startTransition] = useTransition();
  const { manifest, builtin, installed } = node.data.plugin;
  const active = world.data.appearance.themeId === manifest.id;
  return (
    <>
      <p>{manifest.description}</p>
      <ThemePreview theme={manifest} large />
      <dl className="facts">
        <dt>{t.factType}</dt>
        <dd>{t.typeTheme}</dd>
        <dt>{t.factVersion}</dt>
        <dd>{manifest.version}</dd>
        <dt>{t.factAuthor}</dt>
        <dd>{manifest.author}</dd>
        <dt>{t.factSource}</dt>
        <dd>{builtin ? t.sourceBuiltin : t.sourceCustom}</dd>
        <dt>{t.factCanvas}</dt>
        <dd>
          {t.pattern[manifest.canvas.pattern]}, {t.edges[manifest.canvas.edges]}
        </dd>
        <dt>{t.factStatus}</dt>
        <dd>{active ? t.statusActive : installed ? t.statusInstalled : t.notInstalled}</dd>
      </dl>
      <div className="row">
        {installed && !active && (
          <button type="button" disabled={pending} onClick={() => startTransition(() => chooseThemeAction(manifest.id))}>
            {t.useTheme}
          </button>
        )}
        {!installed && world.data.canManage && (
          <button type="button" disabled={pending} onClick={() => startTransition(() => installBuiltinPluginAction(manifest.id))}>
            {t.install}
          </button>
        )}
        <button type="button" className="secondary" onClick={() => download(manifest)}>
          {t.download}
        </button>
        {installed && world.data.canManage && (
          <button
            type="button"
            className="secondary"
            disabled={pending}
            onClick={() => {
              if (confirm(t.uninstallConfirm({ name: manifest.name, builtin }))) {
                startTransition(() => uninstallPluginAction(manifest.id));
              }
            }}
          >
            {t.uninstall}
          </button>
        )}
      </div>
      {!builtin && <p className="muted">{t.changeCustom(manifest.name)}</p>}
    </>
  );
}

function ThemeEditor() {
  const t = useMessages(themesMessages);
  const locale = useLocale();
  const world = useWorld();
  const [state, formAction, pending] = useActionState(installPluginAction, {});
  // The extra CSS is edited on its own, as plain CSS instead of one long JSON string.
  const [json, setJson] = useState('');
  const [css, setCss] = useState('');
  const parsed = useMemo(() => {
    if (!json.trim()) return undefined;
    let value: unknown;
    try {
      value = JSON.parse(json);
    } catch (error) {
      return { error: t.notJson((error as Error).message) };
    }
    try {
      return { theme: parseThemeManifest(value && typeof value === 'object' && !Array.isArray(value) ? { ...value, css } : value) };
    } catch (error) {
      return { error: errorText(error, locale) };
    }
  }, [json, css, t, locale]);
  const themes = world.data.plugins.map((plugin) => plugin.manifest);
  const existing = parsed?.theme && world.data.plugins.find((plugin) => plugin.installed && plugin.manifest.id === parsed.theme.id);

  /** Shows a manifest, moving its "css" into the CSS field. */
  function load(text: string) {
    try {
      const { css: extra, ...rest } = JSON.parse(text) as Record<string, unknown>;
      if (typeof extra === 'string') {
        setJson(`${JSON.stringify(rest, null, 2)}\n`);
        setCss(extra.trim() ? `${extra.trim()}\n` : '');
        return;
      }
    } catch {
      // Not (yet) valid JSON: keep the text as typed.
    }
    setJson(text);
  }

  function startFrom(id: string) {
    const plugin = world.data.plugins.find((candidate) => candidate.manifest.id === id);
    if (!plugin) return;
    const theme = plugin.manifest;
    // Built-in ids are reserved; a custom theme keeps its own id so installing it again updates it.
    load(JSON.stringify(plugin.builtin ? { ...theme, id: `${theme.id}-custom`, name: t.myTheme(theme.name).slice(0, 40), author: world.data.user.name, version: '1.0.0' } : theme));
  }

  return (
    <>
      <p className="muted">{t.editorHint}</p>
      {!world.data.canManage && <p className="muted">{t.editorAdminsOnly}</p>}
      <label>
        {t.startFrom}
        <select value="" onChange={(e) => startFrom(e.target.value)}>
          <option value="">{t.chooseTheme}</option>
          {themes.map((theme) => (
            <option key={theme.id} value={theme.id}>
              {theme.name}
            </option>
          ))}
        </select>
      </label>
      <label>
        {t.openFile}
        <input type="file" accept=".json,application/json" onChange={async (e) => load((await e.target.files?.[0]?.text()) ?? '')} />
      </label>
      <form action={formAction} className="stack">
        <label>
          {t.source}
          <textarea
            className="theme-source"
            rows={14}
            value={json}
            spellCheck={false}
            placeholder={t.sourcePlaceholder}
            onChange={(e) => load(e.target.value)}
          />
        </label>
        <label>
          {t.extraCss} <small className="muted">{t.extraCssHint}</small>
          <textarea className="theme-source" rows={6} value={css} spellCheck={false} placeholder=".region { border-style: solid; }" onChange={(e) => setCss(e.target.value)} />
        </label>
        <input type="hidden" name="manifest" value={parsed?.theme ? JSON.stringify(parsed.theme) : ''} />
        {parsed?.error && <p className="error">{parsed.error}</p>}
        {parsed?.theme && <ThemePreview theme={parsed.theme} large />}
        {state.error && (
          <p className="error" role="alert">
            {state.error}
          </p>
        )}
        {state.success && (
          <p className="success" role="status">
            {state.success}
          </p>
        )}
        <div className="row">
          {world.data.canManage && (
            <button type="submit" disabled={pending || !parsed?.theme}>
              {pending ? t.installing : existing ? t.updateAndUse : t.installAndUse}
            </button>
          )}
          {parsed?.theme && (
            <button type="button" className="secondary" onClick={() => download(parsed.theme)}>
              {t.download}
            </button>
          )}
        </div>
      </form>
    </>
  );
}

function BridgeUsageInspector({ usage }: { usage: BridgeUsageData }) {
  const t = useMessages(networksMessages);
  const locale = intlLocale(useLocale());
  return (
    <>
      <p>{t.usageNow(usage)}</p>
      <table className="usage-table">
        <thead>
          <tr>
            <th scope="col">{t.usageMonth}</th>
            <th scope="col">{t.usageAccounts}</th>
            <th scope="col">{t.usageProfiles}</th>
            {usage.price && <th scope="col">{t.usageEstimate}</th>}
          </tr>
        </thead>
        <tbody>
          {usage.months.map((month) => (
            <tr key={month.month}>
              <td>{usageMonthLabel(month.month, locale)}</td>
              <td>{month.peakAccounts}</td>
              <td>{month.peakProfiles}</td>
              {usage.price && <td>{usageCost(month.peakAccounts, usage.price, locale)}</td>}
            </tr>
          ))}
        </tbody>
      </table>
      <p className="muted">{t.usageAbout(usage.name)}</p>
      {!usage.price && (
        <p className="muted">
          {t.usageSetPrice.before}
          <code>ZERNIO_ACCOUNT_PRICE</code>
          {t.usageSetPrice.after}
        </p>
      )}
    </>
  );
}

export function Inspector({ node, onClose }: { node: WorldNode | undefined; onClose(): void }) {
  const t = useMessages(canvasMessages);
  const themes = useMessages(themesMessages);
  const common = useMessages(commonMessages);
  const usage = useWorld().data.bridgeUsage;
  const networks = useMessages(networksMessages);
  if (!node || node.type === 'step' || node.type === 'composer' || node.type === 'posts' || node.type === 'calendar' || node.type === 'activity' || node.type === 'members') return null;
  if (node.type === 'bridgeUsage' && !usage) return null;
  const title =
    node.type === 'bridgeUsage'
      ? networks.usageTitle(usage!.name)
      : node.type === 'network'
      ? node.data.network.info.name
      : node.type === 'account'
        ? (node.data.account.displayName ?? node.data.account.handle)
        : node.type === 'flow'
          ? node.data.name
          : node.type === 'plugin'
            ? node.data.plugin.manifest.name
            : node.type === 'pluginInstall'
              ? themes.editorTitle
              : t.regions[node.data.region].title;
  return (
    <aside className="inspector" aria-label={t.details(title)}>
      <header className="row-tight">
        <h2 className="grow">{title}</h2>
        <CopyLink id={node.id} />
        <button type="button" className="icon-button" aria-label={common.close} onClick={onClose}>
          ×
        </button>
      </header>
      <div className="stack inspector-body">
        {node.type === 'network' && <NetworkInspector node={node} />}
        {node.type === 'account' && <AccountInspector node={node} />}
        {node.type === 'flow' && <FlowInspector node={node} />}
        {node.type === 'region' && <RegionInspector node={node} />}
        {node.type === 'plugin' && <PluginInspector node={node} />}
        {node.type === 'pluginInstall' && <ThemeEditor />}
        {node.type === 'bridgeUsage' && usage && <BridgeUsageInspector usage={usage} />}
      </div>
    </aside>
  );
}
