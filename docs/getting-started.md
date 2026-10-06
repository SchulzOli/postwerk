# Getting started

## Run it on your server

Requirements: Docker with Compose, a domain, and a reverse proxy with https (for example Caddy or Traefik).

```bash
git clone https://github.com/SchulzOli/postwerk.git
cd postwerk
cp .env.example .env
```

In `.env`, set at least:

- `ENCRYPTION_KEY`: `openssl rand -base64 32`. It encrypts the stored access to social accounts; never change it later, or every account must reconnect.
- `POSTGRES_PASSWORD`: a password for the bundled database.
- `APP_URL`: your public address, for example `https://postwerk.example.com`, without a trailing slash.
- `OPERATOR_NAME` and `OPERATOR_EMAIL`: who runs the server. They turn on the [about and legal pages](legal.md) the networks ask for.

Then start everything:

```bash
docker compose --profile app up -d --build
```

This starts Postgres, runs the database migrations, and launches the web app on port 3000 and the publishing worker. Point your reverse proxy at port 3000. The proxy should set `X-Forwarded-For`: sign-in limits per IP address rely on it.

Open `APP_URL`, sign up (you get your own workspace and can invite others), and connect a network.

## Choose your networks

Mastodon, Bluesky, Telegram and Discord work right away. For the others, decide per network: your own developer app, the Zernio bridge, or not at all. [Choose how to offer each network](networks/index.md) explains the options; the canvas shows the same for each network.

## Try it with the sandbox

`ENABLE_SANDBOX=true` adds a fake network called Sandbox. Connect a Sandbox account and schedule a post; put `#fail` or `#flaky` in the text to see how Postwerk handles errors and retries.

## Develop Postwerk

Requirements: Node 22 or newer, Docker.

```bash
npm install
cp .env.example .env
sed -i "s|^ENCRYPTION_KEY=.*|ENCRYPTION_KEY=$(openssl rand -base64 32)|" .env
npm run services:up        # Postgres on localhost:5432
docker compose exec postgres psql -U postwerk -c "CREATE DATABASE postwerk_test"   # for tests
npm run db:migrate
npm run dev                # web on http://localhost:3000 + worker
```

Before a pull request, run `npm run typecheck && npm test && npm run build`. See [CONTRIBUTING.md](https://github.com/SchulzOli/postwerk/blob/main/CONTRIBUTING.md).

The documentation website lives in `docs/`: `cd docs && npm install && npm run dev`.
