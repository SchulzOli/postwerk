import { TeamPanel } from '@/components/team';
import { getMessages } from '@/lib/i18n-server';
import { requireSession } from '@/lib/session';
import { loadTeam } from '@/lib/team';
import { commonMessages } from '@/messages/common';
import { teamMessages } from '@/messages/team';

export async function generateMetadata() {
  const [t, common] = await Promise.all([getMessages(teamMessages), getMessages(commonMessages)]);
  return { title: common.title(t.pageTitle) };
}

export default async function TeamPage() {
  const session = await requireSession();
  const t = await getMessages(teamMessages);
  return (
    <div className="stack-lg">
      <h1>{t.pageTitle}</h1>
      <div className="card">
        <TeamPanel data={await loadTeam(session)} />
      </div>
    </div>
  );
}
