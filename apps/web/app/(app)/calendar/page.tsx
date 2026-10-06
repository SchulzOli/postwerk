import { Calendar } from '@/components/calendar';
import { loadCalendarAroundNow } from '@/lib/calendar-server';
import { getMessages } from '@/lib/i18n-server';
import { requireSession } from '@/lib/session';
import { calendarMessages } from '@/messages/calendar';
import { commonMessages } from '@/messages/common';

export async function generateMetadata() {
  const [t, common] = await Promise.all([getMessages(calendarMessages), getMessages(commonMessages)]);
  return { title: common.title(t.pageTitle) };
}

export default async function CalendarPage() {
  const { workspace } = await requireSession();
  const [seed, t] = await Promise.all([loadCalendarAroundNow(workspace.id), getMessages(calendarMessages)]);
  return (
    <div className="stack-lg">
      <h1>{t.pageTitle}</h1>
      <div className="card">
        <Calendar seed={seed} />
      </div>
    </div>
  );
}
