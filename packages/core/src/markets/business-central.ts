import type { MarketManifest } from '../market';

/**
 * MarketingApp4BusinessCentral: extensions for Microsoft Dynamics 365
 * Business Central, sold on AppSource. The listing limits and rules follow
 * Microsoft's documentation, checked on 2026-11-15 (listing page updated
 * 2025-07-29, marketing checklist 2023-09-26); check them when they change:
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
        id: 'partner_center_id',
        label: { en: 'Partner Center product ID', de: 'Produkt-ID in Partner Center' },
        hint: {
          en: 'From the offer’s address in Partner Center, like 1234abcd-…. Needed to send the listing there.',
          de: 'Aus der Adresse des Angebots in Partner Center, etwa 1234abcd-…. Nötig, um den Eintrag dorthin zu senden.',
        },
        type: 'text',
        required: false,
      },
      {
        id: 'offer_name',
        label: { en: 'Offer name in Partner Center', de: 'Angebotsname in Partner Center' },
        hint: {
          en: 'How Partner Center’s reports and leads name the offer. Empty means the product’s name.',
          de: 'Wie Berichte und Leads von Partner Center das Angebot nennen. Leer heißt: der Name des Produkts.',
        },
        type: 'text',
        required: false,
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
        { id: 'name', label: { en: 'Name', de: 'Name' }, max: 200, required: true, multiline: false, emoji: false },
        { id: 'summary', label: { en: 'Search results summary', de: 'Zusammenfassung für die Suche' }, max: 100, required: true, multiline: true, emoji: true },
        { id: 'description', label: { en: 'Description', de: 'Beschreibung' }, max: 5000, required: true, multiline: true, emoji: true },
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
        en: 'No Microsoft logos or icons, such as the Business Central icon or the Dynamics 365 logo, in the logo, screenshots, videos or documents.',
        de: 'Keine Logos oder Icons von Microsoft, etwa das Business-Central-Icon oder das Dynamics-365-Logo, im Logo, in Screenshots, Videos oder Dokumenten.',
      },
      {
        en: 'One language only. If it is not English, the description starts with “This application is available only in [language].”',
        de: 'Nur eine Sprache. Ist es nicht Englisch, beginnt die Beschreibung mit „This application is available only in [Sprache].“',
      },
      {
        en: 'Screenshots show the newest Business Central UI with realistic demo data.',
        de: 'Screenshots zeigen die neueste Oberfläche von Business Central mit realistischen Demodaten.',
      },
      {
        en: 'Videos are YouTube (https://www.youtube.com/watch?v=…) or Vimeo (https://vimeo.com/…) links, each with a 1280 × 720 PNG thumbnail.',
        de: 'Videos sind Links zu YouTube (https://www.youtube.com/watch?v=…) oder Vimeo (https://vimeo.com/…), jeweils mit einem Vorschaubild als PNG in 1280 × 720.',
      },
      {
        en: 'The help link and the support link are different pages.',
        de: 'Der Hilfe-Link und der Support-Link führen auf verschiedene Seiten.',
      },
      {
        en: 'In Partner Center: up to three products the app works with, a primary and a secondary category with up to four subcategories, up to two industries, and a PNG logo of 216 × 216 to 350 × 350 pixels.',
        de: 'In Partner Center: bis zu drei Produkte, mit denen die App funktioniert, eine Haupt- und eine Nebenkategorie mit bis zu vier Unterkategorien, bis zu zwei Branchen und ein PNG-Logo von 216 × 216 bis 350 × 350 Pixeln.',
      },
    ],
    integration: 'partner-center',
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
      postTopics: [
        { en: "The problem: what costs your customers time today, before the extension.", de: "Das Problem: Was deine Kunden heute Zeit kostet, vor der Erweiterung." },
        { en: "It is live on AppSource: what it does, in one sentence, and the link.", de: "Sie ist auf AppSource: was sie macht, in einem Satz, und der Link." },
        { en: "The most important thing it can do, with a screenshot.", de: "Das Wichtigste, was sie kann, mit einem Screenshot." },
        { en: "The second thing it can do, with a screenshot.", de: "Das Zweite, was sie kann, mit einem Screenshot." },
        { en: "The demo video.", de: "Das Demo-Video." },
        { en: "A customer’s or tester’s words, with their permission.", de: "Die Worte eines Kunden oder Testers, mit seiner Erlaubnis." },
      ],
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
      postTopics: [
        { en: "What is new, and who asked for it.", de: "Was neu ist, und wer es sich gewünscht hat." },
        { en: "How the new feature works, with a screenshot.", de: "Wie die neue Funktion funktioniert, mit einem Screenshot." },
        { en: "How to update, and where to ask questions.", de: "Wie man aktualisiert und wo man Fragen stellt." },
      ],
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
      postTopics: [
        { en: "Ready for the new Business Central version: tested, and what customers need to do (usually nothing).", de: "Bereit für die neue Business-Central-Version: getestet, und was Kunden tun müssen (meist nichts)." },
      ],
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
      postTopics: [
        { en: "Where and when to meet you.", de: "Wo und wann man dich trifft." },
        { en: "What visitors will see at your booth or in the webinar.", de: "Was Besucher an deinem Stand oder im Webinar sehen." },
        { en: "Live from the event.", de: "Live vom Event." },
        { en: "Thank you, and the slides or recording.", de: "Danke, und die Folien oder die Aufzeichnung." },
      ],
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
      postTopics: [
        { en: "The customer’s problem before.", de: "Das Problem des Kunden vorher." },
        { en: "What changed with the extension, in numbers if they allow it.", de: "Was sich mit der Erweiterung geändert hat, in Zahlen, wenn er es erlaubt." },
        { en: "The customer’s quote.", de: "Das Zitat des Kunden." },
      ],
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
