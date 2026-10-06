import type { PostStatus, TargetStatus } from '@postwerk/db/types';
import type { ProviderId } from '@postwerk/providers/catalog';

/** A post as the calendar shows it. */
export interface CalendarPost {
  id: string;
  text: string;
  status: PostStatus;
  scheduledAt: string;
  /** The first attachment, for a thumbnail. */
  thumb: { url: string; kind: 'image' | 'video' } | null;
  targets: { accountId: string; provider: ProviderId; handle: string; status: TargetStatus }[];
}

/** Posts scheduled within [from, to). */
export interface CalendarData {
  from: string;
  to: string;
  posts: CalendarPost[];
  /** There were more posts than the calendar loads at once. */
  truncated: boolean;
}
