import type { Mail } from './mail';

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
<p style="margin:0 0 14px;font-size:13px;color:#5d6470">Or open this link: <a href="${escapeHtml(message.action.url)}" style="color:#3b5bdb;word-break:break-all">${escapeHtml(message.action.url)}</a></p>`
    : '';
  const footer = message.footer ? `<p style="margin:22px 0 0;font-size:13px;color:#5d6470">${escapeHtml(message.footer)}</p>` : '';
  const html = `<!doctype html><html><body style="margin:0;background:#f6f7f9;padding:24px;font:15px/1.5 system-ui,-apple-system,'Segoe UI',sans-serif;color:#16181d">
<div style="max-width:520px;margin:0 auto;background:#ffffff;border:1px solid #dfe3e8;border-radius:12px;padding:28px">
<p style="margin:0 0 18px;font-weight:700;font-size:17px">Postwerk</p>${paragraphs}${button}${footer}
</div></body></html>`;
  return { to, subject: message.subject, text, html };
}

export function verifyEmailMail(to: string, name: string, url: string): Mail {
  return render(to, {
    subject: 'Confirm your email address',
    lines: [`Hi ${name},`, 'please confirm that this is your email address, so Postwerk can reach you about failed posts and password resets.'],
    action: { label: 'Confirm email address', url },
    footer: 'The link works for 3 days. If you did not sign up for Postwerk, ignore this email.',
  });
}

export function resetPasswordMail(to: string, name: string, url: string): Mail {
  return render(to, {
    subject: 'Reset your Postwerk password',
    lines: [`Hi ${name},`, 'someone (hopefully you) asked to reset your Postwerk password. Choose a new one here:'],
    action: { label: 'Choose a new password', url },
    footer: 'The link works for one hour and only once. If you did not ask for it, ignore this email — your password stays the same.',
  });
}

export function inviteMail(to: string, input: { inviter: string; workspace: string; role: string; url: string }): Mail {
  return render(to, {
    subject: `${input.inviter} invited you to ${input.workspace} on Postwerk`,
    lines: [`${input.inviter} invited you to plan and publish social media posts together in “${input.workspace}” as ${input.role}.`],
    action: { label: `Join ${input.workspace}`, url: input.url },
    footer: 'The invite works once and expires in 7 days.',
  });
}

export function postFailedMail(
  to: string,
  input: { name: string; excerpt: string; partial: boolean; failures: { account: string; error: string }[]; url: string; settingsUrl: string },
): Mail {
  return render(to, {
    subject: input.partial ? 'A post was only partly published' : 'A post could not be published',
    lines: [
      `Hi ${input.name},`,
      `${input.partial ? 'Your post went out, but not everywhere' : 'Your post could not be published'}: “${input.excerpt}”`,
      ...input.failures.map((failure) => `• ${failure.account}: ${failure.error}`),
      'Reconnect the account if it asks for it, then post again.',
    ],
    action: { label: 'Open the post', url: input.url },
    footer: `You get these emails because you wrote the post. Turn them off in your account settings: ${input.settingsUrl}`,
  });
}
