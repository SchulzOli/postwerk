import type { PostStatus } from '@postwerk/db/types';

/** Not picked up by the worker yet, so it can still change (core's EDITABLE_STATUSES). */
export const canEdit = (status: PostStatus) => status === 'draft' || status === 'scheduled' || status === 'failed';
/** Can move to another time. */
export const canMove = (status: PostStatus) => status === 'draft' || status === 'scheduled';
export const canRetry = (status: PostStatus) => status === 'failed' || status === 'partial';
export const canPostAgain = (status: PostStatus) => status === 'published' || status === 'partial';
