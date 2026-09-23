# Twofold architecture

Twofold posts directly to the selected networks. A private two-network composer needs independent delivery results, but it does not need a queue until scheduling becomes a requirement.

## Authentication and connections

`lib/auth.ts` reads the encrypted HttpOnly session cookie and checks its expiry and password fingerprint. The session belongs to the single `personal` account. The login page posts a native form to `app/api/session`, which compares password hashes, sets the cookie, and redirects. The form works before the page hydrates, so the password never reaches a URL. `POST /logout` clears the cookie. Changing the configured password invalidates existing sessions.

Each provider's OAuth cookie carries encrypted state, the personal account ID, an expiry, and a PKCE verifier. The callback checks all of these before exchanging the code. Provider-specific cookie names let X and LinkedIn connections start independently.

`lib/connections.ts` stores access and refresh tokens encrypted with AES-GCM in D1, keyed by user ID and provider. `app/api/connections` reports each network as connected, disconnected, or unconfigured. The browser receives only account names and handles, plus the callback URL to register when app credentials are missing. Tokens refresh before expiry when the provider grants a refresh token. An expired connection without a usable refresh token requires reconnection.

## Drafts and delivery

`app/composer.tsx` owns the editor, previews, browser storage, and account controls. `lib/draft.ts` defines the saved draft shape and updates selections after delivery. Tailoring preserves the complete copy. It never truncates a message to fit a network.

`lib/text.ts` gives the editor and server the same character rules. X uses the official weighted counter. LinkedIn uses a 3,000-character limit, and its HTTP adapter escapes reserved punctuation before sending plain text.

`lib/domain.ts` parses publish requests before either network receives a create request. `app/api/posts` calls `lib/providers.ts` concurrently through Effect and returns one result per destination:

- `published` includes the provider's post URL.
- `failed` means delivery was rejected or could not start. It includes a message and whether to reconnect.
- `uncertain` means delivery may have happened, but a transport error or incomplete response prevented confirmation.

The editor locks while publishing. It deselects successful and uncertain destinations, retains the draft, and leaves rejected destinations selected for retry. After a retry, it keeps the other destination's earlier result visible. If the entire response is lost, both destinations are deselected and the user must check the feeds before trying again. Once no destination has failed, **Start a new post** clears the draft and selects both networks.

Create requests have a 20-second timeout and no automatic retries. A server-side queue would need durable delivery records and provider-specific duplicate prevention before it could safely change that policy.

## Agent drafts

Coding agents reach Twofold through `mcp/server.ts`, a stdio MCP server with one tool, `stage_post`. The tool sends the draft to `POST /api/drafts` with the `API_TOKEN` bearer token. The route stores it in the D1 `drafts` table and returns an editor link. The server exposes no publish tool. Publishing stays a browser action by the signed-in person.

`/?draft=<id>` loads the staged draft through `GET /api/drafts/<id>`, which requires the browser session, and then removes the ID from the address bar. If the staged draft replaces unpublished text, the notice offers to restore it. After loading, the draft lives in browser storage like any other.

The HTTP API is the boundary between agents and delivery. A self-hosted MCP server starts the local app on demand. A hosted Twofold would issue a token per user and map it to that user in `getApiUserId`, without changing the MCP server or the editor. The `/tweet` skill in `skills/tweet` holds the drafting guidance, and `npm run setup:agent` links it for each agent CLI.

## Runtime

Vinext builds React server and client code for Cloudflare Workers. The Sites build plugin stages hosting metadata and Drizzle migrations alongside the Worker. `wrangler.local.jsonc` uses the same local D1 ID as the development server, while `wrangler.direct.jsonc` configures the direct production deployment.

The Node regression tests check character rules, retry selections, staged drafts, and the MCP server over stdio against a stand-in Twofold. The smoke script exercises the actual running app, session cookies, and D1 without sending live posts.
