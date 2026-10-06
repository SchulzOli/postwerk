'use client';

import { useActionState, useEffect, useRef, useTransition } from 'react';
import { createWorkspaceAction, switchWorkspaceAction } from '@/app/(app)/team/actions';
import { useMessages } from '@/lib/i18n';
import { teamMessages } from '@/messages/team';

interface Props {
  current: { id: string; name: string };
  workspaces: { id: string; name: string }[];
  /** Where "Team" points: the canvas region or the list page. */
  teamHref: string;
}

/** The current workspace's name; opens a menu to switch, create or manage workspaces. */
export function WorkspaceMenu({ current, workspaces, teamHref }: Props) {
  const [pending, startTransition] = useTransition();
  const [state, create, creating] = useActionState(createWorkspaceAction, {});
  const t = useMessages(teamMessages).menu;
  const others = workspaces.filter((workspace) => workspace.id !== current.id);
  const menu = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    // <details> stays open on its own; close it like a menu.
    const close = (event: Event) => {
      if (menu.current?.open && (event instanceof KeyboardEvent ? event.key === 'Escape' : !menu.current.contains(event.target as Node))) menu.current.open = false;
    };
    document.addEventListener('pointerdown', close);
    document.addEventListener('keydown', close);
    return () => {
      document.removeEventListener('pointerdown', close);
      document.removeEventListener('keydown', close);
    };
  }, []);
  return (
    <details className="menu workspace-menu" ref={menu}>
      <summary title={t.switchWorkspace}>
        <span className="clip">{current.name}</span> <span aria-hidden>▾</span>
      </summary>
      <div className="menu-body">
        {others.length > 0 && (
          <div className="stack-sm">
            <small className="muted">{t.switchTo}</small>
            {others.map((workspace) => (
              <button key={workspace.id} type="button" className="menu-item" disabled={pending} onClick={() => startTransition(() => switchWorkspaceAction(workspace.id))}>
                {workspace.name}
              </button>
            ))}
          </div>
        )}
        <a className="menu-item" href={teamHref}>{t.teamAndInvites}</a>
        <form action={create} className="stack-sm">
          <small className="muted">{t.newWorkspace}</small>
          <div className="row-tight">
            <input name="name" placeholder={t.name} aria-label={t.newWorkspaceName} maxLength={80} required />
            <button type="submit" className="small" disabled={creating}>{t.create}</button>
          </div>
          {state.error && <small className="error">{state.error}</small>}
        </form>
      </div>
    </details>
  );
}
