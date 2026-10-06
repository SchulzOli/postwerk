import Link from 'next/link';
import { needsEmailVerification } from '@postwerk/core';
import { AccountMenu } from '@/components/account-menu';
import { ModeSwitch } from '@/components/mode-switch';
import { VerifyBanner } from '@/components/verify-banner';
import { WorkspaceMenu } from '@/components/workspace-menu';
import { getAppearance } from '@/lib/appearance';
import { requireSession } from '@/lib/session';

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const { user, workspace, workspaces, role } = await requireSession();
  const { mode } = await getAppearance();
  return (
    <>
      <header className="topbar">
        <Link href="/canvas" className="brand">Postwerk</Link>
        <nav>
          <Link href="/canvas">Canvas</Link>
          <Link href="/posts">Posts</Link>
          <Link href="/accounts">Accounts</Link>
          <Link href="/team">Team</Link>
          {role !== 'editor' && <Link href="/activity">Activity</Link>}
        </nav>
        <div className="who">
          <WorkspaceMenu current={workspace} workspaces={workspaces} teamHref="/team" />
          <ModeSwitch mode={mode} />
          <AccountMenu user={{ name: user.name, email: user.email }} links={[{ href: '/canvas', label: 'Canvas' }]} />
        </div>
      </header>
      {needsEmailVerification(user) && <VerifyBanner email={user.email} className="page-banner" />}
      <main className="page">{children}</main>
    </>
  );
}
