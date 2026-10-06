import { defineMessages } from '@postwerk/core/i18n';

/**
 * Words used all over the app. Each area has its own catalog next to this one
 * (auth, account, team, posts, canvas, …). German uses "du".
 *
 * Glossary: post → Beitrag · account (social) → Konto · network → Netzwerk ·
 * workspace → Arbeitsbereich · owner/admin/editor → Inhaber/Admin/Bearbeiter ·
 * flow → Flow · step → Schritt · theme → Design · canvas → Canvas ·
 * schedule → planen · publish → veröffentlichen · media → Medien.
 */
export const commonMessages = defineMessages({
  en: {
    /** Browser tab titles. */
    title: (page: string) => `${page} · Postwerk`,
    nav: {
      canvas: 'Canvas',
      posts: 'Posts',
      calendar: 'Calendar',
      accounts: 'Accounts',
      team: 'Team',
      activity: 'Activity',
      listView: 'List view',
    },
    status: { draft: 'Draft', scheduled: 'Scheduled', publishing: 'Publishing', published: 'Published', partial: 'Partly published', failed: 'Failed' },
    /** A network's state within a post, shown after the account ("— published"). */
    targetStatus: { pending: 'pending', publishing: 'publishing', published: 'published', failed: 'failed' },
    roles: { owner: 'Owner', admin: 'Admin', editor: 'Editor' },
    reconnectNeeded: 'Reconnect needed',
    mediaOnly: '(media only)',
    removedAccount: 'Removed account',
    save: 'Save',
    saving: 'Saving…',
    cancel: 'Cancel',
    delete: 'Delete',
    edit: 'Edit',
    close: 'Close',
    dismiss: 'Dismiss',
    copyLink: 'Copy link',
    copied: 'Copied',
    somethingWrong: 'Something went wrong. Please try again.',
    mode: { label: 'Color mode', light: 'Light', system: 'Same as system', dark: 'Dark' },
    language: { label: 'Language', automatic: 'Same as browser' },
  },
  de: {
    title: (page) => `${page} · Postwerk`,
    nav: {
      canvas: 'Canvas',
      posts: 'Beiträge',
      calendar: 'Kalender',
      accounts: 'Konten',
      team: 'Team',
      activity: 'Aktivität',
      listView: 'Listenansicht',
    },
    status: { draft: 'Entwurf', scheduled: 'Geplant', publishing: 'Wird veröffentlicht', published: 'Veröffentlicht', partial: 'Teilweise veröffentlicht', failed: 'Fehlgeschlagen' },
    targetStatus: { pending: 'wartet', publishing: 'wird veröffentlicht', published: 'veröffentlicht', failed: 'fehlgeschlagen' },
    roles: { owner: 'Inhaber', admin: 'Admin', editor: 'Bearbeiter' },
    reconnectNeeded: 'Neu verbinden nötig',
    mediaOnly: '(nur Medien)',
    removedAccount: 'Entferntes Konto',
    save: 'Speichern',
    saving: 'Speichert…',
    cancel: 'Abbrechen',
    delete: 'Löschen',
    edit: 'Bearbeiten',
    close: 'Schließen',
    dismiss: 'Ausblenden',
    copyLink: 'Link kopieren',
    copied: 'Kopiert',
    somethingWrong: 'Etwas ist schiefgelaufen. Bitte versuch es noch einmal.',
    mode: { label: 'Farbmodus', light: 'Hell', system: 'Wie das System', dark: 'Dunkel' },
    language: { label: 'Sprache', automatic: 'Wie der Browser' },
  },
});
