# Pushfront

Pushfront is a persistent autobattler. Public GitHub commits, accepted pull requests, and code reviews raise soldiers that fight on a shared battlefield. [DESIGN.md](DESIGN.md) holds the rules and the architecture.

## Run locally

Requirements: Node 22 or later, and pnpm.

1. Install dependencies.

   ```sh
   pnpm install
   ```

2. Copy the example environment and fill in what you need.

   ```sh
   cp .env.example .env
   ```

3. Start the server and the client.

   ```sh
   pnpm dev
   ```

   Open http://localhost:5173. The Vite dev server proxies `/api`, `/auth`, and `/ws` to the game server on port 8787.

### Try it without GitHub

Set `DEMO_PLAYERS=40` to seed 40 fictional players with synthetic histories. Every 20 seconds or so, one of them gains a synthetic contribution, so you can watch contributions become reinforcements. Demo players exist only while this variable is set when the database is created.

Set `ROUND_HOURS=0.25` and `INTERMISSION_MINUTES=1` to watch a full round end, finalize, and restart within minutes.

### Try it with real GitHub data

Set `GITHUB_TOKEN` to a token that can read public data. Set `DEV_AUTH=1` and visit `http://localhost:5173/auth/dev?login=<github login>` to sign in as that user through the server token, without OAuth. Dev auth refuses to start in production.

For the real sign-in flow, create a GitHub OAuth app with the callback URL `${PUBLIC_URL}/auth/github/callback` and set `GITHUB_CLIENT_ID` and `GITHUB_CLIENT_SECRET`. Pushfront requests no scopes. It uses the sign-in token once to read the account id and then discards it.

## Environment

| Variable | Default | Purpose |
| --- | --- | --- |
| `GITHUB_TOKEN` | unset | Server token for GraphQL reads. Without it, ingestion is disabled. |
| `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET` | unset | OAuth app for sign-in. |
| `PUBLIC_URL` | `http://localhost:5173` | Origin browsers use. Builds the OAuth callback and redirects. |
| `SESSION_SECRET` | random per boot | HMAC key for the session cookie. Required, 32+ characters, in production. |
| `PORT`, `HOST` | `8787`, `0.0.0.0` | Listen address. |
| `DATABASE_PATH` | `data/pushfront.db` | SQLite file. Use a persistent volume in production. |
| `CLIENT_DIR` | `dist/client` | Built client served with SPA fallback when present. |
| `DEV_AUTH` | `0` | Enables `/auth/dev?login=`. |
| `DEMO_PLAYERS` | `0` | Number of synthetic players to seed. |
| `ROUND_HOURS` | `168` | Round length. |
| `INTERMISSION_MINUTES` | `60` | Pause between rounds. |

## Test

```sh
pnpm vitest run
pnpm tsc --noEmit
```

## Deploy

Pushfront runs as one Fly.io machine with a volume mounted at `/data`.

```sh
fly volumes create pushfront_data --size 1
fly secrets set GITHUB_TOKEN=... GITHUB_CLIENT_ID=... GITHUB_CLIENT_SECRET=... SESSION_SECRET=... PUBLIC_URL=https://<app>.fly.dev
fly deploy
```

On `SIGTERM` the server writes a final snapshot and closes the database. On boot it replays the input log from the latest snapshot to the wall-clock tick, so a restart loses no battle state.
