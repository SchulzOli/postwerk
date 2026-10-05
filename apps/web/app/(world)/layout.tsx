import { requireSession } from '@/lib/session';

/** Full-screen layout for the canvas: no page chrome, the world fills the window. */
export default async function WorldLayout({ children }: { children: React.ReactNode }) {
  await requireSession();
  return <div className="world-root">{children}</div>;
}
