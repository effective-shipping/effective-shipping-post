# Effective Shipping Post

ES Post is an open-source, self-hosted composer for publishing text and links to X and your personal LinkedIn profile. Write shared copy or tailor each version, check the previews, then publish to the selected accounts. Run it locally when you need it, or host your own password-protected instance.

Drafts save in your browser. Provider tokens stay encrypted in Cloudflare D1. Each network returns its own result. Successful and unconfirmed destinations are deselected to prevent duplicate posts when you retry a failed destination.

## Run locally

No hosting or Cloudflare account is required for local use. The development server runs Cloudflare's D1 emulator on your computer and stores its SQLite database under `.wrangler/state/v3/d1/`. Connections and staged drafts persist across restarts. Draft edits in the composer save separately in your browser.

1. Install Node.js 22.18 or newer.
2. Clone the repository, install dependencies, and prepare the local settings and database:

   ```sh
   git clone https://github.com/effective-shipping/effective-shipping-post.git
   cd effective-shipping-post
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

You can edit drafts without provider credentials. Publishing requires a connected account. To post on X without a developer app, choose **Post on X.com** in the X preview. It opens X's own composer with your text, costs nothing, and deselects X in ES Post so the post is not sent twice. Press ⌘+Enter or Ctrl+Enter in the editor to publish. Running `setup:local` again preserves your existing secrets and applies only pending migrations.

After the first setup, run `npm run dev` whenever you want to use the app. Stop it with Ctrl+C when finished. Publishing and connecting accounts require internet access, but the app does not need to stay running after a post is published.

To back up local connections and staged drafts, stop the app and copy `.wrangler/state/` together with `.env.local` to a private backup location. The encryption key in `.env.local` is needed to read saved connection tokens. Browser draft edits are not included in that backup.

## Draft posts from your coding agent

ES Post includes an MCP server and a `post` skill for Claude Code and Codex. When a session turns up something worth sharing, invoke the skill, optionally followed by an angle: `/post` in Claude Code, or `$post` in Codex. Codex has no custom slash commands, so `/post` is unrecognized there. The agent drafts a post from the session and stages it in ES Post. ES Post opens in your browser, already signed in, so you can edit and publish. Agents can stage drafts but cannot publish them.

The draft link signs your browser in once and expires after 10 minutes. After that, it opens the draft in a signed-in browser and otherwise asks for your password.

Other MCP clients work without the skill. Ask the agent to tweet or post about something, or use the server's `post` prompt. The drafting rules live in the `stage_post` tool description.

1. Complete [Run locally](#run-locally). `setup:local` also generates the `API_TOKEN` that the MCP server uses.
2. Install the skill and register the MCP server for each agent CLI on your machine:

   ```sh
   npm run setup:agent
   ```

3. Start a new agent session and run `/post` in Claude Code or `$post` in Codex.

If ES Post is not running, the MCP server starts it on `http://localhost:5173` and leaves it running for your review. Its log is `.wrangler/es-post-app.log`. To stop it, run `kill $(cat .wrangler/es-post-app.pid)`.

To set your tone, write `~/.es-post/voice.md` in your own words. The MCP server adds it to the drafting rules when a session starts.

To use another ES Post instance, set `ES_POST_URL` and `ES_POST_API_TOKEN` in the MCP server's environment. The MCP server needs Node.js 22.18 or newer because it runs TypeScript directly.

## Configure X

1. Create an app in the [X Developer Portal](https://developer.x.com/en/portal/dashboard).
2. Enable OAuth 2.0 for a confidential web app with read and write access.
3. Register `http://localhost:5173/api/oauth/x/callback` as a callback URL.
4. If you deploy the app, also register your deployed origin followed by `/api/oauth/x/callback`. Skip this for local use.
5. Set `X_CLIENT_ID` and `X_CLIENT_SECRET` in `.env.local`.

ES Post requests `tweet.read`, `tweet.write`, `users.read`, and `offline.access`. Your API plan must allow `POST /2/tweets`. The editor and server use X's official `twitter-text` library for [weighted character counting](https://docs.x.com/fundamentals/counting-characters).

## Configure LinkedIn

1. Create an app in the [LinkedIn Developer Portal](https://www.linkedin.com/developers/apps).
2. Enable **Sign in with LinkedIn using OpenID Connect** and **Share on LinkedIn**.
3. Register `http://localhost:5173/api/oauth/linkedin/callback` on the **Auth** tab.
4. If you deploy the app, also register your deployed origin followed by `/api/oauth/linkedin/callback`. Skip this for local use.
5. Set `LINKEDIN_CLIENT_ID` and `LINKEDIN_CLIENT_SECRET` in `.env.local`.
6. Set `LINKEDIN_VERSION` to a supported monthly API version. The default is `202608`.

ES Post requests `openid`, `profile`, and `w_member_social`. It publishes through the [Posts API](https://learn.microsoft.com/en-us/linkedin/marketing/community-management/shares/posts-api) and escapes punctuation using LinkedIn's [little text format](https://learn.microsoft.com/en-us/linkedin/marketing/community-management/shares/little-text-format).

After adding credentials, restart `npm run dev`, open **Accounts**, and connect LinkedIn. You can include links directly in the post text. Automatic follow-up comments are not implemented and require separate LinkedIn comment permissions.

## Configure hosting

The project supports Sites and a direct Cloudflare Worker deployment. Register the callback URLs against the origin you use.

For Sites, use your own project ID in `.openai/hosting.json`. Set `APP_PASSWORD`, `TOKEN_ENCRYPTION_KEY`, `API_TOKEN`, `X_CLIENT_ID`, `X_CLIENT_SECRET`, `LINKEDIN_CLIENT_ID`, and `LINKEDIN_CLIENT_SECRET` as server secrets. Set `LINKEDIN_VERSION` as a plain environment value. Keep the `DB` binding in `.openai/hosting.json`. Sites applies packaged migrations during deployment.

For direct Cloudflare hosting, create your own D1 database and replace the placeholder database ID in `wrangler.direct.jsonc`. Set `database_name` to your database's name. The example config uses the default Worker URL; add a custom domain only if you need one. Set each secret with `npx wrangler secret put KEY --config wrangler.direct.jsonc`, then run:

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

## Contributing

Open an issue with a reproducible bug or proposed change, or send a pull request. Run the checks above before submitting code. Keep credentials, local databases, and personal drafts out of commits and issue reports. Use `.env.example` to document new settings without including real values.

## License

[MIT](LICENSE). Vendored code keeps its original notices in [build/sites-vite-plugin.LICENSE](build/sites-vite-plugin.LICENSE) and [vendor/shadcn-tailwind-4.13.0.LICENSE.md](vendor/shadcn-tailwind-4.13.0.LICENSE.md).
