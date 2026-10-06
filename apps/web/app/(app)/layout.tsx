import Link from 'next/link';
import { needsEmailVerification } from '@postwerk/core';
import { AccountMenu } from '@/components/account-menu';
import { ModeSwitch } from '@/components/mode-switch';
import { VerifyBanner } from '@/components/verify-banner';
import { WorkspaceMenu } from '@/components/workspace-menu';
import { getAppearance } from '@/lib/appearance';
import { getMessages } from '@/lib/i18n-server';
import { legalLinks } from '@/lib/legal';
import { requireSession } from '@/lib/session';
import { commonMessages } from '@/messages/common';

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const { user, workspace, workspaces, role } = await requireSession();
  const [{ mode }, t] = await Promise.all([getAppearance(), getMessages(commonMessages)]);
  return (
    <>
      <header className="topbar">
        <Link href="/canvas" className="brand">Postwerk</Link>
        <nav>
          <Link href="/canvas">{t.nav.canvas}</Link>
          <Link href="/posts">{t.nav.posts}</Link>
          <Link href="/calendar">{t.nav.calendar}</Link>
          <Link href="/accounts">{t.nav.accounts}</Link>
          <Link href="/team">{t.nav.team}</Link>
          {role !== 'editor' && <Link href="/activity">{t.nav.activity}</Link>}
        </nav>
        <div className="who">
          <WorkspaceMenu current={workspace} workspaces={workspaces} teamHref="/team" />
          <ModeSwitch mode={mode} />
          <AccountMenu user={{ name: user.name, email: user.email }} links={[{ href: '/canvas', label: t.nav.canvas }]} legal={legalLinks()} />
        </div>
      </header>
      {needsEmailVerification(user) && <VerifyBanner email={user.email} className="page-banner" />}
      <main className="page">{children}</main>
    </>
  );
}
