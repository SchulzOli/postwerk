import { TeamPanel } from '@/components/team';
import { requireSession } from '@/lib/session';
import { loadTeam } from '@/lib/team';

export const metadata = { title: 'Team · Postwerk' };

export default async function TeamPage() {
  const session = await requireSession();
  return (
    <div className="stack-lg">
      <h1>Team</h1>
      <div className="card">
        <TeamPanel data={await loadTeam(session)} />
      </div>
    </div>
  );
}
