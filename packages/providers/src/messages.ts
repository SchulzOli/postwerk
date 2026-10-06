import { defineMessages, type Locale } from './i18n';
import type { FormField, OptionField, ProviderId, ProviderInfo } from './types';

/** Messages of the content checks (shown in the composer and returned by the server). */
export const validationMessages = defineMessages({
  en: {
    textEmpty: 'Text is empty.',
    addTextOrMedia: 'Add some text or media.',
    textTooLong: (p: { length: number; network: string; max: number; withMedia: boolean }) =>
      `Text is ${p.length} characters; ${p.network} allows ${p.max}${p.withMedia ? ' with media' : ''}.`,
    needsMedia: (p: { network: string; kind: 'video' | 'image' | 'either' }) =>
      `${p.network} needs ${{ video: 'a video', image: 'an image', either: 'an image or video' }[p.kind]}.`,
    noImages: (network: string) => `${network} does not support images.`,
    tooManyImages: (p: { network: string; max: number }) => `${p.network} allows at most ${p.max} image${p.max === 1 ? '' : 's'}.`,
    noVideos: (network: string) => `${network} does not support videos.`,
    tooManyVideos: (p: { network: string; max: number }) => `${p.network} allows at most ${p.max} video${p.max === 1 ? '' : 's'}.`,
    noMixing: (network: string) => `${network} cannot combine images and videos in one post.`,
    fileTooBig: (p: { network: string; kind: 'image' | 'video'; limit: string; count: number }) =>
      `${p.network} accepts ${p.kind}s up to ${p.limit}; ${p.count === 1 ? `one ${p.kind} is` : `${p.count} ${p.kind}s are`} larger.`,
    required: (label: string) => `${label} is required.`,
    invalidChoice: (label: string) => `${label} has an invalid value.`,
    optionTooLong: (p: { label: string; max: number }) => `${p.label} is longer than ${p.max} characters.`,
  },
  de: {
    textEmpty: 'Der Text ist leer.',
    addTextOrMedia: 'Füge Text oder Medien hinzu.',
    textTooLong: (p) => `Der Text hat ${p.length} Zeichen; ${p.network} erlaubt ${p.max}${p.withMedia ? ' mit Medien' : ''}.`,
    needsMedia: (p) => `${p.network} braucht ${{ video: 'ein Video', image: 'ein Bild', either: 'ein Bild oder Video' }[p.kind]}.`,
    noImages: (network) => `${network} unterstützt keine Bilder.`,
    tooManyImages: (p) => `${p.network} erlaubt höchstens ${p.max} ${p.max === 1 ? 'Bild' : 'Bilder'}.`,
    noVideos: (network) => `${network} unterstützt keine Videos.`,
    tooManyVideos: (p) => `${p.network} erlaubt höchstens ${p.max} ${p.max === 1 ? 'Video' : 'Videos'}.`,
    noMixing: (network) => `${network} kann Bilder und Videos nicht in einem Beitrag kombinieren.`,
    fileTooBig: (p) => {
      const noun = p.kind === 'image' ? ['Bild', 'Bilder'] : ['Video', 'Videos'];
      return `${p.network} nimmt ${noun[1]} bis ${p.limit} an; ${p.count === 1 ? `ein ${noun[0]} ist` : `${p.count} ${noun[1]} sind`} größer.`;
    },
    required: (label) => `${label} fehlt.`,
    invalidChoice: (label) => `${label} hat einen ungültigen Wert.`,
    optionTooLong: (p) => `${p.label} ist länger als ${p.max} Zeichen.`,
  },
});

interface InfoText {
  description: string;
  options?: Record<string, { label?: string; hint?: string; choices?: Record<string, string> }>;
}

/** German texts of the network catalog (descriptions and per-post fields). */
const germanInfo: Partial<Record<ProviderId, InfoText>> = {
  mastodon: { description: 'Gib deinen Server ein und erlaube den Zugriff dort. Keine Entwickler-Einrichtung nötig.' },
  bluesky: { description: 'Melde dich mit deinem Bluesky-Konto an oder nutze ein App-Passwort.' },
  facebook: { description: 'Poste auf die Facebook-Seiten, die du verwaltest.' },
  instagram: { description: 'Poste Fotos, Karussells und Reels auf professionelle Instagram-Konten.' },
  threads: { description: 'Poste Texte, Fotos und Videos auf Threads.' },
  linkedin: { description: 'Poste auf dein persönliches LinkedIn-Profil.' },
  linkedin_page: { description: 'Poste auf LinkedIn-Unternehmensseiten, die du verwaltest.' },
  x: { description: 'Poste auf X (früher Twitter).' },
  tiktok: {
    description: 'Poste Videos und Foto-Karussells auf TikTok.',
    options: {
      privacy: {
        label: 'Wer es sehen kann',
        hint: 'Bis die App den TikTok-Audit bestanden hat, funktioniert nur „Nur ich“.',
        choices: { PUBLIC_TO_EVERYONE: 'Alle', MUTUAL_FOLLOW_FRIENDS: 'Freunde', FOLLOWER_OF_CREATOR: 'Follower', SELF_ONLY: 'Nur ich' },
      },
    },
  },
  youtube: {
    description: 'Lade Videos und Shorts auf deinen YouTube-Kanal hoch.',
    options: {
      title: { label: 'Videotitel' },
      privacy: { label: 'Sichtbarkeit', choices: { public: 'Öffentlich', unlisted: 'Nicht gelistet', private: 'Privat' } },
    },
  },
  pinterest: {
    description: 'Erstelle Pins auf deinen Pinnwänden. Jede Pinnwand wird als eigenes Konto verbunden.',
    options: { title: { label: 'Pin-Titel' }, link: { label: 'Ziel-Link', hint: 'Wohin der Pin beim Anklicken führt.' } },
  },
  reddit: {
    description: 'Reiche Textbeiträge in Subreddits ein.',
    options: { subreddit: { hint: 'Ohne r/, z. B. „physiotherapy“.' }, title: { label: 'Titel' } },
  },
  google_business: { description: 'Veröffentliche Neuigkeiten zu deinem Unternehmen in der Google-Suche und in Maps.' },
  telegram: { description: 'Poste über deinen eigenen Bot in einen Kanal oder eine Gruppe.' },
  discord: { description: 'Poste über einen Webhook in einen Discord-Kanal.' },
  sandbox: { description: 'Ein Test-Netzwerk zum Ausprobieren. Schreib #fail oder #flaky in einen Beitrag, um Fehler zu simulieren.' },
};

/** A network's catalog entry with its texts in a language (setup notes for admins stay English). */
export function localizeInfo<T extends ProviderInfo>(info: T, locale: Locale): T {
  const text = locale === 'de' ? germanInfo[info.id] : undefined;
  if (!text) return info;
  const option = (field: OptionField): OptionField => {
    const translated = text.options?.[field.key];
    if (!translated) return field;
    return {
      ...field,
      label: translated.label ?? field.label,
      hint: translated.hint ?? field.hint,
      choices: field.choices?.map((choice) => ({ ...choice, label: translated.choices?.[choice.value] ?? choice.label })),
    };
  };
  return { ...info, description: text.description, capabilities: { ...info.capabilities, options: info.capabilities.options.map(option) } };
}

/** German texts of the connect forms (field name → texts). */
const germanFields: Partial<Record<ProviderId, Record<string, Partial<Pick<FormField, 'label' | 'placeholder' | 'hint'>>>>> = {
  bluesky: {
    handle: { label: 'Handle', placeholder: 'du.bsky.social' },
    appPassword: { label: 'App-Passwort', hint: 'Erstelle eins auf bsky.app → Einstellungen → Datenschutz und Sicherheit → App-Passwörter.' },
  },
  telegram: {
    botToken: { label: 'Bot-Token', hint: 'Schreib in Telegram @BotFather, sende /newbot und kopiere das Token, das du bekommst.' },
    chat: {
      label: 'Kanal oder Gruppe',
      placeholder: '@deinkanal oder -1001234567890',
      hint: 'Füge den Bot deinem Kanal oder deiner Gruppe als Administrator hinzu, der Nachrichten posten darf, und gib dann den @Benutzernamen ein (oder die numerische ID bei privaten Chats).',
    },
  },
  discord: {
    webhookUrl: { label: 'Webhook-URL', hint: 'In Discord: Servereinstellungen → Integrationen → Webhooks → Neuer Webhook, Kanal wählen, dann Webhook-URL kopieren.' },
  },
  sandbox: { name: { label: 'Name' } },
};

/** A network's connect form fields with their texts in a language. */
export function localizeFields(provider: ProviderId, fields: FormField[], locale: Locale): FormField[] {
  const text = locale === 'de' ? germanFields[provider] : undefined;
  return text ? fields.map((field) => ({ ...field, ...text[field.name] })) : fields;
}
