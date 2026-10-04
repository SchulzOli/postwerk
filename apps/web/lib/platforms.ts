import type { ProviderId } from '@postwerk/providers';

export const providerLabels: Record<ProviderId, string> = {
  mastodon: 'Mastodon',
  bluesky: 'Bluesky',
  sandbox: 'Sandbox',
};

/** Networks on the roadmap (see docs/PLAN.md), shown so users know what is coming. */
export const upcoming = ['Instagram', 'LinkedIn', 'Reddit', 'Threads', 'Facebook', 'TikTok', 'X', 'YouTube', 'Pinterest'];
