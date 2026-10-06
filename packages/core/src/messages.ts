/**
 * Everything core says to people, in every language. Browser-safe (the flow
 * planner and theme validation run in the browser too).
 */
import { defineMessages } from '@postwerk/providers/i18n';

export const flowMessages = defineMessages({
  en: {
    oneTrigger: 'A flow needs exactly one "New post" step.',
    loop: 'The flow contains a loop.',
    noAccount: 'A "Publish to account" step has no account selected.',
    accountTwice: 'An account is reached by more than one path; each account can only be used once per flow.',
    noTargets: 'The flow does not reach any account yet.',
  },
  de: {
    oneTrigger: 'Ein Flow braucht genau einen Schritt „Neuer Beitrag“.',
    loop: 'Der Flow enthält eine Schleife.',
    noAccount: 'Bei einem Schritt „Auf Konto veröffentlichen“ ist kein Konto gewählt.',
    accountTwice: 'Ein Konto wird über mehrere Wege erreicht; jedes Konto kann pro Flow nur einmal vorkommen.',
    noTargets: 'Der Flow erreicht noch kein Konto.',
  },
});

export const postMessages = defineMessages({
  en: {
    flowGone: 'The selected flow no longer exists.',
    chooseAccount: 'Choose at least one account.',
    accountGone: 'One of the selected accounts no longer exists.',
    reconnect: 'Account needs to be reconnected.',
    postGone: 'This post no longer exists.',
    goingOut: 'This post is already going out, so it cannot be changed anymore.',
    pickTime: 'Please pick a date and time.',
  },
  de: {
    flowGone: 'Der gewählte Flow existiert nicht mehr.',
    chooseAccount: 'Wähle mindestens ein Konto.',
    accountGone: 'Eines der gewählten Konten existiert nicht mehr.',
    reconnect: 'Das Konto muss neu verbunden werden.',
    postGone: 'Diesen Beitrag gibt es nicht mehr.',
    goingOut: 'Dieser Beitrag wird schon veröffentlicht und kann nicht mehr geändert werden.',
    pickTime: 'Bitte wähle Datum und Uhrzeit.',
  },
});

export const userMessages = defineMessages({
  en: {
    passwordTooShort: (min: number) => `Use at least ${min} characters for your password.`,
    passwordTooLong: 'That password is too long.',
    resetExpired: 'This reset link has expired or was already used. Ask for a new one.',
    wrongPassword: 'Your current password is not right.',
    enterName: 'Please enter your name.',
  },
  de: {
    passwordTooShort: (min) => `Verwende mindestens ${min} Zeichen für dein Passwort.`,
    passwordTooLong: 'Dieses Passwort ist zu lang.',
    resetExpired: 'Dieser Link ist abgelaufen oder wurde schon benutzt. Fordere einen neuen an.',
    wrongPassword: 'Dein aktuelles Passwort stimmt nicht.',
    enterName: 'Bitte gib deinen Namen ein.',
  },
});

export const workspaceMessages = defineMessages({
  en: {
    manageMembers: 'Only workspace owners and admins can manage members.',
    changeOwners: 'Only owners can change owners.',
    enterName: 'Please give the workspace a name.',
    rename: 'Only workspace owners and admins can rename the workspace.',
    unknownRole: 'Unknown role.',
    notMember: 'This person is not a member of the workspace.',
    lastOwner: 'A workspace needs at least one owner. Make someone else owner first.',
    onlyOwnerLeaving: 'You are the only owner. Make someone else owner before you leave.',
    needsOwner: 'A workspace needs at least one owner.',
    invalidEmail: 'Please enter a valid email address, or leave it empty for a link.',
    revokeInvites: 'Only workspace owners and admins can revoke invites.',
    inviteExpired: 'This invite link has expired or was already used. Ask for a new one.',
  },
  de: {
    manageMembers: 'Nur Inhaber und Admins des Arbeitsbereichs können Mitglieder verwalten.',
    changeOwners: 'Nur Inhaber können Inhaber ändern.',
    enterName: 'Bitte gib dem Arbeitsbereich einen Namen.',
    rename: 'Nur Inhaber und Admins können den Arbeitsbereich umbenennen.',
    unknownRole: 'Unbekannte Rolle.',
    notMember: 'Diese Person ist kein Mitglied des Arbeitsbereichs.',
    lastOwner: 'Ein Arbeitsbereich braucht mindestens einen Inhaber. Mach zuerst jemand anderen zum Inhaber.',
    onlyOwnerLeaving: 'Du bist der einzige Inhaber. Mach jemand anderen zum Inhaber, bevor du gehst.',
    needsOwner: 'Ein Arbeitsbereich braucht mindestens einen Inhaber.',
    invalidEmail: 'Bitte gib eine gültige E-Mail-Adresse ein oder lass das Feld für einen Link leer.',
    revokeInvites: 'Nur Inhaber und Admins können Einladungen zurückziehen.',
    inviteExpired: 'Diese Einladung ist abgelaufen oder wurde schon benutzt. Bitte um eine neue.',
  },
});

export const mediaMessages = defineMessages({
  en: {
    largerThanAnnounced: 'The file is larger than announced.',
    notMedia: 'This file is not a supported image or video.',
    interrupted: 'The upload was interrupted. Please try again.',
    unsupportedType: 'Upload JPEG, PNG, GIF or WebP images, or MP4, MOV or WebM videos.',
    empty: 'The file is empty.',
    tooLarge: (p: { kind: 'image' | 'video'; limit: string }) => `${p.kind === 'image' ? 'Images' : 'Videos'} can be up to ${p.limit}.`,
  },
  de: {
    largerThanAnnounced: 'Die Datei ist größer als angekündigt.',
    notMedia: 'Diese Datei ist kein unterstütztes Bild oder Video.',
    interrupted: 'Der Upload wurde unterbrochen. Bitte versuch es noch einmal.',
    unsupportedType: 'Lade Bilder als JPEG, PNG, GIF oder WebP hoch, Videos als MP4, MOV oder WebM.',
    empty: 'Die Datei ist leer.',
    tooLarge: (p) => `${p.kind === 'image' ? 'Bilder' : 'Videos'} dürfen bis zu ${p.limit} groß sein.`,
  },
});

export const timeMessages = defineMessages({
  en: { retryIn: (minutes: number) => (minutes === 1 ? 'in a minute' : `in ${minutes} minutes`) },
  de: { retryIn: (minutes) => (minutes === 1 ? 'in einer Minute' : `in ${minutes} Minuten`) },
});

/** Why a CSS value or stylesheet was refused. */
export type UnsafeReason = 'lessThan' | 'backslash' | 'import' | 'remoteUrl' | 'fileReference' | 'script';

export const themeMessages = defineMessages({
  en: {
    add: (field: string) => `Add a “${field}”.`,
    tooLong: (p: { field: string; max: number }) => `“${p.field}” is too long (at most ${p.max} characters).`,
    tokensObject: (field: string) => `“${field}” must be an object of CSS variables.`,
    tooManyTokens: (p: { field: string; max: number }) => `“${p.field}” has too many tokens (at most ${p.max}).`,
    tokenName: (name: string) => `“${name}” is not a valid token name. Use lowercase letters, digits and dashes.`,
    cssValue: (name: string) => `“${name}” must be a CSS value like "#ffffff".`,
    cssValueLength: (p: { name: string; max: number }) => `“${p.name}” must be a CSS value of at most ${p.max} characters.`,
    singleValue: (name: string) => `“${name}” must be a single CSS value (no “;”, braces or comments).`,
    unsafe: (p: { name: string; reason: UnsafeReason }) =>
      `“${p.name}” ${
        {
          lessThan: 'must not contain “<”',
          backslash: 'must not contain backslash escapes — type the character itself',
          import: 'cannot import other files',
          remoteUrl: 'can only use data: URLs, not links to other sites',
          fileReference: 'can only reference files with url(data:…)',
          script: 'must not contain script',
        }[p.reason]
      }.`,
    canvasObject: '“canvas” must be an object.',
    canvasChoice: (p: { key: string; allowed: string }) => `“canvas.${p.key}” must be one of: ${p.allowed}.`,
    canvasNumber: (p: { key: string; min: number; max: number }) => `“canvas.${p.key}” must be a number from ${p.min} to ${p.max}.`,
    cssString: '“css” must be a string.',
    cssTooLong: (kb: number) => `“css” is too long (at most ${kb} KB).`,
    cssUnbalanced: '“css” has unbalanced { and }.',
    tooBig: (kb: number) => `This theme is too big (at most ${kb} KB).`,
    notJson: (reason: string) => `This is not valid JSON: ${reason}`,
    notObject: 'A theme must be a JSON object.',
    onlyThemes: 'Only theme plugins are supported. Set "kind": "theme".',
    idFormat: '“id” may only use lowercase letters, digits and dashes, like "my-theme".',
    missing: (p: { mode: string; names: string }) => `“${p.mode}” is missing ${p.names}.`,
    unmatched: (p: { mode: string; name: string; other: string }) => `“${p.mode}.${p.name}” has no ${p.other} value. Set it in “${p.other}” too, or move it to “base”.`,
    notBuiltin: 'This plugin does not ship with Postwerk.',
    builtinId: (id: string) => `“${id}” is the id of a built-in theme. Give your theme its own id, like "${id}-custom".`,
  },
  de: {
    add: (field) => `Ergänze „${field}“.`,
    tooLong: (p) => `„${p.field}“ ist zu lang (höchstens ${p.max} Zeichen).`,
    tokensObject: (field) => `„${field}“ muss ein Objekt mit CSS-Variablen sein.`,
    tooManyTokens: (p) => `„${p.field}“ hat zu viele Tokens (höchstens ${p.max}).`,
    tokenName: (name) => `„${name}“ ist kein gültiger Token-Name. Verwende Kleinbuchstaben, Ziffern und Bindestriche.`,
    cssValue: (name) => `„${name}“ muss ein CSS-Wert wie "#ffffff" sein.`,
    cssValueLength: (p) => `„${p.name}“ muss ein CSS-Wert mit höchstens ${p.max} Zeichen sein.`,
    singleValue: (name) => `„${name}“ muss ein einzelner CSS-Wert sein (ohne „;“, Klammern oder Kommentare).`,
    unsafe: (p) =>
      `„${p.name}“ ${
        {
          lessThan: 'darf kein „<“ enthalten',
          backslash: 'darf keine Backslash-Escapes enthalten – tippe das Zeichen direkt',
          import: 'kann keine anderen Dateien importieren',
          remoteUrl: 'darf nur data:-URLs verwenden, keine Links zu anderen Seiten',
          fileReference: 'kann Dateien nur mit url(data:…) einbinden',
          script: 'darf kein Skript enthalten',
        }[p.reason]
      }.`,
    canvasObject: '„canvas“ muss ein Objekt sein.',
    canvasChoice: (p) => `„canvas.${p.key}“ muss einer dieser Werte sein: ${p.allowed}.`,
    canvasNumber: (p) => `„canvas.${p.key}“ muss eine Zahl von ${p.min} bis ${p.max} sein.`,
    cssString: '„css“ muss ein Text sein.',
    cssTooLong: (kb) => `„css“ ist zu lang (höchstens ${kb} KB).`,
    cssUnbalanced: '„css“ hat unpaarige { und }.',
    tooBig: (kb) => `Dieses Design ist zu groß (höchstens ${kb} KB).`,
    notJson: (reason) => `Das ist kein gültiges JSON: ${reason}`,
    notObject: 'Ein Design muss ein JSON-Objekt sein.',
    onlyThemes: 'Nur Design-Plugins werden unterstützt. Setze "kind": "theme".',
    idFormat: '„id“ darf nur Kleinbuchstaben, Ziffern und Bindestriche enthalten, z. B. "mein-design".',
    missing: (p) => `In „${p.mode}“ fehlt ${p.names}.`,
    unmatched: (p) => `„${p.mode}.${p.name}“ hat keinen Wert für ${p.other}. Setze ihn auch in „${p.other}“ oder verschiebe ihn nach „base“.`,
    notBuiltin: 'Dieses Plugin gehört nicht zu Postwerk.',
    builtinId: (id) => `„${id}“ ist die ID eines eingebauten Designs. Gib deinem Design eine eigene ID, z. B. "${id}-eigenes".`,
  },
});

export const mailMessages = defineMessages({
  en: {
    orOpen: 'Or open this link:',
    greeting: (name: string) => `Hi ${name},`,
    verify: {
      subject: 'Confirm your email address',
      body: 'please confirm that this is your email address, so Postwerk can reach you about failed posts and password resets.',
      action: 'Confirm email address',
      footer: 'The link works for 3 days. If you did not sign up for Postwerk, ignore this email.',
    },
    reset: {
      subject: 'Reset your Postwerk password',
      body: 'someone (hopefully you) asked to reset your Postwerk password. Choose a new one here:',
      action: 'Choose a new password',
      footer: 'The link works for one hour and only once. If you did not ask for it, ignore this email — your password stays the same.',
    },
    invite: {
      subject: (p: { inviter: string; workspace: string }) => `${p.inviter} invited you to ${p.workspace} on Postwerk`,
      body: (p: { inviter: string; workspace: string; role: string }) =>
        `${p.inviter} invited you to plan and publish social media posts together in “${p.workspace}” as ${p.role}.`,
      action: (workspace: string) => `Join ${workspace}`,
      footer: 'The invite works once and expires in 7 days.',
    },
    /** How a role reads in "… as an admin". */
    roles: { owner: 'an owner', admin: 'an admin', editor: 'an editor' },
    failed: {
      subject: (partial: boolean): string => (partial ? 'A post was only partly published' : 'A post could not be published'),
      intro: (p: { partial: boolean; excerpt: string }) => `${p.partial ? 'Your post went out, but not everywhere' : 'Your post could not be published'}: “${p.excerpt}”`,
      advice: 'Reconnect the account if it asks for it, then post again.',
      action: 'Open the post',
      footer: (url: string) => `You get these emails because you wrote the post. Turn them off in your account settings: ${url}`,
    },
  },
  de: {
    orOpen: 'Oder öffne diesen Link:',
    greeting: (name) => `Hallo ${name},`,
    verify: {
      subject: 'Bestätige deine E-Mail-Adresse',
      body: 'bitte bestätige, dass das deine E-Mail-Adresse ist, damit Postwerk dich bei fehlgeschlagenen Beiträgen und zum Zurücksetzen des Passworts erreicht.',
      action: 'E-Mail-Adresse bestätigen',
      footer: 'Der Link gilt 3 Tage. Wenn du dich nicht bei Postwerk registriert hast, ignoriere diese E-Mail.',
    },
    reset: {
      subject: 'Setze dein Postwerk-Passwort zurück',
      body: 'jemand (hoffentlich du) möchte dein Postwerk-Passwort zurücksetzen. Wähle hier ein neues:',
      action: 'Neues Passwort wählen',
      footer: 'Der Link gilt eine Stunde und nur einmal. Wenn du das nicht warst, ignoriere diese E-Mail – dein Passwort bleibt unverändert.',
    },
    invite: {
      subject: (p) => `${p.inviter} hat dich zu ${p.workspace} auf Postwerk eingeladen`,
      body: (p) => `${p.inviter} hat dich eingeladen, in „${p.workspace}“ gemeinsam Social-Media-Beiträge zu planen und zu veröffentlichen, als ${p.role}.`,
      action: (workspace) => `${workspace} beitreten`,
      footer: 'Die Einladung funktioniert einmal und läuft nach 7 Tagen ab.',
    },
    roles: { owner: 'Inhaber', admin: 'Admin', editor: 'Bearbeiter' },
    failed: {
      subject: (partial) => (partial ? 'Ein Beitrag wurde nur teilweise veröffentlicht' : 'Ein Beitrag konnte nicht veröffentlicht werden'),
      intro: (p) => `${p.partial ? 'Dein Beitrag ist rausgegangen, aber nicht überall' : 'Dein Beitrag konnte nicht veröffentlicht werden'}: „${p.excerpt}“`,
      advice: 'Verbinde das Konto neu, falls es danach fragt, und poste dann noch einmal.',
      action: 'Beitrag öffnen',
      footer: (url) => `Du bekommst diese E-Mails, weil du den Beitrag geschrieben hast. Du kannst sie in deinen Kontoeinstellungen abschalten: ${url}`,
    },
  },
});
