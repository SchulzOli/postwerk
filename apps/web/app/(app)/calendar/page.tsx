import { Calendar } from '@/components/calendar';
import { loadCalendarAroundNow } from '@/lib/calendar-server';
import { requireSession } from '@/lib/session';

export const metadata = { title: 'Calendar · Postwerk' };

export default async function CalendarPage() {
  const { workspace } = await requireSession();
  const seed = await loadCalendarAroundNow(workspace.id);
  return (
    <div className="stack-lg">
      <h1>Calendar</h1>
      <div className="card">
        <Calendar seed={seed} />
      </div>
    </div>
  );
}
