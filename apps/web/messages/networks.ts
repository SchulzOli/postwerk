import { defineMessages } from '@postwerk/core/i18n';

/** Connecting networks and accounts: the accounts page, connect forms, OAuth callbacks and network facts (canvas too). */
export const networksMessages = defineMessages({
  en: {
    pageTitle: 'Accounts',
    connectedNotice: (handles: string) => `Connected ${handles}.`,
    connected: 'Connected',
    noAccounts: 'No accounts yet. Connect one below — it only takes a minute.',
    disconnect: 'Disconnect',
    connectNetwork: 'Connect a network',
    moreNetworks: (count: number) => `${count} more networks`,
    needSetup: 'need a one-time setup by the server admin',
    /** "Set <code>X_CLIENT_ID</code> and <code>X_CLIENT_SECRET</code>, with the callback URL <code>…</code>." */
    envSet: 'Set',
    envAnd: 'and',
    envCallback: ', with the callback URL',
    developerDocs: 'Developer docs',
    developerDocsLink: 'Developer docs →',
    connectAccount: (another: boolean) => (another ? 'Connect another account' : 'Connect an account'),
    continueTo: (network: string) => `Continue to ${network}`,
    connectNamed: (network: string) => `Connect ${network}`,
    connecting: 'Connecting…',
    mastodonServer: 'Server',
    setupTitle: 'One-time setup by the server admin',
    // Facts about a network
    factText: 'Text',
    factMedia: 'Media',
    factPerPost: 'Per post',
    factSetup: 'Setup',
    upToChars: (p: { max: string; withMedia?: string }) => `up to ${p.max} characters${p.withMedia ? ` (${p.withMedia} with media)` : ''}`,
    altText: ' · alt text',
    setupNone: 'None — works for everyone',
    setupOperator: (prefix: string) => `Operator app (${prefix}_CLIENT_ID / _SECRET)`,
    chars: (count: string) => `${count} chars`,
    textOnly: 'Text only',
    images: (count: number) => `${count} image${count === 1 ? '' : 's'}`,
    videos: (count: number) => `${count} video${count === 1 ? '' : 's'}`,
    mixedJoin: ' + ',
    eitherJoin: ' or ',
    mediaRequired: ' · media required',
    statusConnected: (count: number) => `${count} connected`,
    statusReady: 'Ready to connect',
    statusSetup: 'Needs setup',
    // Bluesky
    bluesky: {
      handleHint: 'You sign in on your Bluesky server; Postwerk never sees your password.',
      placeholder: 'you.bsky.social',
      appPassword: 'Use an app password instead',
      connectWithAppPassword: 'Connect with app password',
      needsHttps: 'Signing in on Bluesky itself needs Postwerk on an https address (APP_URL).',
    },
    // Bridge (aggregator API)
    statusReadyVia: (bridge: string) => `Ready to connect · via ${bridge}`,
    via: (bridge: string) => `via ${bridge}`,
    setupBridge: (bridge: string) => `Through ${bridge}, no developer app needed`,
    bridgeNote: (p: { network: string; bridge: string }) =>
      `${p.network} connects through ${p.bridge}, a social media API from the EU. ${p.bridge} keeps the access to the account; Postwerk only stores which account it is.`,
    orBridge: (bridge: string) => ({ before: 'Or set ', after: ` to connect it through ${bridge}, without a developer app.` }),
    bridgeAbout: (bridge: string) =>
      `Networks marked “via ${bridge}” connect through ${bridge}, a social media API from the EU. ${bridge} keeps the access to the accounts; Postwerk only stores which accounts they are.`,
    reconnect: 'Reconnect',
    bridgeExpired: 'Access to this account expired or was revoked. Reconnect it; posts resume afterwards.',
    bridgeCancelled: (network: string) => `Connecting ${network} was cancelled.`,
    bridgeFailed: (p: { network: string; reason: string }) => `Connecting ${p.network} failed: ${p.reason}`,
    // Bridge usage (what the aggregator bills)
    usageTitle: (bridge: string) => `${bridge} usage`,
    usageNow: (p: { accounts: number; profiles: number }) =>
      `${p.accounts} ${p.accounts === 1 ? 'account' : 'accounts'} · ${p.profiles} ${p.profiles === 1 ? 'profile' : 'profiles'}`,
    usageThisMonth: (accounts: number) => `This month: up to ${accounts} at once`,
    usageCost: (cost: string) => `about ${cost}`,
    usageAbout: (bridge: string) =>
      `${bridge} bills this server for each connected account. Postwerk notes the most accounts this workspace had connected at once each month, so estimates rather run high.`,
    usageSetPrice: { before: 'Set ', after: ' to the monthly price per account to see estimates.' },
    usageMonth: 'Month',
    usageAccounts: 'Accounts',
    usageProfiles: 'Profiles',
    usageEstimate: 'Estimate',
    // Results and errors
    notAvailable: 'This network is not available.',
    notForm: 'This network is not connected with a form.',
    notSetUpYet: (network: string) => `${network} is not set up on this server yet.`,
    notSetUp: (network: string) => `${network} is not set up on this server.`,
    cancelled: (network: string) => `${network} authorization was cancelled.`,
    noCode: (network: string) => `${network} did not return an authorization code.`,
    linkExpired: 'This sign-in link has expired. Please try again.',
    failed: (network: string) => `Connecting ${network} failed.`,
  },
  de: {
    pageTitle: 'Konten',
    connectedNotice: (handles) => `${handles} verbunden.`,
    connected: 'Verbunden',
    noAccounts: 'Noch keine Konten. Verbinde unten eins – das dauert nur eine Minute.',
    disconnect: 'Trennen',
    connectNetwork: 'Netzwerk verbinden',
    moreNetworks: (count) => `${count} weitere Netzwerke`,
    needSetup: 'brauchen eine einmalige Einrichtung durch die Server-Admins',
    envSet: 'Setze',
    envAnd: 'und',
    envCallback: ', mit der Callback-URL',
    developerDocs: 'Entwickler-Doku',
    developerDocsLink: 'Entwickler-Doku →',
    connectAccount: (another) => (another ? 'Weiteres Konto verbinden' : 'Konto verbinden'),
    continueTo: (network) => `Weiter zu ${network}`,
    connectNamed: (network) => `${network} verbinden`,
    connecting: 'Verbinde…',
    mastodonServer: 'Server',
    setupTitle: 'Einmalige Einrichtung durch die Server-Admins',
    factText: 'Text',
    factMedia: 'Medien',
    factPerPost: 'Pro Beitrag',
    factSetup: 'Einrichtung',
    upToChars: (p) => `bis zu ${p.max} Zeichen${p.withMedia ? ` (${p.withMedia} mit Medien)` : ''}`,
    altText: ' · Alt-Text',
    setupNone: 'Keine – funktioniert für alle',
    setupOperator: (prefix) => `Betreiber-App (${prefix}_CLIENT_ID / _SECRET)`,
    chars: (count) => `${count} Zeichen`,
    textOnly: 'Nur Text',
    images: (count) => `${count} ${count === 1 ? 'Bild' : 'Bilder'}`,
    videos: (count) => `${count} ${count === 1 ? 'Video' : 'Videos'}`,
    mixedJoin: ' + ',
    eitherJoin: ' oder ',
    mediaRequired: ' · Medien erforderlich',
    statusConnected: (count) => `${count} verbunden`,
    statusReady: 'Bereit zum Verbinden',
    statusSetup: 'Einrichtung nötig',
    bluesky: {
      handleHint: 'Du meldest dich auf deinem Bluesky-Server an; Postwerk sieht dein Passwort nie.',
      placeholder: 'du.bsky.social',
      appPassword: 'Stattdessen ein App-Passwort verwenden',
      connectWithAppPassword: 'Mit App-Passwort verbinden',
      needsHttps: 'Die Anmeldung direkt bei Bluesky braucht Postwerk unter einer https-Adresse (APP_URL).',
    },
    statusReadyVia: (bridge) => `Bereit zum Verbinden · über ${bridge}`,
    via: (bridge) => `über ${bridge}`,
    setupBridge: (bridge) => `Über ${bridge}, keine Entwickler-App nötig`,
    bridgeNote: (p) =>
      `${p.network} wird über ${p.bridge} verbunden, eine Social-Media-API aus der EU. ${p.bridge} verwaltet den Zugriff auf das Konto; Postwerk speichert nur, um welches Konto es geht.`,
    orBridge: (bridge) => ({ before: 'Oder setze ', after: `, um es ohne Entwickler-App über ${bridge} zu verbinden.` }),
    bridgeAbout: (bridge) =>
      `Netzwerke mit „über ${bridge}“ werden über ${bridge} verbunden, eine Social-Media-API aus der EU. ${bridge} verwaltet den Zugriff auf die Konten; Postwerk speichert nur, um welche Konten es geht.`,
    reconnect: 'Neu verbinden',
    bridgeExpired: 'Der Zugriff auf dieses Konto ist abgelaufen oder wurde widerrufen. Verbinde es neu; danach gehen die Beiträge weiter.',
    bridgeCancelled: (network) => `Das Verbinden von ${network} wurde abgebrochen.`,
    bridgeFailed: (p) => `${p.network} konnte nicht verbunden werden: ${p.reason}`,
    usageTitle: (bridge) => `${bridge}-Nutzung`,
    usageNow: (p) => `${p.accounts} ${p.accounts === 1 ? 'Konto' : 'Konten'} · ${p.profiles} ${p.profiles === 1 ? 'Profil' : 'Profile'}`,
    usageThisMonth: (accounts) => `Diesen Monat: bis zu ${accounts} gleichzeitig`,
    usageCost: (cost) => `etwa ${cost}`,
    usageAbout: (bridge) =>
      `${bridge} berechnet diesem Server jedes verbundene Konto. Postwerk notiert pro Monat, wie viele Konten dieser Arbeitsbereich höchstens gleichzeitig verbunden hatte; Schätzungen liegen also eher zu hoch.`,
    usageSetPrice: { before: 'Setze ', after: ' auf den Monatspreis pro Konto, um Schätzungen zu sehen.' },
    usageMonth: 'Monat',
    usageAccounts: 'Konten',
    usageProfiles: 'Profile',
    usageEstimate: 'Schätzung',
    notAvailable: 'Dieses Netzwerk ist nicht verfügbar.',
    notForm: 'Dieses Netzwerk wird nicht über ein Formular verbunden.',
    notSetUpYet: (network) => `${network} ist auf diesem Server noch nicht eingerichtet.`,
    notSetUp: (network) => `${network} ist auf diesem Server nicht eingerichtet.`,
    cancelled: (network) => `Die Anmeldung bei ${network} wurde abgebrochen.`,
    noCode: (network) => `${network} hat keinen Autorisierungscode zurückgegeben.`,
    linkExpired: 'Dieser Anmelde-Link ist abgelaufen. Bitte versuch es noch einmal.',
    failed: (network) => `${network} konnte nicht verbunden werden.`,
  },
});

/** "4 images or 1 video · media required", for a network's capabilities. */
export function mediaSummary(
  media: { maxImages: number; maxVideos: number; mixed: boolean; required: boolean },
  t: (typeof networksMessages)['en'],
): string {
  if (media.maxImages === 0 && media.maxVideos === 0) return t.textOnly;
  const parts = [];
  if (media.maxImages > 0) parts.push(t.images(media.maxImages));
  if (media.maxVideos > 0) parts.push(t.videos(media.maxVideos));
  return `${parts.join(media.mixed ? t.mixedJoin : t.eitherJoin)}${media.required ? t.mediaRequired : ''}`;
}

/** "October 2026" for a usage month ("2026-10"). */
export function usageMonthLabel(month: string, locale: string): string {
  return new Intl.DateTimeFormat(locale, { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${month}-01T00:00:00Z`));
}

/** What `accounts` cost a month at the admin's price, e.g. "€12.00". */
export function usageCost(accounts: number, price: { amount: number; currency: string }, locale: string): string {
  return new Intl.NumberFormat(locale, { style: 'currency', currency: price.currency }).format(accounts * price.amount);
}
