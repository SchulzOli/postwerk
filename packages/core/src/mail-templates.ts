import type { Locale } from './i18n';
import type { Mail } from './mail';
import { mailMessages } from './messages';

export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!);
}

interface Message {
  subject: string;
  /** Paragraphs of plain text; each becomes a <p>. */
  lines: string[];
  action?: { label: string; url: string };
  /** Small print under the button. */
  footer?: string;
  locale: Locale;
}

/** One plain, readable layout for every email, with a text version for clients that want it. */
function render(to: string, message: Message): Mail {
  const text = [
    ...message.lines,
    ...(message.action ? [`${message.action.label}: ${message.action.url}`] : []),
    ...(message.footer ? ['', message.footer] : []),
  ].join('\n\n');
  const paragraphs = message.lines.map((line) => `<p style="margin:0 0 14px">${escapeHtml(line)}</p>`).join('');
  const button = message.action
    ? `<p style="margin:22px 0"><a href="${escapeHtml(message.action.url)}" style="background:#3b5bdb;color:#ffffff;padding:11px 18px;border-radius:8px;text-decoration:none;font-weight:600;display:inline-block">${escapeHtml(message.action.label)}</a></p>
<p style="margin:0 0 14px;font-size:13px;color:#5d6470">${escapeHtml(mailMessages[message.locale].orOpen)} <a href="${escapeHtml(message.action.url)}" style="color:#3b5bdb;word-break:break-all">${escapeHtml(message.action.url)}</a></p>`
    : '';
  const footer = message.footer ? `<p style="margin:22px 0 0;font-size:13px;color:#5d6470">${escapeHtml(message.footer)}</p>` : '';
  const html = `<!doctype html><html lang="${message.locale}"><body style="margin:0;background:#f6f7f9;padding:24px;font:15px/1.5 system-ui,-apple-system,'Segoe UI',sans-serif;color:#16181d">
<div style="max-width:520px;margin:0 auto;background:#ffffff;border:1px solid #dfe3e8;border-radius:12px;padding:28px">
<p style="margin:0 0 18px;font-weight:700;font-size:17px">Postwerk</p>${paragraphs}${button}${footer}
</div></body></html>`;
  return { to, subject: message.subject, text, html };
}

export function verifyEmailMail(to: string, name: string, url: string, locale: Locale = 'en'): Mail {
  const m = mailMessages[locale];
  return render(to, {
    locale,
    subject: m.verify.subject,
    lines: [m.greeting(name), m.verify.body],
    action: { label: m.verify.action, url },
    footer: m.verify.footer,
  });
}

export function resetPasswordMail(to: string, name: string, url: string, locale: Locale = 'en'): Mail {
  const m = mailMessages[locale];
  return render(to, {
    locale,
    subject: m.reset.subject,
    lines: [m.greeting(name), m.reset.body],
    action: { label: m.reset.action, url },
    footer: m.reset.footer,
  });
}

export function inviteMail(to: string, input: { inviter: string; workspace: string; role: 'owner' | 'admin' | 'editor'; url: string }, locale: Locale = 'en'): Mail {
  const m = mailMessages[locale];
  return render(to, {
    locale,
    subject: m.invite.subject(input),
    lines: [m.invite.body({ ...input, role: m.roles[input.role] })],
    action: { label: m.invite.action(input.workspace), url: input.url },
    footer: m.invite.footer,
  });
}

export function postFailedMail(
  to: string,
  input: { name: string; excerpt: string; partial: boolean; failures: { account: string; error: string }[]; url: string; settingsUrl: string },
  locale: Locale = 'en',
): Mail {
  const m = mailMessages[locale];
  return render(to, {
    locale,
    subject: m.failed.subject(input.partial),
    lines: [
      m.greeting(input.name),
      m.failed.intro(input),
      ...input.failures.map((failure) => `• ${failure.account}: ${failure.error}`),
      m.failed.advice,
    ],
    action: { label: m.failed.action, url: input.url },
    footer: m.failed.footer(input.settingsUrl),
  });
}
