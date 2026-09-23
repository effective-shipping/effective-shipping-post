# Twofold

Twofold is a private composer for publishing text and links to X and LinkedIn. Write shared copy or tailor each version, check the previews, then publish to the selected accounts.

Drafts save in your browser. Provider tokens stay encrypted in Cloudflare D1. Each network returns its own result. Successful and unconfirmed destinations are deselected to prevent duplicate posts when you retry a failed destination.

## Run locally

1. Install Node.js 22.18 or newer.
2. Install dependencies and prepare the local settings and database:

   ```sh
   npm ci
   npm run setup:local
   ```

3. Open `.env.local` and copy the generated `APP_PASSWORD` for sign-in. Add your provider credentials using the guides below.
4. Start the app:

   ```sh
   npm run dev
   ```

5. Open `http://localhost:5173` and sign in with your personal password.
6. Connect X, LinkedIn, or both under **Accounts**. A network without app credentials shows its setup steps and the exact callback URL to register.

You can edit drafts without provider credentials. Publishing requires a connected account. Press ⌘+Enter or Ctrl+Enter in the editor to publish. Running `setup:local` again preserves your existing secrets and applies only pending migrations.

## Draft posts from your coding agent

Twofold includes an MCP server and a `tweet` skill for Claude Code and Codex. When a session turns up something worth sharing, invoke the skill, optionally followed by an angle: `/tweet` in Claude Code, or `$tweet` in Codex. Codex has no custom slash commands, so `/tweet` is unrecognized there. The agent drafts a post from the session and stages it in Twofold. Twofold opens in your browser so you can edit and publish. Agents can stage drafts but cannot publish them.

1. Complete [Run locally](#run-locally). `setup:local` also generates the `API_TOKEN` that the MCP server uses.
2. Install the skill and register the MCP server for each agent CLI on your machine:

   ```sh
   npm run setup:agent
   ```

3. Start a new agent session and run `/tweet` in Claude Code or `$tweet` in Codex.

If Twofold is not running, the MCP server starts it on `http://localhost:5173` and leaves it running for your review. Its log is `.wrangler/twofold-app.log`. To stop it, run `kill $(cat .wrangler/twofold-app.pid)`.

To set your tone, write `~/.twofold/voice.md` in your own words. The skill reads it before drafting.

To use another Twofold instance, set `TWOFOLD_URL` and `TWOFOLD_API_TOKEN` in the MCP server's environment. The MCP server needs Node.js 22.18 or newer because it runs TypeScript directly.

## Configure X

1. Create an app in the [X Developer Portal](https://developer.x.com/en/portal/dashboard).
2. Enable OAuth 2.0 for a confidential web app with read and write access.
3. Register `http://localhost:5173/api/oauth/x/callback` as a callback URL.
4. Register your deployed origin followed by `/api/oauth/x/callback` as the production callback.
5. Set `X_CLIENT_ID` and `X_CLIENT_SECRET` in `.env.local`.

Twofold requests `tweet.read`, `tweet.write`, `users.read`, and `offline.access`. Your API plan must allow `POST /2/tweets`. The editor and server use X's official `twitter-text` library for [weighted character counting](https://docs.x.com/fundamentals/counting-characters).

## Configure LinkedIn

1. Create an app in the [LinkedIn Developer Portal](https://www.linkedin.com/developers/apps).
2. Enable **Sign in with LinkedIn using OpenID Connect** and **Share on LinkedIn**.
3. Register `http://localhost:5173/api/oauth/linkedin/callback` on the **Auth** tab.
4. Register your deployed origin followed by `/api/oauth/linkedin/callback` as the production redirect.
5. Set `LINKEDIN_CLIENT_ID` and `LINKEDIN_CLIENT_SECRET` in `.env.local`.
6. Set `LINKEDIN_VERSION` to a supported monthly API version. The default is `202608`.

Twofold requests `openid`, `profile`, and `w_member_social`. It publishes through the [Posts API](https://learn.microsoft.com/en-us/linkedin/marketing/community-management/shares/posts-api) and escapes punctuation using LinkedIn's [little text format](https://learn.microsoft.com/en-us/linkedin/marketing/community-management/shares/little-text-format).

## Configure hosting

The project supports Sites and a direct Cloudflare Worker deployment. Register the callback URLs against the origin you use.

For Sites, set `APP_PASSWORD`, `TOKEN_ENCRYPTION_KEY`, `API_TOKEN`, `X_CLIENT_ID`, `X_CLIENT_SECRET`, `LINKEDIN_CLIENT_ID`, and `LINKEDIN_CLIENT_SECRET` as server secrets. Set `LINKEDIN_VERSION` as a plain environment value. Keep the `DB` binding in `.openai/hosting.json`. Sites applies packaged migrations during deployment.

For direct Cloudflare hosting, update the database ID and custom domain in `wrangler.direct.jsonc`. Create the D1 database if needed. Set each secret with `npx wrangler secret put KEY --config wrangler.direct.jsonc`, then run:

```sh
npm run db:migrate:cloudflare
npm run deploy:cloudflare
```

Keep the encryption key stable to preserve saved connections. Changing `APP_PASSWORD` invalidates existing sessions. Secrets belong in ignored environment files or hosting settings.

## Verify changes

Run the regression checks, type check, lint, and build:

```sh
npm test
npm run typecheck
npm run lint
npm run build
npm run test:worker
```

The Worker check runs the compiled app against an isolated D1 database and simulated provider responses. It checks OAuth, token encryption and refresh, independent publishing results, and unconfirmed deliveries.

With the development server running, use `npm run test:smoke` to exercise login, D1 reads, protected routes, invalid publish requests, and logout. These checks never send a live post. To check the production build locally, run `npm start -- --port 5174`, then `npm run test:smoke -- http://127.0.0.1:5174`.

The release supports text and links. Scheduling, media uploads, and automatic cross-posting are outside its scope. See [the architecture](docs/architecture.md) for module ownership and delivery behavior.
