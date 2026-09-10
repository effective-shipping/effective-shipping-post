# Twofold architecture

## Phase tracker

- [x] Ground: greenfield project, so there is no existing posting flow to preserve.
- [x] Sketch: compare direct-request publishing with a queued worker design.
- [x] Agree: proceed with the smaller direct-request design.
- [x] Implement: the interfaces below use real OAuth and provider calls.
- [ ] Scrap: only needed if provider APIs force durable job state.

## Caller usage

```ts
const request = PublishRequest.parse(await httpRequest.json())
const session = await providerSession.read(httpRequest)
const result = await publisher.publish(request, session)
return Response.json(result)
```

The browser sends one message and the selected destinations. The server validates it once, posts to each connected network independently, and returns one result for each network. A LinkedIn failure must not hide a successful X post, or the reverse.

## Candidate A: direct fan-out

```ts
type Provider = "x" | "linkedin"

type DestinationResult =
  | { readonly kind: "published"; readonly provider: Provider; readonly postUrl: string }
  | { readonly kind: "failed"; readonly provider: Provider; readonly message: string }

type Publisher = {
  readonly publish: (request: PublishRequest, session: ProviderSession) => Effect.Effect<
    ReadonlyArray<DestinationResult>
  >
}
```

Modules:

- `app/composer.tsx` owns editable UI state and renders network previews.
- `app/api/oauth/[provider]` starts and completes provider OAuth.
- `app/api/connections` reports and removes connections.
- `app/api/posts` validates one publish request and fans out to providers.
- `lib/session.ts` encrypts provider tokens into an HttpOnly cookie.
- `lib/providers.ts` contains the X and LinkedIn HTTP adapters.
- `lib/domain.ts` owns schemas and result types.

## Candidate B: durable queue

The browser would create a draft record, enqueue one delivery per provider, and poll delivery status. This shape supports scheduling and automatic retries, but it needs a database, a queue, idempotency records, cleanup rules, and an operations view.

## Synthesis decision

Use candidate A. Twofold is a private, two-network tool, and direct fan-out keeps the product small. Effect provides typed error handling and controlled concurrency without introducing a database. If scheduling or automatic cross-posting becomes a real requirement, candidate B can replace the `Publisher` implementation while the request and result types stay stable.
