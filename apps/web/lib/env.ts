export const appUrl = (process.env.APP_URL ?? 'http://localhost:3000').replace(/\/$/, '');
export const sandboxEnabled = process.env.ENABLE_SANDBOX === 'true';
export const secureCookies = appUrl.startsWith('https://');
export const mastodonRedirectUri = `${appUrl}/api/connect/mastodon/callback`;
