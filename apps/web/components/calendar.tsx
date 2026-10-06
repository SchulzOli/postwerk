'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useRef, useState, type CSSProperties, type DragEvent, type FormEvent, type MouseEvent } from 'react';
import {
  atMinutes,
  dayKey,
  firstDayOfWeek,
  layoutDay,
  minutesOfDay,
  moveToDay,
  shiftAnchor,
  snapMinutes,
  startOfDay,
  visibleDays,
  visibleRange,
  type CalendarView,
} from '@postwerk/core/calendar';
import { catalog } from '@postwerk/providers/catalog';
import { loadCalendarAction, reschedulePostAction } from '@/app/(app)/posts/actions';
import type { CalendarData, CalendarPost } from '@/lib/calendar';
import { useLocale, useMessages } from '@/lib/i18n';
import { intlLocale } from '@/lib/locale';
import { canEdit, canMove, canPostAgain } from '@/lib/post-status';
import { calendarMessages } from '@/messages/calendar';
import { commonMessages } from '@/messages/common';

/** Week view: pixels per hour, and how long a post looks (for side-by-side overlaps). */
const HOUR_HEIGHT = 44;
const POST_MINUTES = 60;
/** Month view: posts per day before "+ n more". */
const MONTH_POSTS = 3;
const DRAG_TYPE = 'application/x-postwerk-post';
const VIEW_KEY = 'postwerk.calendar.view';

interface Props {
  /** Posts the server already loaded around today, so the first views need no request. */
  seed: CalendarData;
  /** Opens a post to edit it, or (asCopy) to post it again. Defaults to the post pages. */
  onEdit?(postId: string, asCopy: boolean): void;
  /** Plans a new post at a time. Defaults to the new-post page. */
  onCreate?(iso: string): void;
}

type Message = { kind: 'error' | 'success'; text: string };

const timeFormat = (locale: string) => new Intl.DateTimeFormat(locale, { hour: 'numeric', minute: '2-digit' });
const whenFormat = (locale: string) => new Intl.DateTimeFormat(locale, { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });

/** "2026-10-06T14:30" for a datetime-local input. */
const toLocalInput = (date: Date) => new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);

function readView(): CalendarView {
  try {
    return localStorage.getItem(VIEW_KEY) === 'month' ? 'month' : 'week';
  } catch {
    return 'week';
  }
}

export function Calendar({ seed, onEdit, onCreate }: Props) {
  const router = useRouter();
  const locale = useLocale();
  const t = useMessages(calendarMessages);
  const common = useMessages(commonMessages);
  const edit = onEdit ?? ((postId: string, asCopy: boolean) => router.push(asCopy ? `/posts/new?from=${postId}` : `/posts/${postId}/edit`));
  const create = onCreate ?? ((iso: string) => router.push(`/posts/new?at=${encodeURIComponent(iso)}`));

  // Dates depend on the browser's time zone, so nothing is laid out until after hydration.
  const [now, setNow] = useState<Date>();
  const [anchor, setAnchor] = useState<Date>();
  const [firstDay, setFirstDay] = useState(1);
  const [view, setView] = useState<CalendarView>('week');
  const [posts, setPosts] = useState(seed.posts);
  const [truncated, setTruncated] = useState(seed.truncated);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<Message>();
  const [selectedId, setSelectedId] = useState<string>();
  const [drop, setDrop] = useState<{ day: string; minutes?: number }>();
  const dragging = useRef<{ post: CalendarPost; grabMinutes: number }>(undefined);
  const scroller = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const today = new Date();
    setNow(today);
    setAnchor(today);
    setFirstDay(firstDayOfWeek());
    setView(readView());
    const timer = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(timer);
  }, []);

  const range = useMemo(() => (anchor ? visibleRange(view, anchor, firstDay) : undefined), [view, anchor, firstDay]);
  const days = useMemo(() => (anchor ? visibleDays(view, anchor, firstDay) : []), [view, anchor, firstDay]);

  // Fresh server data (after any change) replaces what is shown; other ranges are fetched.
  useEffect(() => {
    if (!range) return;
    if (!seed.truncated && new Date(seed.from) <= range.from && range.to <= new Date(seed.to)) {
      setPosts(seed.posts);
      setTruncated(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    loadCalendarAction(range.from.toISOString(), range.to.toISOString())
      .then((result) => {
        if (cancelled) return;
        if ('error' in result) return setMessage({ kind: 'error', text: result.error });
        setPosts(result.posts);
        setTruncated(result.truncated);
      })
      .catch(() => !cancelled && setMessage({ kind: 'error', text: t.loadFailed }))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [range, seed]);

  // Start the week view at the working day, not at midnight.
  useEffect(() => {
    if (view === 'week' && scroller.current) scroller.current.scrollTop = 7.5 * HOUR_HEIGHT;
  }, [view, anchor === undefined]); // eslint-disable-line react-hooks/exhaustive-deps

  const byDay = useMemo(() => {
    const map = new Map<string, CalendarPost[]>();
    for (const post of posts) {
      const key = dayKey(new Date(post.scheduledAt));
      map.set(key, [...(map.get(key) ?? []), post]);
    }
    for (const list of map.values()) list.sort((a, b) => a.scheduledAt.localeCompare(b.scheduledAt));
    return map;
  }, [posts]);

  if (!anchor || !now || !range) return <div className="calendar cal-placeholder muted">{t.loadingCalendar}</div>;

  const today = dayKey(now);
  const startOfToday = startOfDay(now);
  const selected = posts.find((post) => post.id === selectedId);
  const intl = intlLocale(locale);
  const time = timeFormat(intl);

  function chooseView(next: CalendarView) {
    setView(next);
    try {
      localStorage.setItem(VIEW_KEY, next);
    } catch {
      // Only a convenience.
    }
  }

  async function move(post: CalendarPost, at: Date) {
    const previous = post.scheduledAt;
    if (at.getTime() === new Date(previous).getTime()) return;
    if (at.getTime() < Date.now()) return setMessage({ kind: 'error', text: t.pickFuture });
    const iso = at.toISOString();
    setPosts((current) => current.map((p) => (p.id === post.id ? { ...p, scheduledAt: iso } : p)));
    setMessage(undefined);
    const result = await reschedulePostAction(post.id, iso).catch(() => ({ error: t.moveFailed }));
    if (result.error) {
      setPosts((current) => current.map((p) => (p.id === post.id && p.scheduledAt === iso ? { ...p, scheduledAt: previous } : p)));
      setMessage({ kind: 'error', text: result.error });
    } else {
      setMessage({ kind: 'success', text: t.movedTo(whenFormat(intl).format(at)) });
    }
  }

  /** A sensible time to plan a new post on a day: the next full hour today, 9:00 later on. */
  function createOn(day: Date) {
    if (dayKey(day) !== today) return create(atMinutes(day, 9 * 60).toISOString());
    const next = new Date(now!);
    next.setHours(next.getHours() + 1, 0, 0, 0);
    create(next.toISOString());
  }

  // ------------------------------------------------------------- dragging
  function startDrag(event: DragEvent<HTMLElement>, post: CalendarPost) {
    event.dataTransfer.setData(DRAG_TYPE, post.id);
    event.dataTransfer.effectAllowed = 'move';
    // Where the post was grabbed, so it lands where it is shown, not where the pointer is.
    const column = event.currentTarget.closest('.cal-day-col');
    const grabMinutes = column ? ((event.clientY - event.currentTarget.getBoundingClientRect().top) / column.getBoundingClientRect().height) * 1440 : 0;
    dragging.current = { post, grabMinutes };
    setSelectedId(post.id);
  }

  function endDrag() {
    dragging.current = undefined;
    setDrop(undefined);
  }

  /** The time under the pointer in a week column, snapped to 15 minutes. */
  function minutesAt(event: DragEvent<HTMLElement> | MouseEvent<HTMLElement>, grab = 0, step = 15) {
    const rect = event.currentTarget.getBoundingClientRect();
    return snapMinutes(((event.clientY - rect.top) / rect.height) * 1440 - grab, step);
  }

  function dropTarget(day: Date) {
    const key = dayKey(day);
    const past = day < startOfToday;
    return {
      onDragOver(event: DragEvent<HTMLElement>) {
        if (!dragging.current || past || !event.dataTransfer.types.includes(DRAG_TYPE)) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = 'move';
        const minutes = view === 'week' ? minutesAt(event, dragging.current.grabMinutes) : undefined;
        if (drop?.day !== key || drop.minutes !== minutes) setDrop({ day: key, minutes });
      },
      onDragLeave(event: DragEvent<HTMLElement>) {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDrop((current) => (current?.day === key ? undefined : current));
      },
      onDrop(event: DragEvent<HTMLElement>) {
        const current = dragging.current;
        if (!current) return;
        event.preventDefault();
        const at = view === 'week' ? atMinutes(day, minutesAt(event, current.grabMinutes)) : moveToDay(new Date(current.post.scheduledAt), day);
        endDrag();
        void move(current.post, at);
      },
    };
  }

  // ------------------------------------------------------------- pieces
  const postItem = (post: CalendarPost, style?: CSSProperties) => {
    const movable = canMove(post.status) && new Date(post.scheduledAt) > now;
    const networks = post.targets.map((target) => catalog[target.provider]?.name ?? target.provider);
    return (
      <div
        key={post.id}
        role="button"
        tabIndex={0}
        aria-pressed={post.id === selectedId}
        draggable={movable}
        className={`cal-post cal-${post.status} ${movable ? 'is-movable' : ''} ${post.id === selectedId ? 'is-selected' : ''}`}
        style={style}
        title={`${common.status[post.status]} · ${[...new Set(networks)].join(', ')}${movable ? `\n${t.dragToMove}` : ''}`}
        onClick={(event) => {
          event.stopPropagation();
          setSelectedId(post.id === selectedId ? undefined : post.id);
        }}
        onDoubleClick={(event) => {
          event.stopPropagation();
          if (canEdit(post.status)) edit(post.id, false);
        }}
        onKeyDown={(event) => {
          if (event.key !== 'Enter' && event.key !== ' ') return;
          event.preventDefault();
          setSelectedId(post.id);
        }}
        onDragStart={(event) => startDrag(event, post)}
        onDragEnd={endDrag}
      >
        <time dateTime={post.scheduledAt}>{time.format(new Date(post.scheduledAt))}</time>
        <span className="cal-post-text">{post.text.trim() || common.mediaOnly}</span>
      </div>
    );
  };

  const title =
    view === 'week'
      ? new Intl.DateTimeFormat(intl, { month: 'short', day: 'numeric', year: 'numeric' }).formatRange(days[0]!, days[6]!)
      : new Intl.DateTimeFormat(intl, { month: 'long', year: 'numeric' }).format(anchor);
  const weekday = new Intl.DateTimeFormat(intl, { weekday: 'short' });
  const hour = new Intl.DateTimeFormat(intl, { hour: 'numeric' });
  const dayLabel = new Intl.DateTimeFormat(intl, { weekday: 'long', month: 'long', day: 'numeric' });

  return (
    <div className="calendar">
      <div className="cal-toolbar">
        <div className="row-tight">
          <button type="button" className="secondary small" aria-label={t.previous(view === 'week')} onClick={() => setAnchor(shiftAnchor(view, anchor, -1))}>
            ‹
          </button>
          <button type="button" className="secondary small" onClick={() => setAnchor(new Date())}>
            {t.today}
          </button>
          <button type="button" className="secondary small" aria-label={t.next(view === 'week')} onClick={() => setAnchor(shiftAnchor(view, anchor, 1))}>
            ›
          </button>
        </div>
        <h3 className="cal-title" aria-live="polite">
          {title}
          {loading && <small className="muted">{t.loading}</small>}
        </h3>
        <div className="segmented" role="radiogroup" aria-label={t.view}>
          {(['week', 'month'] as const).map((option) => (
            <button key={option} type="button" role="radio" aria-checked={view === option} onClick={() => chooseView(option)}>
              {option === 'week' ? t.week : t.month}
            </button>
          ))}
        </div>
        <button type="button" className="small" onClick={() => createOn(anchor < startOfToday ? now : anchor)}>
          {t.newPost}
        </button>
      </div>

      {message && (
        <p className={`cal-message ${message.kind}`} role={message.kind === 'error' ? 'alert' : 'status'}>
          {message.text}
          <button type="button" className="icon-button" aria-label={common.dismiss} onClick={() => setMessage(undefined)}>
            ×
          </button>
        </p>
      )}

      {view === 'week' ? (
        <div className="cal-week" style={{ '--hour': `${HOUR_HEIGHT}px` } as CSSProperties}>
          <div className="cal-week-head">
            <span />
            {days.map((day) => (
              <div key={dayKey(day)} className={`cal-day-head ${dayKey(day) === today ? 'is-today' : ''}`}>
                <small>{weekday.format(day)}</small>
                <strong>{day.getDate()}</strong>
              </div>
            ))}
          </div>
          <div className="cal-week-body" ref={scroller}>
            <div className="cal-hours" aria-hidden>
              {Array.from({ length: 23 }, (_, index) => (
                <span key={index} style={{ top: (index + 1) * HOUR_HEIGHT }}>
                  {hour.format(atMinutes(anchor, (index + 1) * 60))}
                </span>
              ))}
            </div>
            {days.map((day) => {
              const key = dayKey(day);
              const list = byDay.get(key) ?? [];
              const past = day < startOfToday;
              return (
                <div
                  key={key}
                  className={`cal-day-col ${past ? 'is-past' : ''} ${drop?.day === key ? 'is-drop' : ''}`}
                  role="group"
                  aria-label={dayLabel.format(day)}
                  onDoubleClick={(event) => {
                    const at = atMinutes(day, minutesAt(event, 0, 30));
                    if (at > now) create(at.toISOString());
                  }}
                  {...dropTarget(day)}
                >
                  {key === today && <span className="cal-now" style={{ top: `${(minutesOfDay(now) / 1440) * 100}%` }} aria-hidden />}
                  {drop?.day === key && drop.minutes !== undefined && (
                    <span className="cal-ghost" style={{ top: `${(Math.min(drop.minutes, 1440 - POST_MINUTES) / 1440) * 100}%`, height: `${(POST_MINUTES / 1440) * 100}%` }}>
                      {time.format(atMinutes(day, drop.minutes))}
                    </span>
                  )}
                  {layoutDay(list, (post) => minutesOfDay(new Date(post.scheduledAt)), POST_MINUTES).map(({ item, lane, lanes }) =>
                    postItem(item, {
                      // Late posts stay inside the day.
                      top: `${(Math.min(minutesOfDay(new Date(item.scheduledAt)), 1440 - POST_MINUTES) / 1440) * 100}%`,
                      height: `calc(${(POST_MINUTES / 1440) * 100}% - 2px)`,
                      left: `calc(${(lane / lanes) * 100}% + 2px)`,
                      width: `calc(${100 / lanes}% - 4px)`,
                    }),
                  )}
                </div>
              );
            })}
          </div>
        </div>
      ) : (
        <div className="cal-month">
          <div className="cal-month-head">
            {days.slice(0, 7).map((day) => (
              <small key={day.getDay()}>{weekday.format(day)}</small>
            ))}
          </div>
          <div className="cal-month-grid">
            {days.map((day) => {
              const key = dayKey(day);
              const list = byDay.get(key) ?? [];
              const past = day < startOfToday;
              const outside = day.getMonth() !== anchor.getMonth();
              return (
                <div
                  key={key}
                  className={`cal-cell ${outside ? 'is-outside' : ''} ${past ? 'is-past' : ''} ${key === today ? 'is-today' : ''} ${drop?.day === key ? 'is-drop' : ''}`}
                  role="group"
                  aria-label={dayLabel.format(day)}
                  onDoubleClick={() => !past && createOn(day)}
                  {...dropTarget(day)}
                >
                  <div className="cal-cell-head">
                    <span className="cal-date">{day.getDate()}</span>
                    {!past && (
                      <button type="button" className="icon-button cal-add" aria-label={t.newPostOn(dayLabel.format(day))} onClick={() => createOn(day)}>
                        +
                      </button>
                    )}
                  </div>
                  {list.slice(0, MONTH_POSTS).map((post) => postItem(post))}
                  {list.length > MONTH_POSTS && (
                    <button
                      type="button"
                      className="link small-link cal-more"
                      onClick={() => {
                        chooseView('week');
                        setAnchor(day);
                      }}
                    >
                      {t.more(list.length - MONTH_POSTS)}
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      <p className="muted cal-hint">
        {truncated ? t.hintTruncated : view === 'week' ? t.hintWeek : t.hintMonth}
      </p>

      {selected && (
        <PostDetails
          key={selected.id}
          post={selected}
          movable={canMove(selected.status) && new Date(selected.scheduledAt) > now}
          onClose={() => setSelectedId(undefined)}
          onEdit={edit}
          onMove={(at) => move(selected, at)}
        />
      )}
    </div>
  );
}

function PostDetails({ post, movable, onClose, onEdit, onMove }: { post: CalendarPost; movable: boolean; onClose(): void; onEdit(id: string, asCopy: boolean): void; onMove(at: Date): void }) {
  const locale = useLocale();
  const t = useMessages(calendarMessages);
  const common = useMessages(commonMessages);
  const [moveTo, setMoveTo] = useState(() => toLocalInput(new Date(post.scheduledAt)));
  function submit(event: FormEvent) {
    event.preventDefault();
    if (moveTo) onMove(new Date(moveTo));
  }
  return (
    <section className="cal-detail" aria-label={t.selectedPost}>
      <div className="row-tight">
        <span className={`badge status-${post.status}`}>{common.status[post.status]}</span>
        <strong className="grow">
          <time dateTime={post.scheduledAt}>{whenFormat(intlLocale(locale)).format(new Date(post.scheduledAt))}</time>
        </strong>
        <button type="button" className="icon-button" aria-label={common.close} onClick={onClose}>
          ×
        </button>
      </div>
      <div className="cal-detail-body">
        {post.thumb &&
          (post.thumb.kind === 'video' ? <video src={post.thumb.url} muted preload="metadata" className="cal-thumb" /> : <img src={post.thumb.url} alt="" className="cal-thumb" />)}
        <p className="clip-2 grow">{post.text.trim() || common.mediaOnly}</p>
      </div>
      <div className="chips">
        {post.targets.map((target) => (
          <span key={target.accountId} className={`chip chip-${target.status}`}>
            {catalog[target.provider]?.name ?? target.provider} · {target.handle}
          </span>
        ))}
      </div>
      <div className="row-tight cal-detail-actions">
        {canEdit(post.status) && (
          <button type="button" className="secondary small" onClick={() => onEdit(post.id, false)}>
            {common.edit}
          </button>
        )}
        {canPostAgain(post.status) && (
          <button type="button" className="secondary small" onClick={() => onEdit(post.id, true)}>
            {t.postAgain}
          </button>
        )}
        {movable && (
          <form className="row-tight" onSubmit={submit}>
            <label className="row-tight">
              <span className="muted">{t.moveTo}</span>
              <input type="datetime-local" value={moveTo} onChange={(event) => setMoveTo(event.target.value)} required />
            </label>
            <button type="submit" className="small">
              {t.move}
            </button>
          </form>
        )}
      </div>
    </section>
  );
}
