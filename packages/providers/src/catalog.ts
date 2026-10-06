import type { Capabilities, ProviderId, ProviderInfo } from './types';

/**
 * Static description of every network: limits, media rules, per-post options
 * and what it takes to set up. Pure data (no network code), so the web UI can
 * import it in the browser for live validation.
 */

const MB = 1024 * 1024;

const noMedia: Capabilities['media'] = { maxImages: 0, maxVideos: 0, required: false, mixed: false, altText: false };

const privacyChoices = (choices: [string, string][]) => choices.map(([value, label]) => ({ value, label }));

export const catalog: Record<ProviderId, ProviderInfo> = {
  mastodon: {
    id: 'mastodon',
    name: 'Mastodon',
    description: 'Enter your server and approve access there. No developer setup needed.',
    connect: 'mastodon',
    capabilities: {
      text: { maxLength: 500, counter: 'mastodon', required: false },
      // Mastodon's defaults; a server can set other limits.
      media: { maxImages: 4, maxVideos: 1, required: false, mixed: false, altText: true, maxImageBytes: 16 * MB, maxVideoBytes: 99 * MB },
      options: [],
    },
    setup: { operator: 'none', docsUrl: 'https://docs.joinmastodon.org/methods/statuses/#create' },
  },

  bluesky: {
    id: 'bluesky',
    name: 'Bluesky',
    description: 'Sign in with your Bluesky account, or use an app password.',
    connect: 'atproto',
    capabilities: {
      text: { maxLength: 300, counter: 'graphemes', required: false },
      media: { maxImages: 4, maxVideos: 0, required: false, mixed: false, altText: true, maxImageBytes: 1_000_000 },
      options: [],
    },
    setup: { operator: 'none', docsUrl: 'https://docs.bsky.app/docs/advanced-guides/posts' },
  },

  facebook: {
    id: 'facebook',
    name: 'Facebook',
    description: 'Post to the Facebook Pages you manage.',
    connect: 'oauth2',
    capabilities: {
      text: { maxLength: 63_206, counter: 'utf16', required: false },
      media: { maxImages: 10, maxVideos: 1, required: false, mixed: false, altText: false },
      options: [],
    },
    setup: {
      operator: 'operator-app',
      envPrefix: 'FACEBOOK',
      review: 'Meta business verification and App Review for pages_show_list, pages_manage_posts, pages_read_engagement.',
      docsUrl: 'https://developers.facebook.com/docs/pages-api/posts',
    },
  },

  instagram: {
    id: 'instagram',
    name: 'Instagram',
    description: 'Post photos, carousels and reels to Instagram professional accounts.',
    connect: 'oauth2',
    capabilities: {
      text: { maxLength: 2_200, counter: 'utf16', required: false },
      media: { maxImages: 10, maxVideos: 10, required: true, mixed: true, altText: false, maxImageBytes: 8 * MB },
      options: [],
    },
    setup: {
      operator: 'operator-app',
      envPrefix: 'INSTAGRAM',
      review: 'Instagram API with Instagram Login: App Review for instagram_business_basic and instagram_business_content_publish; business verification for advanced access.',
      docsUrl: 'https://developers.facebook.com/docs/instagram-platform/content-publishing',
    },
  },

  threads: {
    id: 'threads',
    name: 'Threads',
    description: 'Post text, photos and videos to Threads.',
    connect: 'oauth2',
    capabilities: {
      text: { maxLength: 500, counter: 'graphemes', required: false },
      media: { maxImages: 10, maxVideos: 10, required: false, mixed: true, altText: true, maxImageBytes: 8 * MB, maxVideoBytes: 1024 * MB },
      options: [],
    },
    setup: {
      operator: 'operator-app',
      envPrefix: 'THREADS',
      review: 'App Review for threads_basic and threads_content_publish.',
      docsUrl: 'https://developers.facebook.com/docs/threads/posts',
    },
  },

  linkedin: {
    id: 'linkedin',
    name: 'LinkedIn',
    description: 'Post to your personal LinkedIn profile.',
    connect: 'oauth2',
    capabilities: {
      text: { maxLength: 3_000, counter: 'utf16', required: false },
      media: { maxImages: 20, maxVideos: 0, required: false, mixed: false, altText: true },
      options: [],
    },
    setup: {
      operator: 'operator-app',
      envPrefix: 'LINKEDIN',
      review: 'Self-serve: add the "Share on LinkedIn" and "Sign In with LinkedIn using OpenID Connect" products to the app.',
      docsUrl: 'https://learn.microsoft.com/linkedin/consumer/integrations/self-serve/share-on-linkedin',
    },
  },

  linkedin_page: {
    id: 'linkedin_page',
    name: 'LinkedIn Page',
    description: 'Post to LinkedIn company pages you administer.',
    connect: 'oauth2',
    capabilities: {
      text: { maxLength: 3_000, counter: 'utf16', required: false },
      media: { maxImages: 20, maxVideos: 0, required: false, mixed: false, altText: true },
      options: [],
    },
    setup: {
      operator: 'operator-app',
      envPrefix: 'LINKEDIN',
      review: 'Community Management API access (partner review; requires a registered legal entity).',
      docsUrl: 'https://learn.microsoft.com/linkedin/marketing/community-management/shares/posts-api',
    },
  },

  x: {
    id: 'x',
    name: 'X',
    description: 'Post to X (formerly Twitter).',
    connect: 'oauth2',
    capabilities: {
      text: { maxLength: 280, counter: 'x', required: false },
      media: { maxImages: 4, maxVideos: 0, required: false, mixed: false, altText: false, maxImageBytes: 5 * MB },
      options: [],
    },
    setup: {
      operator: 'operator-app',
      envPrefix: 'X',
      review: 'Paid API access (pay-per-use). OAuth 2.0 app with tweet.read, tweet.write, users.read, media.write, offline.access.',
      docsUrl: 'https://docs.x.com/x-api/posts/create-post',
    },
  },

  tiktok: {
    id: 'tiktok',
    name: 'TikTok',
    description: 'Post videos and photo carousels to TikTok.',
    connect: 'oauth2',
    capabilities: {
      text: { maxLength: 2_200, counter: 'utf16', required: false },
      media: { maxImages: 35, maxVideos: 1, required: true, mixed: false, altText: false },
      options: [
        {
          key: 'privacy',
          label: 'Who can view',
          required: true,
          choices: privacyChoices([
            ['PUBLIC_TO_EVERYONE', 'Everyone'],
            ['MUTUAL_FOLLOW_FRIENDS', 'Friends'],
            ['FOLLOWER_OF_CREATOR', 'Followers'],
            ['SELF_ONLY', 'Only me'],
          ]),
          hint: 'Until the app passes TikTok’s audit, only "Only me" works.',
        },
      ],
    },
    setup: {
      operator: 'operator-app',
      envPrefix: 'TIKTOK',
      review: 'Content Posting API with Direct Post; audit required before posts can be public. Media URLs must be on a verified domain.',
      docsUrl: 'https://developers.tiktok.com/doc/content-posting-api-get-started',
    },
  },

  youtube: {
    id: 'youtube',
    name: 'YouTube',
    description: 'Upload videos and Shorts to your YouTube channel.',
    connect: 'oauth2',
    capabilities: {
      text: { maxLength: 5_000, counter: 'utf16', required: false },
      media: { maxImages: 0, maxVideos: 1, required: true, mixed: false, altText: false },
      options: [
        { key: 'title', label: 'Video title', required: true, maxLength: 100 },
        {
          key: 'privacy',
          label: 'Visibility',
          required: true,
          defaultValue: 'public',
          choices: privacyChoices([
            ['public', 'Public'],
            ['unlisted', 'Unlisted'],
            ['private', 'Private'],
          ]),
        },
      ],
    },
    setup: {
      operator: 'operator-app',
      envPrefix: 'GOOGLE',
      review: 'Google OAuth verification for the youtube.upload scope and a quota extension; uploads from unverified projects stay private.',
      docsUrl: 'https://developers.google.com/youtube/v3/guides/uploading_a_video',
    },
  },

  pinterest: {
    id: 'pinterest',
    name: 'Pinterest',
    description: 'Create Pins on your boards. Each board is connected as its own account.',
    connect: 'oauth2',
    capabilities: {
      text: { maxLength: 500, counter: 'utf16', required: false },
      media: { maxImages: 1, maxVideos: 0, required: true, mixed: false, altText: true },
      options: [
        { key: 'title', label: 'Pin title', required: false, maxLength: 100 },
        { key: 'link', label: 'Destination link', required: false, hint: 'Where the Pin leads when clicked.' },
      ],
    },
    setup: {
      operator: 'operator-app',
      envPrefix: 'PINTEREST',
      review: 'Trial access is granted on app creation; Standard access needs a review.',
      docsUrl: 'https://developers.pinterest.com/docs/api/v5/pins-create',
    },
  },

  reddit: {
    id: 'reddit',
    name: 'Reddit',
    description: 'Submit text posts to subreddits.',
    connect: 'oauth2',
    capabilities: {
      text: { maxLength: 40_000, counter: 'utf16', required: false },
      media: noMedia,
      options: [
        { key: 'subreddit', label: 'Subreddit', required: true, hint: 'Without r/, e.g. "physiotherapy".' },
        { key: 'title', label: 'Title', required: true, maxLength: 300 },
      ],
    },
    setup: {
      operator: 'operator-app',
      envPrefix: 'REDDIT',
      review: 'Manual API approval under Reddit’s Responsible Builder Policy (self-service ended November 2025).',
      docsUrl: 'https://www.reddit.com/dev/api/#POST_api_submit',
    },
  },

  google_business: {
    id: 'google_business',
    name: 'Google Business Profile',
    description: 'Publish updates to your business on Google Search and Maps.',
    connect: 'oauth2',
    capabilities: {
      text: { maxLength: 1_500, counter: 'utf16', required: true },
      media: { maxImages: 1, maxVideos: 0, required: false, mixed: false, altText: false, maxImageBytes: 5 * MB },
      options: [],
    },
    setup: {
      operator: 'operator-app',
      envPrefix: 'GOOGLE',
      review: 'Business Profile API access request form (approval takes days to weeks).',
      docsUrl: 'https://developers.google.com/my-business/content/posts-data',
    },
  },

  telegram: {
    id: 'telegram',
    name: 'Telegram',
    description: 'Post to a channel or group through your own bot.',
    connect: 'form',
    capabilities: {
      text: { maxLength: 4_096, counter: 'utf16', required: false, maxLengthWithMedia: 1_024 },
      // Telegram's limits for files it fetches by URL.
      media: { maxImages: 10, maxVideos: 10, required: false, mixed: true, altText: false, maxImageBytes: 5 * MB, maxVideoBytes: 20 * MB },
      options: [],
    },
    setup: { operator: 'none', docsUrl: 'https://core.telegram.org/bots/api#sendmessage' },
  },

  discord: {
    id: 'discord',
    name: 'Discord',
    description: 'Post to a Discord channel through a webhook.',
    connect: 'form',
    capabilities: {
      text: { maxLength: 2_000, counter: 'utf16', required: false },
      media: { maxImages: 10, maxVideos: 10, required: false, mixed: true, altText: false },
      options: [],
    },
    setup: { operator: 'none', docsUrl: 'https://discord.com/developers/docs/resources/webhook#execute-webhook' },
  },

  sandbox: {
    id: 'sandbox',
    name: 'Sandbox',
    description: 'A fake network for trying things out. Add #fail or #flaky to a post to simulate errors.',
    connect: 'form',
    capabilities: {
      text: { maxLength: 10_000, counter: 'graphemes', required: false },
      media: { maxImages: 10, maxVideos: 10, required: false, mixed: true, altText: true },
      options: [],
    },
    setup: { operator: 'none', docsUrl: 'https://github.com/SchulzOli/postwerk' },
  },
};

export const providerInfos: ProviderInfo[] = Object.values(catalog);

export function getProviderInfo(id: ProviderId): ProviderInfo {
  return catalog[id];
}

export type { OptionField, ProviderId, ProviderInfo } from './types';
export type { FormField } from './types';
