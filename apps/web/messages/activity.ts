import type { AuditAction } from '@postwerk/core';
import { defineMessages } from '@postwerk/core/i18n';

/** What an activity phrase can mention. */
export interface ActivityParams {
  target: string | null;
  /** The raw role from the audit details ("editor"), or whatever was stored. */
  role: string;
  /** Network name ("Bluesky") of a connected or disconnected account. */
  network: string | null;
  /** A new post was scheduled rather than published right away. */
  scheduled: boolean;
}

type Phrases = Record<AuditAction, (p: ActivityParams) => string>;

const enRoles: Record<string, string> = { owner: 'owner', admin: 'admin', editor: 'editor' };
const deRoles: Record<string, string> = { owner: 'Inhaber', admin: 'Admin', editor: 'Bearbeiter' };

// Audit rows keep these English placeholders as their target (see team actions).
const INVITE_LINK = 'an invite link';
const A_MEMBER = 'a member';
const deTarget = (target: string | null) => (target === A_MEMBER ? 'ein Mitglied' : target);

/** The activity log page and the sentences of the activity feed ("Anna" + phrase). */
export const activityMessages = defineMessages({
  en: {
    pageTitle: 'Activity',
    editorsOnly: 'Only workspace owners and admins can see the activity log.',
    newest: 'Newest',
    older: 'Older',
    nothing: (older: boolean) => `Nothing ${older ? 'older' : 'yet'}.`,
    /** Who, when the user was deleted or is unknown. */
    someone: 'Someone',
    /** What happened, as the rest of a sentence that starts with who did it. */
    phrases: {
      'user.signed_up': () => 'signed up',
      'login.succeeded': () => 'signed in',
      'login.failed': (p) => `failed to sign in${p.target ? ` as ${p.target}` : ''}`,
      'login.blocked': (p) => `was blocked after too many failed sign-ins${p.target ? ` as ${p.target}` : ''}`,
      'password.changed': () => 'changed their password',
      'password.reset_requested': () => 'asked for a password reset link',
      'password.reset': () => 'reset their password',
      'email.verified': () => 'verified their email address',
      'workspace.created': (p) => `created the workspace “${p.target}”`,
      'workspace.renamed': (p) => `renamed the workspace to “${p.target}”`,
      'member.invited': (p) => `invited ${p.target ?? 'someone'} as ${enRoles[p.role] ?? 'member'}`,
      'invite.revoked': (p) => `revoked the invite for ${p.target ?? 'a link'}`,
      'member.joined': (p) => `joined as ${enRoles[p.role] ?? 'member'}`,
      'member.role_changed': (p) => `made ${p.target} ${enRoles[p.role] ?? 'a member'}`,
      'member.removed': (p) => `removed ${p.target} from the workspace`,
      'member.left': () => 'left the workspace',
      'account.connected': (p) => `connected ${p.target}${p.network ? ` on ${p.network}` : ''}`,
      'account.disconnected': (p) => `disconnected ${p.target}${p.network ? ` on ${p.network}` : ''}`,
      'flow.created': (p) => `created the flow “${p.target}”`,
      'flow.deleted': (p) => `deleted the flow “${p.target}”`,
      'post.created': (p) => `${p.scheduled ? 'scheduled' : 'published'} “${p.target}”`,
      'post.updated': (p) => `edited “${p.target}”`,
      'post.deleted': (p) => `deleted “${p.target}”`,
      'post.retried': (p) => `retried “${p.target}”`,
      'plugin.installed': (p) => `installed the ${p.target} theme`,
      'plugin.uninstalled': (p) => `uninstalled the ${p.target} theme`,
    } satisfies Phrases as Phrases,
  },
  de: {
    pageTitle: 'Aktivität',
    editorsOnly: 'Nur Inhaber und Admins des Arbeitsbereichs sehen das Aktivitätsprotokoll.',
    newest: 'Neueste',
    older: 'Ältere',
    nothing: (older) => (older ? 'Nichts Älteres.' : 'Noch nichts.'),
    someone: 'Jemand',
    phrases: {
      'user.signed_up': () => 'hat sich registriert',
      'login.succeeded': () => 'hat sich angemeldet',
      'login.failed': (p) => `konnte sich nicht${p.target ? ` als ${p.target}` : ''} anmelden`,
      'login.blocked': (p) => `wurde nach zu vielen fehlgeschlagenen Anmeldungen${p.target ? ` als ${p.target}` : ''} gesperrt`,
      'password.changed': () => 'hat das Passwort geändert',
      'password.reset_requested': () => 'hat einen Link zum Zurücksetzen des Passworts angefordert',
      'password.reset': () => 'hat das Passwort zurückgesetzt',
      'email.verified': () => 'hat die E-Mail-Adresse bestätigt',
      'workspace.created': (p) => `hat den Arbeitsbereich „${p.target}“ erstellt`,
      'workspace.renamed': (p) => `hat den Arbeitsbereich in „${p.target}“ umbenannt`,
      'member.invited': (p) =>
        p.target === INVITE_LINK
          ? `hat einen Einladungslink mit der Rolle ${deRoles[p.role] ?? 'Mitglied'} erstellt`
          : `hat ${p.target ?? 'jemanden'} als ${deRoles[p.role] ?? 'Mitglied'} eingeladen`,
      'invite.revoked': (p) => (p.target && p.target !== INVITE_LINK ? `hat die Einladung für ${p.target} zurückgezogen` : 'hat einen Einladungslink zurückgezogen'),
      'member.joined': (p) => `ist als ${deRoles[p.role] ?? 'Mitglied'} beigetreten`,
      'member.role_changed': (p) => `hat ${deTarget(p.target)} zum ${deRoles[p.role] ?? 'Mitglied'} gemacht`,
      'member.removed': (p) => `hat ${deTarget(p.target)} aus dem Arbeitsbereich entfernt`,
      'member.left': () => 'hat den Arbeitsbereich verlassen',
      'account.connected': (p) => `hat ${p.target}${p.network ? ` auf ${p.network}` : ''} verbunden`,
      'account.disconnected': (p) => `hat die Verbindung zu ${p.target}${p.network ? ` auf ${p.network}` : ''} getrennt`,
      'flow.created': (p) => `hat den Flow „${p.target}“ erstellt`,
      'flow.deleted': (p) => `hat den Flow „${p.target}“ gelöscht`,
      'post.created': (p) => `hat „${p.target}“ ${p.scheduled ? 'geplant' : 'veröffentlicht'}`,
      'post.updated': (p) => `hat „${p.target}“ bearbeitet`,
      'post.deleted': (p) => `hat „${p.target}“ gelöscht`,
      'post.retried': (p) => `hat „${p.target}“ erneut versucht`,
      'plugin.installed': (p) => `hat das Design ${p.target} installiert`,
      'plugin.uninstalled': (p) => `hat das Design ${p.target} deinstalliert`,
    },
  },
});
