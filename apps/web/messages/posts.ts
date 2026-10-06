import { defineMessages } from '@postwerk/core/i18n';

/** The post list, the new/edit post pages and their server actions. */
export const postsMessages = defineMessages({
  en: {
    pageTitle: 'Posts',
    refresh: 'Refresh',
    newPost: 'New post',
    empty: 'Nothing here yet. Write your first post.',
    retryFailed: 'Retry failed',
    postAgain: 'Post again',
    // New / edit
    connectFirst: 'Connect a social account first.',
    connectAccount: 'Connect an account',
    editPost: 'Edit post',
    cannotEdit: 'This post cannot be edited',
    cannotEditWhy: 'It is already going out, or it was deleted.',
    backToPosts: 'Back to posts',
    // Server actions
    pickDateTime: 'Please pick a date and time.',
    scheduledInPast: 'The scheduled time is in the past.',
    cannotEditAnymore: 'This post cannot be edited anymore.',
    calendarLoadFailed: 'The calendar could not load. Reload the page and try again.',
    pickFuture: 'Pick a time in the future.',
  },
  de: {
    pageTitle: 'Beiträge',
    refresh: 'Aktualisieren',
    newPost: 'Neuer Beitrag',
    empty: 'Noch nichts da. Schreib deinen ersten Beitrag.',
    retryFailed: 'Fehlgeschlagene wiederholen',
    postAgain: 'Erneut veröffentlichen',
    connectFirst: 'Verbinde zuerst ein Social-Media-Konto.',
    connectAccount: 'Konto verbinden',
    editPost: 'Beitrag bearbeiten',
    cannotEdit: 'Dieser Beitrag kann nicht bearbeitet werden',
    cannotEditWhy: 'Er wird schon veröffentlicht oder wurde gelöscht.',
    backToPosts: 'Zurück zu den Beiträgen',
    pickDateTime: 'Bitte wähle Datum und Uhrzeit.',
    scheduledInPast: 'Der geplante Zeitpunkt liegt in der Vergangenheit.',
    cannotEditAnymore: 'Dieser Beitrag kann nicht mehr bearbeitet werden.',
    calendarLoadFailed: 'Der Kalender konnte nicht geladen werden. Lade die Seite neu und versuch es noch einmal.',
    pickFuture: 'Wähle einen Zeitpunkt in der Zukunft.',
  },
});
