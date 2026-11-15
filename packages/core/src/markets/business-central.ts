import type { MarketManifest } from '../market';

/**
 * MarketingApp4BusinessCentral: extensions for Microsoft Dynamics 365
 * Business Central, sold on AppSource. The listing limits follow Microsoft's
 * documentation of the offer listing and its marketing validation checklist
 * (November 2026); check them there when they change:
 * https://learn.microsoft.com/en-us/partner-center/marketplace-offers/dynamics-365-business-central-offer-listing
 * https://learn.microsoft.com/en-us/dynamics365/business-central/dev-itpro/developer/readiness/readiness-checklist-marketing
 */
export const businessCentral: MarketManifest = {
  kind: 'market',
  id: 'business-central',
  name: { en: 'Business Central extensions', de: 'Business-Central-Erweiterungen' },
  version: '1.0.0',
  author: 'MarketingAsAService',
  description: {
    en: 'Extensions for Microsoft Dynamics 365 Business Central, listed on AppSource: the listing with its screenshots, launches, new versions and the release waves.',
    de: 'Erweiterungen für Microsoft Dynamics 365 Business Central, gelistet auf AppSource: der Eintrag mit seinen Screenshots, Starts, neue Versionen und die Release Waves.',
  },
  product: {
    name: { en: 'Business Central extension', de: 'Business-Central-Erweiterung' },
    fields: [
      {
        id: 'publisher',
        label: { en: 'Publisher', de: 'Herausgeber' },
        hint: { en: 'As in the app.json of the extension.', de: 'Wie in der app.json der Erweiterung.' },
        type: 'text',
        required: true,
      },
      {
        id: 'app_version',
        label: { en: 'Version', de: 'Version' },
        hint: { en: 'As in the app.json of the extension.', de: 'Wie in der app.json der Erweiterung.' },
        type: 'text',
        required: true,
      },
      {
        id: 'editions',
        label: { en: 'Editions', de: 'Editionen' },
        type: 'choices',
        options: [
          { id: 'essentials', label: { en: 'Essentials', de: 'Essentials' } },
          { id: 'premium', label: { en: 'Premium', de: 'Premium' } },
        ],
        required: true,
      },
      {
        id: 'appsource_url',
        label: { en: 'AppSource link', de: 'AppSource-Link' },
        hint: { en: 'Empty until it is published.', de: 'Leer, bis sie veröffentlicht ist.' },
        type: 'text',
        required: false,
      },
    ],
  },
  marketplace: {
    name: 'AppSource',
    url: 'https://appsource.microsoft.com',
    listing: {
      texts: [
        { id: 'name', label: { en: 'Name', de: 'Name' }, max: 200, required: true, multiline: false },
        { id: 'summary', label: { en: 'Search results summary', de: 'Zusammenfassung für die Suche' }, max: 100, required: true, multiline: true },
        { id: 'description', label: { en: 'Description', de: 'Beschreibung' }, max: 5000, required: true, multiline: true },
      ],
      keywords: { min: 0, max: 3 },
      screenshots: { min: 3, max: 5, width: 1280, height: 720 },
      videos: { min: 0, max: 4 },
      documents: { min: 1, max: 3 },
    },
    rules: [
      {
        en: 'Name, publisher and version match the app.json of the extension.',
        de: 'Name, Herausgeber und Version stimmen mit der app.json der Erweiterung überein.',
      },
      {
        en: 'The description names the supported editions, countries and languages, and the countries match the markets the offer is available in.',
        de: 'Die Beschreibung nennt die unterstützten Editionen, Länder und Sprachen, und die Länder stimmen mit den Märkten überein, in denen das Angebot verfügbar ist.',
      },
      {
        en: 'No Microsoft logos or icons, such as the Business Central icon or the Dynamics 365 logo, in the logo, screenshots or videos.',
        de: 'Keine Logos oder Icons von Microsoft, etwa das Business-Central-Icon oder das Dynamics-365-Logo, im Logo, in Screenshots oder Videos.',
      },
    ],
  },
  templates: [
    {
      id: 'launch',
      name: { en: 'Launch on AppSource', de: 'Start auf AppSource' },
      description: {
        en: 'The listing, its screenshots, a demo video and four weeks of posts.',
        de: 'Der Eintrag, seine Screenshots, ein Demo-Video und vier Wochen Posts.',
      },
      goal: 'leads',
      channels: ['social', 'search_ads', 'video_ads'],
      pieces: [
        { kind: 'listing', title: { en: 'AppSource listing', de: 'AppSource-Eintrag' } },
        { kind: 'screenshot', title: { en: 'Screenshot 1', de: 'Screenshot 1' } },
        { kind: 'screenshot', title: { en: 'Screenshot 2', de: 'Screenshot 2' } },
        { kind: 'screenshot', title: { en: 'Screenshot 3', de: 'Screenshot 3' } },
        { kind: 'spot', format: 'video_30', title: { en: 'Demo', de: 'Demo' } },
        { kind: 'ad', format: 'search', title: { en: 'Search ad', de: 'Suchanzeige' } },
      ],
      posts: 6,
      weeks: 4,
    },
    {
      id: 'new_version',
      name: { en: 'New version', de: 'Neue Version' },
      description: {
        en: 'What is new, for customers and for people who looked before.',
        de: 'Was neu ist, für Kunden und für alle, die schon einmal geschaut haben.',
      },
      goal: 'traffic',
      channels: ['social'],
      pieces: [
        { kind: 'listing', title: { en: 'Updated listing', de: 'Aktualisierter Eintrag' } },
        { kind: 'screenshot', title: { en: 'What is new', de: 'Was neu ist' } },
      ],
      posts: 3,
      weeks: 2,
    },
    {
      id: 'release_wave',
      name: { en: 'Ready for the release wave', de: 'Bereit für die Release Wave' },
      description: {
        en: 'Every April and October: your extension works with the new Business Central.',
        de: 'Jeden April und Oktober: Deine Erweiterung läuft mit dem neuen Business Central.',
      },
      goal: 'awareness',
      channels: ['social'],
      pieces: [{ kind: 'listing', title: { en: 'Updated listing', de: 'Aktualisierter Eintrag' } }],
      posts: 1,
      weeks: 1,
    },
    {
      id: 'event',
      name: { en: 'Event', de: 'Event' },
      description: {
        en: 'Before, during and after a conference or a webinar.',
        de: 'Vor, während und nach einer Konferenz oder einem Webinar.',
      },
      goal: 'event',
      channels: ['social', 'print'],
      pieces: [{ kind: 'print', format: 'flyer_a5', title: { en: 'Flyer for the booth', de: 'Flyer für den Stand' } }],
      posts: 4,
      weeks: 3,
    },
    {
      id: 'customer_story',
      name: { en: 'Customer story', de: 'Kundengeschichte' },
      description: {
        en: 'One customer, the problem and the result, told on every channel.',
        de: 'Ein Kunde, das Problem und das Ergebnis, auf jedem Kanal erzählt.',
      },
      goal: 'leads',
      channels: ['social', 'social_ads'],
      pieces: [{ kind: 'ad', format: 'social', title: { en: 'Customer quote', de: 'Kundenzitat' } }],
      posts: 3,
      weeks: 3,
    },
  ],
  studio: {
    en: 'The product is an extension for Microsoft Dynamics 365 Business Central, sold on AppSource. Name the platform "Microsoft Dynamics 365 Business Central" the first time and "Business Central" after that; never shorten it to "BC" or "D365" in texts for customers. Do not suggest that Microsoft made, endorses or certifies the extension. Write for the people who use Business Central every day and for the partner who installs it, and say which editions, countries and languages the extension supports.',
    de: 'Das Produkt ist eine Erweiterung für Microsoft Dynamics 365 Business Central, verkauft auf AppSource. Nenne die Plattform beim ersten Mal „Microsoft Dynamics 365 Business Central“ und danach „Business Central“; kürze sie in Texten für Kunden nie mit „BC“ oder „D365“ ab. Erwecke nicht den Eindruck, Microsoft habe die Erweiterung gemacht, empfohlen oder zertifiziert. Schreib für die Menschen, die täglich mit Business Central arbeiten, und für den Partner, der sie installiert, und nenne die unterstützten Editionen, Länder und Sprachen.',
  },
  results: {
    reach: { en: 'Visits to the listing', de: 'Besuche des Eintrags' },
    clicks: { en: 'Clicks on “Get it now”', de: 'Klicks auf „Get it now“' },
    leads: { en: 'Installs and contact requests', de: 'Installationen und Kontaktanfragen' },
  },
};
