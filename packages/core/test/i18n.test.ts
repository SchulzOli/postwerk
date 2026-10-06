import { describe, expect, it } from 'vitest';
import { catalog, localizeFields, localizeInfo, Mastodon, ProviderError, validateContent, validationMessages } from '@postwerk/providers';
import { planFlow } from '../src/flow';
import { errorText, joinList, matchLocale } from '../src/i18n';
import { inviteMail, postFailedMail, resetPasswordMail } from '../src/mail-templates';
import { MediaError } from '../src/media';
import { flowMessages, postMessages, themeMessages, userMessages, workspaceMessages } from '../src/messages';
import { retryIn } from '../src/ratelimit';
import { parseThemeManifest, ThemeError } from '../src/theme';
import { checkNewPassword, UserInputError } from '../src/users';

describe('languages', () => {
  it('picks the best supported language from Accept-Language', () => {
    expect(matchLocale('de-DE,de;q=0.9,en;q=0.8')).toBe('de');
    expect(matchLocale('fr-FR,fr;q=0.9,en-GB;q=0.8,de;q=0.7')).toBe('en');
    expect(matchLocale('en;q=0.5, de-AT;q=0.8')).toBe('de');
    expect(matchLocale('fr, es')).toBeUndefined();
    expect(matchLocale('de;q=0')).toBeUndefined();
    expect(matchLocale(undefined)).toBeUndefined();
  });

  it('has every message in German too', () => {
    // The types already enforce this; this guards against `as` casts and empty strings.
    for (const messages of [validationMessages, flowMessages, postMessages, userMessages, workspaceMessages, themeMessages]) {
      expect(Object.keys(messages.de).sort()).toEqual(Object.keys(messages.en).sort());
      for (const value of Object.values(messages.de)) if (typeof value === 'string') expect(value.trim()).not.toBe('');
    }
  });

  it('joins lists the way each language does', () => {
    expect(joinList(['a', 'b', 'c'], 'en')).toBe('a, b, and c');
    expect(joinList(['a', 'b', 'c'], 'de')).toBe('a, b und c');
  });
});

describe('localized errors', () => {
  it('keep English as their message and render in any language', () => {
    const error = (() => {
      try {
        checkNewPassword('short');
      } catch (caught) {
        return caught;
      }
    })();
    expect(error).toBeInstanceOf(UserInputError);
    expect((error as Error).message).toBe('Use at least 10 characters for your password.');
    expect(errorText(error, 'de')).toBe('Verwende mindestens 10 Zeichen für dein Passwort.');
    expect(errorText(new Error('plain'), 'de')).toBe('plain');
    expect(new MediaError((m) => m.empty).localize('de')).toBe('Die Datei ist leer.');
  });

  it('show connection problems in German where Postwerk wrote them', () => {
    const error = (() => {
      try {
        Mastodon.normalizeInstanceUrl('http://example.com');
      } catch (caught) {
        return caught;
      }
    })();
    expect([errorText(error, 'en'), errorText(error, 'de')]).toEqual(['Mastodon servers must use https.', 'Mastodon-Server müssen https verwenden.']);
    // Messages relayed from a network stay as they are.
    expect(errorText(new ProviderError('instance.example responded 500'), 'de')).toBe('instance.example responded 500');
  });

  it('explain broken themes in German', () => {
    const error = (() => {
      try {
        parseThemeManifest('{ nope');
      } catch (caught) {
        return caught as ThemeError;
      }
    })()!;
    expect(error).toBeInstanceOf(ThemeError);
    expect(error.localize('de')).toMatch(/^Das ist kein gültiges JSON: /);
  });
});

describe('German messages', () => {
  it('validate posts', () => {
    const issues = validateContent(catalog.bluesky, { text: 'a'.repeat(301), media: [], options: {} }, undefined, 'de');
    expect(issues).toEqual(['Der Text hat 301 Zeichen; Bluesky erlaubt 300.']);
    expect(validateContent(catalog.instagram, { text: 'Hi', media: [], options: {} }, undefined, 'de')).toEqual(['Instagram braucht ein Bild oder Video.']);
    expect(validateContent(catalog.reddit, { text: 'Hi', media: [], options: {} }, undefined, 'de')).toContain('Subreddit fehlt.');
  });

  it('plan flows', () => {
    expect(planFlow({ steps: [], edges: [] }, 'x', undefined, 'de').errors).toEqual(['Ein Flow braucht genau einen Schritt „Neuer Beitrag“.']);
  });

  it('describe networks and their forms', () => {
    const youtube = localizeInfo(catalog.youtube, 'de');
    expect(youtube.description).toBe('Lade Videos und Shorts auf deinen YouTube-Kanal hoch.');
    expect(youtube.capabilities.options.find((option) => option.key === 'privacy')).toMatchObject({
      label: 'Sichtbarkeit',
      choices: [
        { value: 'public', label: 'Öffentlich' },
        { value: 'unlisted', label: 'Nicht gelistet' },
        { value: 'private', label: 'Privat' },
      ],
    });
    expect(localizeInfo(catalog.youtube, 'en')).toBe(catalog.youtube);
    expect(localizeFields('discord', [{ name: 'webhookUrl', label: 'Webhook URL', placeholder: 'https://discord.com/…' }], 'de')).toEqual([
      { name: 'webhookUrl', label: 'Webhook-URL', placeholder: 'https://discord.com/…', hint: expect.stringContaining('Servereinstellungen') },
    ]);
  });

  it('write emails', () => {
    const reset = resetPasswordMail('a@example.com', 'Anna', 'https://x.test/r', 'de');
    expect(reset.subject).toBe('Setze dein Postwerk-Passwort zurück');
    expect(reset.text).toContain('Hallo Anna,');
    expect(reset.html).toContain('<html lang="de">');
    expect(reset.html).toContain('Oder öffne diesen Link:');
    const invite = inviteMail('b@example.com', { inviter: 'Oli', workspace: 'Praxis', role: 'editor', url: 'https://x.test/i' }, 'de');
    expect(invite.text).toContain('als Bearbeiter.');
    expect(inviteMail('b@example.com', { inviter: 'Oli', workspace: 'Praxis', role: 'admin', url: 'https://x.test/i' }).text).toContain('as an admin.');
    const failed = postFailedMail('c@example.com', { name: 'C', excerpt: 'Hallo', partial: true, failures: [], url: 'u', settingsUrl: 's' }, 'de');
    expect(failed.subject).toBe('Ein Beitrag wurde nur teilweise veröffentlicht');
  });

  it('say when to retry', () => {
    expect([retryIn(30_000, 'de'), retryIn(5 * 60_000, 'de'), retryIn(5 * 60_000)]).toEqual(['in einer Minute', 'in 5 Minuten', 'in 5 minutes']);
  });
});
