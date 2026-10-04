import Link from 'next/link';
import { logOut } from '../(auth)/actions';
import { requireSession } from '@/lib/session';

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const { user, workspace } = await requireSession();
  return (
    <>
      <header className="topbar">
        <Link href="/posts" className="brand">Postwerk</Link>
        <nav>
          <Link href="/posts">Posts</Link>
          <Link href="/accounts">Accounts</Link>
        </nav>
        <div className="who">
          <span className="muted">{workspace.name}</span>
          <form action={logOut}>
            <button type="submit" className="link" title={user.email}>Log out</button>
          </form>
        </div>
      </header>
      <main className="page">{children}</main>
    </>
  );
}
