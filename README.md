# Twofold

Twofold is a private composer for publishing one text post to X and LinkedIn. It supports shared copy, a tailored version for each network, live previews, encrypted OAuth tokens, and a separate result for each destination.

The first release handles text and links. It does not schedule posts, watch one network for new posts, or upload media.

## Run Twofold locally

1. Install Node.js 22.13 or newer.
2. Install the dependencies:

   ```sh
   npm ci
   ```

3. Copy `.env.example` to `.env.local`.
4. Generate a token-encryption key:

   ```sh
   openssl rand -base64 48
   ```

5. Put the generated value in `TOKEN_ENCRYPTION_KEY` in `.env.local`.
6. Add the X and LinkedIn credentials from the sections below.
7. Generate and apply the local database migration:

   ```sh
   npm run db:generate
   npm run build
   node --import ./scripts/sites-env.mjs ./node_modules/wrangler/bin/wrangler.js d1 execute DB --local --config dist/server/wrangler.json --persist-to .wrangler/state --file drizzle/0000_light_nebula.sql
   ```

8. Start the app:

   ```sh
   npm run dev
   ```

9. Open `http://localhost:5173/signin-with-chatgpt?return_to=/`.

The local sign-in returns you to the composer. Connect both accounts before you publish.

## Create the X app

1. Create a project and app in the [X Developer Portal](https://developer.x.com/en/portal/dashboard).
2. Enable OAuth 2.0.
3. Select a web app as the app type.
4. Give the app read and write access.
5. Add this local callback URL:

   ```text
   http://localhost:5173/api/oauth/x/callback
   ```

6. Add the production callback URL after deployment:

   ```text
   https://YOUR-SITE.example/api/oauth/x/callback
   ```

7. Put the OAuth 2.0 client ID and client secret in `X_CLIENT_ID` and `X_CLIENT_SECRET`.

Twofold requests `tweet.read`, `tweet.write`, `users.read`, and `offline.access`. Your X developer plan must allow `POST /2/tweets`.

## Create the LinkedIn app

1. Create an app in the [LinkedIn Developer Portal](https://www.linkedin.com/developers/apps).
2. Add the **Sign in with LinkedIn using OpenID Connect** product.
3. Add the **Share on LinkedIn** product.
4. Add this local redirect URL on the **Auth** tab:

   ```text
   http://localhost:5173/api/oauth/linkedin/callback
   ```

5. Add the production redirect URL after deployment:

   ```text
   https://YOUR-SITE.example/api/oauth/linkedin/callback
   ```

6. Put the client ID and client secret in `LINKEDIN_CLIENT_ID` and `LINKEDIN_CLIENT_SECRET`.
7. Keep `LINKEDIN_VERSION=202608` until you update the app to a newer supported LinkedIn API version.

Twofold requests `openid`, `profile`, and `w_member_social`.

## Configure the hosted app

Set these server-side values in the Sites environment settings. Mark every value except `LINKEDIN_VERSION` as a secret.

- `TOKEN_ENCRYPTION_KEY`
- `X_CLIENT_ID`
- `X_CLIENT_SECRET`
- `LINKEDIN_CLIENT_ID`
- `LINKEDIN_CLIENT_SECRET`
- `LINKEDIN_VERSION`

Do not put production secrets in `.env.example`, Git, or browser code.

## How publishing works

Twofold stores account connections under the signed-in ChatGPT user ID. It encrypts access and refresh tokens with AES-GCM before it writes them to D1. The browser never receives a provider token.

The publish route validates both versions before it calls either network. It sends the X and LinkedIn requests concurrently and returns one outcome for each network. Twofold does not retry a create-post request automatically because an uncertain retry can create a duplicate post.

## Recommended next releases

Build the next releases in this order:

1. Add image upload with R2, then implement each provider's media-upload flow.
2. Add a post history that stores provider post IDs and URLs.
3. Add scheduling with durable jobs and idempotency keys.
4. Add an optional sync rule that watches X and forwards new posts to LinkedIn.

Keep analytics and team features out unless you start using them. They add screens and data retention without making the core posting flow more reliable.

## Useful commands

- `npm run dev` starts the local composer.
- `npm run build` creates the Cloudflare Worker build.
- `npm run lint` runs ESLint.
- `npm run db:generate` creates a migration from `db/schema.ts`.

The design rationale and module map are in [`docs/architecture.md`](docs/architecture.md).
