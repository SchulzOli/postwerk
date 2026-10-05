'use client';

import { useState } from 'react';
import { catalog } from '@postwerk/providers/catalog';
import { connectMastodon, connectWithForm, disconnectAccount, startOAuth } from '@/app/(app)/accounts/actions';
import { ConnectForm } from '@/components/connect-form';
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
      </div>
    </aside>
  );
}
