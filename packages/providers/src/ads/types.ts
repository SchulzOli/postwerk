/**
 * Ad platforms: where paid ads run. Unlike networks, MarketingAsAService does
 * not post to them; it builds a campaign there from an approved ad piece
 * (always paused first), starts and pauses it, and reads back what it cost
 * and brought.
 */

export type AdPlatformId = 'google_ads' | 'meta_ads';
export const AD_PLATFORMS: AdPlatformId[] = ['google_ads', 'meta_ads'];

/** An ad account people can pick (a Google Ads customer, a Meta ad account). */
export interface AdAccountInfo {
  /** The platform's id (Google: customer id without dashes; Meta: the number after "act_"). */
  id: string;
  name: string;
  /** ISO 4217, the currency the account is billed in. */
  currency: string;
  timeZone?: string;
  /** A Google Ads test account (serves no ads). */
  test?: boolean;
  /** Meta: Facebook Pages the person may advertise for. */
  pages?: { id: string; name: string }[];
}

/** Everything a platform needs to build one campaign with one ad. */
export interface AdLaunchSpec {
  /** Name of the campaign on the platform. */
  name: string;
  format: 'search' | 'social' | 'video';
  goal: 'awareness' | 'traffic' | 'leads' | 'sales' | 'event';
  /** The most the campaign may spend in total, in minor units of the account currency (cents). */
  budgetMinor: number;
  /** "YYYY-MM-DD", inclusive. */
  startsOn: string;
  endsOn: string;
  /** ISO 3166 codes of the countries to show the ad in. */
  countries: string[];
  /** Google: the language of the people to reach ("de", "en"). */
  language: string;
  finalUrl: string;
  headlines: string[];
  descriptions: string[];
  /** Video ads: long headlines. */
  longHeadlines?: string[];
  /** Search ads: display path and keywords. */
  path1?: string;
  path2?: string;
  keywords?: string[];
  /** Video ads: the advertiser's name. */
  businessName?: string;
  /** Meta: call-to-action button (LEARN_MORE, BOOK_NOW…). */
  callToAction?: string;
  /** Social ads: the picture. Video ads: the square logo. */
  image?: { bytes: Uint8Array; name: string };
  youtubeVideoId?: string;
  /** Meta: the Facebook Page the ad runs as. */
  pageId?: string;
}

export interface LaunchedCampaign {
  campaignId: string;
  /** Where to see it on the platform. */
  url: string;
}

/** One day of a campaign's numbers. Money in minor units of the account currency. */
export interface AdDayStats {
  day: string;
  impressions: number;
  clicks: number;
  conversions: number;
  costMinor: number;
  conversionValueMinor: number;
}

/** A fresh access token for one ad account. */
export interface AdAccess {
  accessToken: string;
  accountId: string;
}

export interface AdPlatform {
  id: AdPlatformId;
  name: string;
  listAccounts(accessToken: string): Promise<AdAccountInfo[]>;
  /** Builds the campaign, paused, with one ad. Nothing is spent until `setRunning`. */
  launch(access: AdAccess, spec: AdLaunchSpec): Promise<LaunchedCampaign>;
  setRunning(access: AdAccess, campaignId: string, running: boolean): Promise<void>;
  stats(access: AdAccess, campaignId: string, from: string, to: string): Promise<AdDayStats[]>;
}

/** Whole days from `startsOn` to `endsOn`, both included. */
export function campaignDays(startsOn: string, endsOn: string): number {
  return Math.max(1, Math.round((Date.parse(`${endsOn}T00:00:00Z`) - Date.parse(`${startsOn}T00:00:00Z`)) / 86_400_000) + 1);
}
