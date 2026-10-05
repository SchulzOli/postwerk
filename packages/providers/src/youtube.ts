import { catalog } from './catalog';
import { googleConnector, googleJson, googleRequest, refreshGoogleTokens } from './google';
import { bearer, downloadMedia, json, withQuery } from './http';
import { expiresSoon } from './oauth';
import { ProviderError, type OAuthTokens, type Provider } from './types';
import { resolveOptions } from './validate';

const API = 'https://www.googleapis.com/youtube/v3';
const UPLOAD_URL = 'https://www.googleapis.com/upload/youtube/v3/videos';
const SCOPE = 'https://www.googleapis.com/auth/youtube.upload https://www.googleapis.com/auth/youtube.readonly';
const NAME = 'YouTube';

/** The token is bound to the channel picked on Google's consent screen, so uploads need no extra ids. */
export interface YouTubeCredentials extends OAuthTokens {}

interface Channel {
  id: string;
  snippet: { title: string; customUrl?: string; thumbnails?: { default?: { url: string } } };
}

/** YouTube limits the description in UTF-8 bytes, not characters. */
const MAX_DESCRIPTION_BYTES = 5_000;

export const youtube: Provider<YouTubeCredentials> = {
  ...catalog.youtube,
  connector: googleConnector<YouTubeCredentials>(NAME, SCOPE, async (tokens) => {
    const channels = await googleJson<{ items?: Channel[] }>(withQuery(`${API}/channels`, { part: 'snippet', mine: true }), { headers: bearer(tokens.accessToken) }, NAME);
    if (!channels.items?.length) throw new ProviderError('This Google account has no YouTube channel. Create one on YouTube, then connect again.');
    return channels.items.map((channel) => ({
      profile: {
        externalId: channel.id,
        handle: channel.snippet.customUrl ?? channel.snippet.title,
        displayName: channel.snippet.title,
        avatarUrl: channel.snippet.thumbnails?.default?.url,
      },
      credentials: { ...tokens },
    }));
  }),

  validate(content) {
    const issues: string[] = [];
    const { title = '' } = resolveOptions(catalog.youtube, content.options);
    if (/[<>]/.test(title) || /[<>]/.test(content.text)) issues.push('YouTube does not allow < or > in the title or description.');
    const bytes = new TextEncoder().encode(content.text).length;
    if (bytes > MAX_DESCRIPTION_BYTES) issues.push(`Description is too long for YouTube (umlauts and emoji count double); shorten it by about ${bytes - MAX_DESCRIPTION_BYTES} characters.`);
    return issues;
  },

  async publish(credentials, content) {
    const video = content.media.find((item) => item.kind === 'video');
    if (!video) throw new ProviderError('YouTube needs a video.');
    const { title, privacy = 'public' } = resolveOptions(catalog.youtube, content.options);
    if (!title) throw new ProviderError('YouTube needs a video title.');

    const { blob, mimeType } = await downloadMedia(video.url);
    const contentType = video.mimeType ?? mimeType;

    // Resumable upload, step 1: send the metadata and get a session URL in the Location header.
    const session = await googleRequest(
      withQuery(UPLOAD_URL, { uploadType: 'resumable', part: 'snippet,status' }),
      json(
        {
          // 22 = "People & Blogs", the default YouTube Studio uses; vertical videos up to 3 minutes become Shorts automatically.
          snippet: { title, description: content.text, categoryId: '22' },
          status: { privacyStatus: privacy, selfDeclaredMadeForKids: false },
        },
        { ...bearer(credentials.accessToken), 'x-upload-content-type': contentType, 'x-upload-content-length': String(blob.size) },
      ),
      NAME,
    );
    const uploadUrl = session.headers.get('location');
    if (!uploadUrl) throw new ProviderError('YouTube did not return an upload address.', { retryable: true });

    // Step 2: send the bytes in one PUT. The response is the new video resource.
    const uploaded = await googleJson<{ id?: string }>(
      uploadUrl,
      { method: 'PUT', headers: { ...bearer(credentials.accessToken), 'content-type': contentType }, body: blob, timeoutMs: 15 * 60_000 },
      NAME,
    );
    if (!uploaded.id) throw new ProviderError('YouTube did not return the id of the uploaded video.');
    return { remoteId: uploaded.id, url: `https://www.youtube.com/watch?v=${uploaded.id}` };
  },

  needsRefresh: (credentials, now) => expiresSoon(credentials, now),
  refresh: (credentials, client) => refreshGoogleTokens(credentials, client, NAME),
};
