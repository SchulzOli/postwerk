import { defineMessages } from '@postwerk/core/i18n';

/**
 * The server's public pages: about, privacy policy, terms, imprint and data
 * deletion. They describe what Postwerk really stores (see docs/legal.md);
 * the operator's details come from OPERATOR_*. They are templates: operators
 * should have them checked for their own situation.
 */
export const legalMessages = defineMessages({
  en: {
    titles: {
      about: 'About this server',
      privacy: 'Privacy policy',
      terms: 'Terms of use',
      imprint: 'Imprint',
      'data-deletion': 'Deleting your data',
    },
    links: { about: 'About', privacy: 'Privacy', terms: 'Terms', imprint: 'Imprint', 'data-deletion': 'Data deletion' },
    contactLine: 'Questions? Write to',
    sourceCode: 'Source code',

    about: {
      intro: (p: { site: string; operator: string }) =>
        `${p.site} is run by ${p.operator}. It uses Postwerk, an open-source tool to plan posts and publish them to social networks.`,
      how: 'People with an account here connect their own social media accounts, write posts and choose when they go out. Postwerk publishes only what they schedule, and only to the accounts they connected.',
      networks: 'Networks you can connect here',
      viaBridge: (bridge: string) => `through ${bridge}`,
      noNetworks: 'None yet.',
      signIn: 'Sign in',
    },

    privacy: {
      intro: (site: string) => `This page explains which personal data ${site} processes, why, and what rights you have.`,
      controller: 'Who is responsible',
      stored: 'What we store and why',
      account:
        'Your account: name, email address and password (stored only as a salted hash), your language and display settings. We need them to provide your account (Art. 6(1)(b) GDPR).',
      content:
        'What you create: posts, uploaded images and videos, flows, schedules, and your workspaces with their members and invitations. We need them to plan and publish your posts (Art. 6(1)(b) GDPR).',
      accounts:
        'Social media accounts you connect: name, handle, profile picture and the access the network grants, stored encrypted. Postwerk uses this access only to publish the posts you schedule and to show which account is which (Art. 6(1)(b) GDPR).',
      security: (days: number) =>
        `Security: sign-in attempts are counted per email address and IP address for up to an hour to stop password guessing. Sign-ins and changes are recorded in an activity log with the IP address; IP addresses are removed after ${days} days. Our legitimate interest is keeping accounts safe (Art. 6(1)(f) GDPR).`,
      cookies: 'Cookies: only the ones the service needs: your sign-in (30 days), your language, and light or dark mode. No tracking, analytics or advertising.',
      emails: 'Emails: confirming your address, resetting your password, invitations, and notices when a post fails.',
      networks: 'Social networks',
      networksIntro: 'When you connect an account and publish, your posts and media are sent to that network. What happens there is covered by its privacy policy:',
      mastodon: 'Mastodon: the privacy policy of your Mastodon server',
      youtube:
        'This service uses YouTube API Services. When you connect YouTube, Google’s Privacy Policy applies and you agree to the YouTube Terms of Service. You can remove the access at any time in your Google account’s security settings.',
      googlePrivacy: 'Google Privacy Policy',
      youtubeTerms: 'YouTube Terms of Service',
      googlePermissions: 'Google account permissions',
      processors: 'Service providers',
      processorsIntro: 'These providers process data on our behalf, under data processing agreements:',
      processor: {
        hosting: (name: string) => `Hosting the server: ${name}`,
        storage: (name: string) => `Storing uploaded images and videos: ${name}`,
        mail: (name: string) => `Sending emails: ${name}`,
        bridge: (p: { name: string; networks: string }) => `${p.name}: connects ${p.networks} for us. It receives the posts, media and access to these accounts.`,
      },
      privacyPolicy: 'privacy policy',
      retention: 'How long we keep data',
      retentionText:
        'Your account and content stay until you delete them or ask us to. When you disconnect a social media account, its access is deleted right away. Uploads that no post uses are deleted after a day; sign-in sessions end after 30 days.',
      rights: 'Your rights',
      rightsText:
        'You can ask for access to your data, its correction or deletion, restriction of processing, and a copy to take elsewhere. You can object to processing based on legitimate interest, and you can complain to a data protection authority.',
      deleteLink: 'How to delete your data',
    },

    terms: {
      intro: (p: { site: string; operator: string }) => `These terms apply when you use ${p.site}, run by ${p.operator}.`,
      service: 'The service',
      serviceText:
        'Postwerk lets you plan posts and publish them to the social media accounts you connect. It is provided as it is: we keep it running as well as we can, but cannot promise that every post goes out on time.',
      account: 'Your account',
      accountText: 'Keep your password safe. You are responsible for what is published from your account and your workspaces.',
      content: 'Your content',
      contentText:
        'Your posts and media stay yours. You give us only the rights needed to store them and to publish them where you choose. Do not publish anything illegal, and follow the rules of every network you post to.',
      youtube: 'By connecting YouTube, you agree to the YouTube Terms of Service.',
      liability: 'Liability',
      liabilityText:
        'We are liable without limit for intent and gross negligence and for injury to life, body or health. For slight negligence we are liable only for breaches of essential obligations, limited to typical, foreseeable damage.',
      ending: 'Ending',
      endingText: 'You can stop using the service at any time and ask us to delete your account. We may close accounts that break these terms.',
      changes: 'Changes',
      changesText: 'We tell you about important changes to these terms before they apply.',
    },

    imprint: {
      intro: 'Information according to § 5 DDG (German Digital Services Act):',
      contact: 'Contact',
      phone: 'Phone',
      email: 'Email',
    },

    deletion: {
      intro: 'You decide what happens to your data. This is how to delete it.',
      disconnect: 'Disconnect a social media account',
      disconnectText:
        'On the canvas, click the account and choose Disconnect (or use the accounts page). Postwerk deletes its access right away; posts planned only for that account are removed.',
      bridge: (bridge: string) => `Accounts connected through ${bridge} are removed there too.`,
      atNetwork: 'Remove the access at the network too',
      atNetworkText: 'In the network’s settings for connected apps, remove the app this server uses.',
      everything: 'Delete your account and everything in it',
      everythingText: 'Write to us from the email address you signed up with. We delete your account and your data within 30 days and confirm it by email.',
    },
  },
  de: {
    titles: {
      about: 'Über diesen Server',
      privacy: 'Datenschutzerklärung',
      terms: 'Nutzungsbedingungen',
      imprint: 'Impressum',
      'data-deletion': 'Deine Daten löschen',
    },
    links: { about: 'Über', privacy: 'Datenschutz', terms: 'Nutzungsbedingungen', imprint: 'Impressum', 'data-deletion': 'Daten löschen' },
    contactLine: 'Fragen? Schreib an',
    sourceCode: 'Quellcode',

    about: {
      intro: (p) => `${p.site} wird von ${p.operator} betrieben. Es nutzt Postwerk, ein Open-Source-Werkzeug, um Beiträge zu planen und in sozialen Netzwerken zu veröffentlichen.`,
      how: 'Wer hier ein Konto hat, verbindet eigene Social-Media-Konten, schreibt Beiträge und legt fest, wann sie erscheinen. Postwerk veröffentlicht nur, was geplant wurde, und nur in den verbundenen Konten.',
      networks: 'Netzwerke, die du hier verbinden kannst',
      viaBridge: (bridge) => `über ${bridge}`,
      noNetworks: 'Noch keine.',
      signIn: 'Anmelden',
    },

    privacy: {
      intro: (site) => `Hier steht, welche personenbezogenen Daten ${site} verarbeitet, wozu, und welche Rechte du hast.`,
      controller: 'Verantwortlich',
      stored: 'Was wir speichern und wozu',
      account:
        'Dein Konto: Name, E-Mail-Adresse und Passwort (nur als gesalzener Hash gespeichert), deine Sprache und Anzeige-Einstellungen. Wir brauchen sie, um dein Konto bereitzustellen (Art. 6 Abs. 1 lit. b DSGVO).',
      content:
        'Was du erstellst: Beiträge, hochgeladene Bilder und Videos, Flows, Zeitpläne sowie deine Arbeitsbereiche mit Mitgliedern und Einladungen. Wir brauchen sie, um deine Beiträge zu planen und zu veröffentlichen (Art. 6 Abs. 1 lit. b DSGVO).',
      accounts:
        'Social-Media-Konten, die du verbindest: Name, Handle, Profilbild und der Zugriff, den das Netzwerk gewährt, verschlüsselt gespeichert. Postwerk nutzt diesen Zugriff nur, um deine geplanten Beiträge zu veröffentlichen und anzuzeigen, welches Konto welches ist (Art. 6 Abs. 1 lit. b DSGVO).',
      security: (days) =>
        `Sicherheit: Anmeldeversuche werden pro E-Mail-Adresse und IP-Adresse bis zu einer Stunde gezählt, um das Erraten von Passwörtern zu verhindern. Anmeldungen und Änderungen werden mit IP-Adresse in einem Aktivitätsprotokoll festgehalten; die IP-Adressen werden nach ${days} Tagen entfernt. Unser berechtigtes Interesse ist die Sicherheit der Konten (Art. 6 Abs. 1 lit. f DSGVO).`,
      cookies: 'Cookies: nur die nötigen – deine Anmeldung (30 Tage), deine Sprache und heller oder dunkler Modus. Kein Tracking, keine Analyse, keine Werbung.',
      emails: 'E-Mails: Bestätigung deiner Adresse, Zurücksetzen des Passworts, Einladungen und Hinweise, wenn ein Beitrag fehlschlägt.',
      networks: 'Soziale Netzwerke',
      networksIntro: 'Wenn du ein Konto verbindest und veröffentlichst, gehen deine Beiträge und Medien an dieses Netzwerk. Was dort geschieht, regelt seine Datenschutzerklärung:',
      mastodon: 'Mastodon: die Datenschutzerklärung deines Mastodon-Servers',
      youtube:
        'Dieser Dienst nutzt die YouTube API Services. Wenn du YouTube verbindest, gilt die Datenschutzerklärung von Google, und du stimmst den Nutzungsbedingungen von YouTube zu. Den Zugriff kannst du jederzeit in den Sicherheitseinstellungen deines Google-Kontos entfernen.',
      googlePrivacy: 'Datenschutzerklärung von Google',
      youtubeTerms: 'Nutzungsbedingungen von YouTube',
      googlePermissions: 'Berechtigungen im Google-Konto',
      processors: 'Dienstleister',
      processorsIntro: 'Diese Dienstleister verarbeiten Daten in unserem Auftrag, auf Grundlage von Auftragsverarbeitungsverträgen:',
      processor: {
        hosting: (name) => `Betrieb des Servers: ${name}`,
        storage: (name) => `Speicherung hochgeladener Bilder und Videos: ${name}`,
        mail: (name) => `Versand von E-Mails: ${name}`,
        bridge: (p) => `${p.name}: verbindet ${p.networks} für uns. Dafür erhält es die Beiträge, Medien und den Zugriff auf diese Konten.`,
      },
      privacyPolicy: 'Datenschutzerklärung',
      retention: 'Wie lange wir Daten speichern',
      retentionText:
        'Dein Konto und deine Inhalte bleiben, bis du sie löschst oder uns darum bittest. Wenn du ein Social-Media-Konto trennst, wird sein Zugriff sofort gelöscht. Uploads, die kein Beitrag nutzt, werden nach einem Tag gelöscht; Anmeldungen enden nach 30 Tagen.',
      rights: 'Deine Rechte',
      rightsText:
        'Du kannst Auskunft über deine Daten verlangen, ihre Berichtigung oder Löschung, die Einschränkung der Verarbeitung und eine Kopie zur Mitnahme. Du kannst einer Verarbeitung aufgrund berechtigten Interesses widersprechen und dich bei einer Datenschutz-Aufsichtsbehörde beschweren.',
      deleteLink: 'So löschst du deine Daten',
    },

    terms: {
      intro: (p) => `Diese Bedingungen gelten, wenn du ${p.site} nutzt, betrieben von ${p.operator}.`,
      service: 'Der Dienst',
      serviceText:
        'Mit Postwerk planst du Beiträge und veröffentlichst sie in den Social-Media-Konten, die du verbindest. Wir stellen den Dienst so bereit, wie er ist: Wir halten ihn so gut wie möglich am Laufen, können aber nicht versprechen, dass jeder Beitrag pünktlich erscheint.',
      account: 'Dein Konto',
      accountText: 'Halte dein Passwort geheim. Du bist verantwortlich für das, was aus deinem Konto und deinen Arbeitsbereichen veröffentlicht wird.',
      content: 'Deine Inhalte',
      contentText:
        'Deine Beiträge und Medien gehören weiter dir. Du gibst uns nur die Rechte, die nötig sind, um sie zu speichern und dort zu veröffentlichen, wo du es willst. Veröffentliche nichts Rechtswidriges und halte die Regeln jedes Netzwerks ein, in dem du postest.',
      youtube: 'Wenn du YouTube verbindest, stimmst du den Nutzungsbedingungen von YouTube zu.',
      liability: 'Haftung',
      liabilityText:
        'Wir haften unbeschränkt für Vorsatz und grobe Fahrlässigkeit sowie für Schäden an Leben, Körper oder Gesundheit. Bei leichter Fahrlässigkeit haften wir nur für die Verletzung wesentlicher Pflichten, begrenzt auf den typischen, vorhersehbaren Schaden.',
      ending: 'Ende',
      endingText: 'Du kannst den Dienst jederzeit beenden und uns bitten, dein Konto zu löschen. Konten, die gegen diese Bedingungen verstoßen, können wir schließen.',
      changes: 'Änderungen',
      changesText: 'Über wichtige Änderungen dieser Bedingungen informieren wir dich, bevor sie gelten.',
    },

    imprint: {
      intro: 'Angaben gemäß § 5 DDG:',
      contact: 'Kontakt',
      phone: 'Telefon',
      email: 'E-Mail',
    },

    deletion: {
      intro: 'Du entscheidest, was mit deinen Daten passiert. So löschst du sie.',
      disconnect: 'Ein Social-Media-Konto trennen',
      disconnectText:
        'Klicke auf dem Canvas auf das Konto und wähle „Trennen“ (oder nutze die Kontenseite). Postwerk löscht den Zugriff sofort; Beiträge, die nur für dieses Konto geplant waren, werden entfernt.',
      bridge: (bridge) => `Konten, die über ${bridge} verbunden sind, werden auch dort entfernt.`,
      atNetwork: 'Den Zugriff auch beim Netzwerk entfernen',
      atNetworkText: 'Entferne in den Einstellungen des Netzwerks für verbundene Apps die App, die dieser Server nutzt.',
      everything: 'Dein Konto und alles darin löschen',
      everythingText: 'Schreib uns von der E-Mail-Adresse, mit der du dich registriert hast. Wir löschen dein Konto und deine Daten innerhalb von 30 Tagen und bestätigen es per E-Mail.',
    },
  },
});
