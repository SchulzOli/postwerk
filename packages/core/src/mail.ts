import { createTransport } from 'nodemailer';

export interface Mail {
  to: string;
  subject: string;
  text: string;
  html: string;
}

export type MailTransport = (mail: Mail & { from: string }) => Promise<void>;

type Env = Record<string, string | undefined>;

/** Whether real email is configured (SMTP_URL). Without it, emails are written to the server log. */
export function isMailConfigured(env: Env = process.env): boolean {
  return Boolean(env.SMTP_URL?.trim());
}

function defaultTransport(env: Env): MailTransport {
  const url = env.SMTP_URL?.trim();
  if (!url) {
    // Self-hosters without SMTP can still find reset and invite links in the log.
    return async (mail) => {
      console.log(`[mail] SMTP_URL is not set, so this email was not sent.\nTo: ${mail.to}\nSubject: ${mail.subject}\n\n${mail.text}\n`);
    };
  }
  const smtp = createTransport(url);
  return async (mail) => {
    await smtp.sendMail(mail);
  };
}

let transport: MailTransport | undefined;

/** Replaces how mail is delivered (tests, custom setups); `undefined` restores the default. */
export function setMailTransport(next: MailTransport | undefined): void {
  transport = next;
}

export function mailFrom(env: Env = process.env): string {
  return env.MAIL_FROM?.trim() || 'Postwerk <postwerk@localhost>';
}

/** Sends an email; throws when the SMTP server rejects it. */
export async function sendMail(mail: Mail, env: Env = process.env): Promise<void> {
  transport ??= defaultTransport(env);
  await transport({ ...mail, from: mailFrom(env) });
}

/** Sends an email but only logs failures, for messages that must not break what the user is doing. */
export async function trySendMail(mail: Mail): Promise<boolean> {
  try {
    await sendMail(mail);
    return true;
  } catch (error) {
    console.error(`[mail] sending "${mail.subject}" failed:`, (error as Error).message);
    return false;
  }
}
