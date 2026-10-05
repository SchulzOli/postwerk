'use client';

import { useActionState, useMemo, useState, useTransition } from 'react';
import { parseThemeManifest, type ThemeManifest } from '@postwerk/core/theme';
import { catalog } from '@postwerk/providers/catalog';
import { connectMastodon, connectWithForm, disconnectAccount, startOAuth } from '@/app/(app)/accounts/actions';
import { chooseThemeAction, installBuiltinPluginAction, installPluginAction, uninstallPluginAction } from '@/app/(world)/canvas/actions';
import { ConnectForm } from '@/components/connect-form';
import { ThemePreview } from '@/components/theme-preview';
import { useWorld } from './context';
import { ids, regionInfo, type WorldNode } from './layout';
import { mediaSummary } from './nodes';

function CopyLink({ id }: { id: string }) {
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
      {copied ? 'Link copied' : 'Copy link'}
    </button>
  );
}

function Jump({ id, children }: { id: string; children: React.ReactNode }) {
  return <a href={`#n=${id}`}>{children}</a>;
}

function NetworkInspector({ node }: { node: Extract<WorldNode, { type: 'network' }> }) {
  const world = useWorld();
  const { info, available, connector } = node.data.network;
  const { text, media, options } = info.capabilities;
  const accounts = world.data.accounts.filter((account) => account.provider === info.id);
  return (
    <>
      <p>{info.description}</p>
      <dl className="facts">
        <dt>Text</dt>
        <dd>
          up to {text.maxLength.toLocaleString()} characters{text.maxLengthWithMedia ? ` (${text.maxLengthWithMedia.toLocaleString()} with media)` : ''}
        </dd>
        <dt>Media</dt>
        <dd>
          {mediaSummary(info.id)}
          {media.altText ? ' · alt text' : ''}
        </dd>
        {options.length > 0 && (
          <>
            <dt>Per post</dt>
            <dd>{options.map((option) => option.label).join(', ')}</dd>
          </>
        )}
        <dt>Setup</dt>
        <dd>{info.setup.operator === 'none' ? 'None — works for everyone' : `Operator app (${info.setup.envPrefix}_CLIENT_ID / _SECRET)`}</dd>
      </dl>

      {accounts.length > 0 && (
        <section className="stack-sm">
          <h3>Connected</h3>
          {accounts.map((account) => (
            <Jump key={account.id} id={ids.account(account.id)}>
              {account.displayName ?? account.handle}
            </Jump>
          ))}
        </section>
      )}

      {world.data.canManage && available && (
        <section className="stack">
          <h3>Connect {accounts.length > 0 ? 'another' : 'an'} account</h3>
          {connector.kind === 'mastodon' && (
            <ConnectForm action={connectMastodon} submitLabel="Continue to Mastodon" fields={[{ name: 'instance', label: 'Server', placeholder: 'mastodon.social' }]} />
          )}
          {connector.kind === 'form' && <ConnectForm action={connectWithForm.bind(null, info.id)} submitLabel={`Connect ${info.name}`} fields={connector.fields} />}
          {connector.kind === 'oauth2' && (
            <form action={startOAuth.bind(null, info.id)}>
              <button type="submit">Continue to {info.name}</button>
            </form>
          )}
        </section>
      )}

      {!available && (
        <section className="stack-sm setup-box">
          <h3>One-time setup by the server admin</h3>
          <p className="muted">{info.setup.review}</p>
          <p>
            Set <code>{info.setup.envPrefix}_CLIENT_ID</code> and <code>{info.setup.envPrefix}_CLIENT_SECRET</code>, with the callback URL{' '}
            <code>/api/connect/{info.id}/callback</code>.
          </p>
        </section>
      )}
      <a href={info.setup.docsUrl} target="_blank" rel="noreferrer">
        Developer docs →
      </a>
    </>
  );
}

function AccountInspector({ node }: { node: Extract<WorldNode, { type: 'account' }> }) {
  const world = useWorld();
  const { account } = node.data;
  const usedIn = world.data.flows.filter((flow) => flow.graph.steps.some((step) => step.type === 'target' && step.accountId === account.id));
  const recent = world.data.posts.filter((post) => post.targets.some((target) => target.accountId === account.id));
  return (
    <>
      <p>
        {account.handle} on <Jump id={ids.network(account.provider)}>{catalog[account.provider].name}</Jump>
      </p>
      {account.status === 'needs_reauth' && (
        <p className="error">
          Access expired or was revoked. <Jump id={ids.network(account.provider)}>Reconnect it</Jump> — posts resume afterwards.
        </p>
      )}
      <section className="stack-sm">
        <h3>Used in flows</h3>
        {usedIn.length === 0 ? <span className="muted">Not used in any flow.</span> : usedIn.map((flow) => <Jump key={flow.id} id={ids.flow(flow.id)}>{flow.name}</Jump>)}
      </section>
      <section className="stack-sm">
        <h3>Recent posts</h3>
        {recent.length === 0 ? <span className="muted">None yet.</span> : <span>{recent.length} of the latest posts went here. <Jump id={ids.posts}>See posts</Jump></span>}
      </section>
      {world.data.canManage && (
        <form action={disconnectAccount}>
          <input type="hidden" name="accountId" value={account.id} />
          <button type="submit" className="secondary">Disconnect</button>
        </form>
      )}
    </>
  );
}

function FlowInspector({ node }: { node: Extract<WorldNode, { type: 'flow' }> }) {
  const world = useWorld();
  const plan = world.plans[node.data.flowId];
  const accounts = new Map(world.data.accounts.map((account) => [account.id, account]));
  return (
    <>
      <p className="muted">
        Connect steps from <strong>New post</strong> to accounts. Every path is one destination; steps along the way change what that account receives.
      </p>
      {plan && plan.errors.map((error) => <p key={error} className="error">{error}</p>)}
      {plan && plan.targets.length > 0 && (
        <section className="stack-sm">
          <h3>Preview for “Example post”</h3>
          {plan.targets.map((target) => {
            const account = accounts.get(target.accountId);
            return (
              <div key={target.accountId} className="preview">
                <strong>{account ? `${catalog[account.provider].name} · ${account.handle}` : 'Missing account'}</strong>
                {target.delayMinutes > 0 && <small className="muted"> after {target.delayMinutes} min</small>}
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
          if (confirm(`Delete the flow “${node.data.name}”? Posts already published keep their history.`)) world.deleteFlow(node.data.flowId);
        }}
      >
        Delete flow
      </button>
    </>
  );
}

function RegionInspector({ node }: { node: Extract<WorldNode, { type: 'region' }> }) {
  const world = useWorld();
  const region = node.data.region;
  return (
    <>
      <p>{regionInfo[region].subtitle}.</p>
      {region === 'networks' && (
        <p className="muted">
          {world.data.networks.filter((n) => n.available).length} of {world.data.networks.length} networks are ready on this server. Select one to see its limits and connect.
        </p>
      )}
      {region === 'flows' && <p className="muted">Use “+ New flow” in the toolbar, then add steps and drag connections between their dots.</p>}
      {region === 'plugins' && (
        <>
          <p className="muted">
            A theme sets colors, fonts, corner radii, the canvas grid and how connections are drawn — always for both light and dark mode. Switch between light, dark and your
            system setting at the top right.
          </p>
          <p className="muted">Everyone picks their own theme. Workspace owners and admins install and uninstall them; built-in themes can be installed again any time.</p>
          <a href={`#n=${ids.pluginInstall}`}>Open the theme editor →</a>
        </>
      )}
    </>
  );
}

const patternLabels = { dots: 'Dotted grid', lines: 'Lined grid', cross: 'Cross grid', none: 'No grid' };
const edgeLabels = { smoothstep: 'rounded connections', bezier: 'curved connections', step: 'right-angled connections', straight: 'straight connections' };

function download(theme: ThemeManifest) {
  const url = URL.createObjectURL(new Blob([`${JSON.stringify(theme, null, 2)}\n`], { type: 'application/json' }));
  Object.assign(document.createElement('a'), { href: url, download: `${theme.id}.theme.json` }).click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function PluginInspector({ node }: { node: Extract<WorldNode, { type: 'plugin' }> }) {
  const world = useWorld();
  const [pending, startTransition] = useTransition();
  const { manifest, builtin, installed } = node.data.plugin;
  const active = world.data.appearance.themeId === manifest.id;
  return (
    <>
      <p>{manifest.description}</p>
      <ThemePreview theme={manifest} large />
      <dl className="facts">
        <dt>Type</dt>
        <dd>Theme</dd>
        <dt>Version</dt>
        <dd>{manifest.version}</dd>
        <dt>Author</dt>
        <dd>{manifest.author}</dd>
        <dt>Source</dt>
        <dd>{builtin ? 'Built-in, updates with Postwerk' : 'Custom'}</dd>
        <dt>Canvas</dt>
        <dd>
          {patternLabels[manifest.canvas.pattern]}, {edgeLabels[manifest.canvas.edges]}
        </dd>
        <dt>Status</dt>
        <dd>{active ? 'You are using it' : installed ? 'Installed' : 'Not installed'}</dd>
      </dl>
      <div className="row">
        {installed && !active && (
          <button type="button" disabled={pending} onClick={() => startTransition(() => chooseThemeAction(manifest.id))}>
            Use this theme
          </button>
        )}
        {!installed && world.data.canManage && (
          <button type="button" disabled={pending} onClick={() => startTransition(() => installBuiltinPluginAction(manifest.id))}>
            Install
          </button>
        )}
        <button type="button" className="secondary" onClick={() => download(manifest)}>
          Download
        </button>
        {installed && world.data.canManage && (
          <button
            type="button"
            className="secondary"
            disabled={pending}
            onClick={() => {
              const again = builtin ? ' You can install it again any time.' : '';
              if (confirm(`Uninstall “${manifest.name}”? Everyone using it switches to the first installed theme.${again}`)) {
                startTransition(() => uninstallPluginAction(manifest.id));
              }
            }}
          >
            Uninstall
          </button>
        )}
      </div>
      {!builtin && <p className="muted">To change it, open the theme editor, start from “{manifest.name}” and install it again under the same id.</p>}
    </>
  );
}

function ThemeEditor() {
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
      return { error: `This is not valid JSON: ${(error as Error).message}` };
    }
    try {
      return { theme: parseThemeManifest(value && typeof value === 'object' && !Array.isArray(value) ? { ...value, css } : value) };
    } catch (error) {
      return { error: (error as Error).message };
    }
  }, [json, css]);
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
    load(JSON.stringify(plugin.builtin ? { ...theme, id: `${theme.id}-custom`, name: `My ${theme.name}`.slice(0, 40), author: world.data.user.name, version: '1.0.0' } : theme));
  }

  return (
    <>
      <p className="muted">
        A theme sets colors for light and dark mode, fonts, corner radii and the canvas grid, plus optional CSS. Pick a starting point, change what you like, then install it.
        Installing the same id again updates it.
      </p>
      {!world.data.canManage && <p className="muted">Only workspace owners and admins can install themes. You can still try one here and download it.</p>}
      <label>
        Start from
        <select value="" onChange={(e) => startFrom(e.target.value)}>
          <option value="">Choose a theme…</option>
          {themes.map((theme) => (
            <option key={theme.id} value={theme.id}>
              {theme.name}
            </option>
          ))}
        </select>
      </label>
      <label>
        Or open a theme file
        <input type="file" accept=".json,application/json" onChange={async (e) => load((await e.target.files?.[0]?.text()) ?? '')} />
      </label>
      <form action={formAction} className="stack">
        <label>
          Theme
          <textarea
            className="theme-source"
            rows={14}
            value={json}
            spellCheck={false}
            placeholder='{ "kind": "theme", "id": "my-theme", "name": "My theme", "light": { … }, "dark": { … } }'
            onChange={(e) => load(e.target.value)}
          />
        </label>
        <label>
          Extra CSS <small className="muted">optional · use var(--token) for anything that differs between light and dark</small>
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
              {pending ? 'Installing…' : existing ? 'Update and use' : 'Install and use'}
            </button>
          )}
          {parsed?.theme && (
            <button type="button" className="secondary" onClick={() => download(parsed.theme)}>
              Download
            </button>
          )}
        </div>
      </form>
    </>
  );
}

export function Inspector({ node, onClose }: { node: WorldNode | undefined; onClose(): void }) {
  if (!node || node.type === 'step' || node.type === 'composer' || node.type === 'posts') return null;
  const title =
    node.type === 'network'
      ? node.data.network.info.name
      : node.type === 'account'
        ? (node.data.account.displayName ?? node.data.account.handle)
        : node.type === 'flow'
          ? node.data.name
          : node.type === 'plugin'
            ? node.data.plugin.manifest.name
            : node.type === 'pluginInstall'
              ? 'Theme editor'
              : node.data.title;
  return (
    <aside className="inspector" aria-label={`${title} details`}>
      <header className="row-tight">
        <h2 className="grow">{title}</h2>
        <CopyLink id={node.id} />
        <button type="button" className="icon-button" aria-label="Close" onClick={onClose}>
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
      </div>
    </aside>
  );
}
