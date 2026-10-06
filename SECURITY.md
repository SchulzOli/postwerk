# Security policy

Postwerk stores access tokens for people's social media accounts, so we take security reports seriously.

## Reporting a vulnerability

Please **do not open a public issue**. Report it privately instead:

- on GitHub: [Security → Report a vulnerability](https://github.com/SchulzOli/postwerk/security/advisories/new)

Include what you found, how to reproduce it, and what an attacker could do with it. You'll get an answer within a week. Once a fix is released we credit you in the advisory, unless you'd rather stay anonymous.

## Supported versions

Postwerk has no releases yet; fixes go to `main`. Self-hosters should update to the latest `main` (or the latest image) when an advisory is published.

## Good to know when you self-host

- Keep `ENCRYPTION_KEY` secret and backed up: it encrypts every stored account token.
- Run the web app behind HTTPS and set `APP_URL` to the public address.
- The proxy in front of Postwerk should set `X-Forwarded-For`; per-IP sign-in limits rely on it.
