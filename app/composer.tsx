"use client";

import { Fragment, useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { ArrowUpRight, Check, Copy, LoaderCircle, LockKeyhole, LogOut, PenLine, Send, Trash2, XCircle } from "lucide-react";
import { z } from "zod";

import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Kbd } from "@/components/ui/kbd";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import {
  AccountSchema,
  ProviderSchema,
  PublishResponseSchema,
  type Account,
  type DestinationResult,
  type Provider,
} from "@/lib/domain";
import { applyDeliveryResults, createDraft, DRAFT_KEY, DraftIdSchema, draftHasText, DraftSchema, type Draft } from "@/lib/draft";
import { countPostCharacters, hasLink, POST_LIMITS, postTextIsValid, previewSegments, xComposerUrl } from "@/lib/text";

const providers = ["x", "linkedin"] satisfies ReadonlyArray<Provider>;
const ErrorResponseSchema = z.object({ error: z.string() });

const StagedDraftResponseSchema = z.object({ draft: DraftSchema });

const AccountsResponseSchema = z.object({
  accounts: z.array(AccountSchema),
});

const StageCrosspostSchema = z.object({
  message: z.string().trim().min(1).max(3000),
  providers: z.array(ProviderSchema).min(1).max(2).refine((items) => new Set(items).size === items.length),
});

type ConnectionState =
  | { readonly kind: "loading" }
  | { readonly kind: "ready"; readonly accounts: ReadonlyArray<Account> }
  | { readonly kind: "unavailable"; readonly message: string };

type PublishState =
  | { readonly kind: "idle" }
  | { readonly kind: "publishing" }
  | { readonly kind: "complete"; readonly results: ReadonlyArray<DestinationResult> }
  | { readonly kind: "error"; readonly message: string };

type Notice =
  | { readonly kind: "message"; readonly text: string }
  | { readonly kind: "staged"; readonly previous: Draft | null };

type StoredDraft =
  | { readonly kind: "found"; readonly draft: Draft }
  | { readonly kind: "none" }
  | { readonly kind: "unreadable" };

type StagedDraft =
  | { readonly kind: "found"; readonly draft: Draft }
  | { readonly kind: "missing" }
  | { readonly kind: "failed" };

// The first reason the selected destinations cannot be published, in the order the user should fix them.
type Readiness =
  | { readonly kind: "no-destination" }
  | { readonly kind: "empty"; readonly provider: Provider }
  | { readonly kind: "over-limit"; readonly provider: Provider; readonly over: number }
  | { readonly kind: "invalid"; readonly provider: Provider }
  | { readonly kind: "checking-accounts" }
  | { readonly kind: "accounts-unavailable"; readonly message: string }
  | { readonly kind: "not-connected"; readonly providers: ReadonlyArray<Provider> }
  | { readonly kind: "ready" };

type SetupGuide = {
  readonly portal: { readonly label: string; readonly href: string };
  readonly steps: ReadonlyArray<string>;
  readonly callbackStep: string;
  readonly secrets: readonly [string, string];
};

const setupGuides = {
  x: {
    portal: { label: "X Developer Portal", href: "https://developer.x.com/en/portal/dashboard" },
    steps: ["In User authentication settings, choose Read and write, and Web App."],
    callbackStep: "Add this callback URL:",
    secrets: ["X_CLIENT_ID", "X_CLIENT_SECRET"],
  },
  linkedin: {
    portal: { label: "LinkedIn Developers", href: "https://www.linkedin.com/developers/apps" },
    steps: ["Add the Sign In with LinkedIn using OpenID Connect and Share on LinkedIn products."],
    callbackStep: "On the Auth tab, add this redirect URL:",
    secrets: ["LINKEDIN_CLIENT_ID", "LINKEDIN_CLIENT_SECRET"],
  },
} satisfies Record<Provider, SetupGuide>;

function providerLabel(provider: Provider): string {
  return provider === "x" ? "X" : "LinkedIn";
}

function listLabel(items: ReadonlyArray<Provider>): string {
  return items.map(providerLabel).join(" and ");
}

export function Composer({ displayName }: { readonly displayName: string }) {
  const [draft, setDraft] = useState<Draft>(() => createDraft());
  const [draftLoaded, setDraftLoaded] = useState(false);
  const [draftSaved, setDraftSaved] = useState(false);
  const [connections, setConnections] = useState<ConnectionState>({ kind: "loading" });
  const [publishState, setPublishState] = useState<PublishState>({ kind: "idle" });
  const [notice, setNotice] = useState<Notice | null>(null);
  const [disconnecting, setDisconnecting] = useState<Provider | null>(null);
  const publishing = useRef(false);
  const busy = publishState.kind === "publishing";

  const selectedProviders = useMemo(
    () => providers.filter((provider) => draft.selection[provider]),
    [draft.selection],
  );
  const textFor = (provider: Provider): string => draft.tailored ? draft[provider] : draft.shared;
  const readiness = publishReadiness({ selectedProviders, textFor, connections });
  const canPublish = draftLoaded && readiness.kind === "ready" && !busy && disconnecting === null;
  const initials = displayName.split(/\s+/u).filter(Boolean).slice(0, 2).map((part) => part[0]?.toUpperCase()).join("") || "ME";

  useEffect(() => {
    let cancelled = false;
    const stagedId = DraftIdSchema.safeParse(new URLSearchParams(window.location.search).get("draft"));
    if (stagedId.success) window.history.replaceState({}, "", window.location.pathname);
    void (async () => {
      const stored = readStoredDraft();
      const staged = stagedId.success ? await fetchStagedDraft(stagedId.data) : null;
      if (cancelled) return;
      const current = stored.kind === "found" ? stored.draft : null;
      if (staged?.kind === "found") {
        // Keep an unpublished draft recoverable when the staged one replaces it.
        const replaced = current && draftHasText(current) && JSON.stringify(current) !== JSON.stringify(staged.draft);
        setDraft(staged.draft);
        setNotice({ kind: "staged", previous: replaced ? current : null });
      } else {
        if (current) setDraft(current);
        if (staged?.kind === "missing") setNotice(message("That staged draft is no longer available."));
        if (staged?.kind === "failed") setNotice(message("Twofold could not load the staged draft. Open the link again."));
        if (stored.kind === "unreadable") setNotice(message("This browser could not restore your draft. Keep a copy before leaving."));
      }
      setDraftLoaded(true);
    })();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!draftLoaded) return;
    let saved = false;
    try {
      window.localStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
      saved = true;
    } catch {
      // The editor remains usable when browser storage is blocked or full.
    }
    queueMicrotask(() => setDraftSaved(saved));
  }, [draft, draftLoaded]);

  useEffect(() => {
    void loadConnections();
    const parameters = new URLSearchParams(window.location.search);
    const noticeCode = parameters.get("notice");
    const provider = ProviderSchema.safeParse(parameters.get("provider"));
    queueMicrotask(() => {
      if (noticeCode === "connected" && provider.success) {
        setNotice(message(`${providerLabel(provider.data)} is connected.`));
      } else if (noticeCode === "configure" && provider.success) {
        setNotice(message(`Add your ${providerLabel(provider.data)} app credentials before you connect.`));
      } else if (noticeCode === "oauth-failed") {
        setNotice(message("The account connection did not finish. Check the callback URL and try again."));
      }
    });
    if (noticeCode) window.history.replaceState({}, "", window.location.pathname);
  }, []);

  useEffect(() => {
    const context = document.modelContext;
    if (!context?.registerTool) return;
    const lifecycle = new AbortController();
    const registration = context.registerTool(
      {
        name: "stage_crosspost",
        title: "Stage a cross-post",
        description: "Put draft text into Twofold and select X, LinkedIn, or both. This does not publish it.",
        inputSchema: {
          type: "object",
          properties: {
            message: { type: "string", minLength: 1, maxLength: 3000 },
            providers: { type: "array", items: { type: "string", enum: ["x", "linkedin"] }, minItems: 1, maxItems: 2, uniqueItems: true },
          },
          required: ["message", "providers"],
          additionalProperties: false,
        },
        annotations: { readOnlyHint: false, untrustedContentHint: false },
        execute(input) {
          if (publishing.current) throw new Error("Wait for publishing to finish before replacing the draft.");
          const staged = StageCrosspostSchema.parse(input);
          setDraft(createDraft(staged.message, staged.providers));
          setPublishState({ kind: "idle" });
          return { staged: true, providers: staged.providers, requiresPublishConfirmation: true };
        },
      },
      { signal: lifecycle.signal },
    );
    void Promise.resolve(registration).catch(() => {
      lifecycle.abort();
    });
    return () => lifecycle.abort();
  }, []);

  async function loadConnections(): Promise<void> {
    try {
      const response = await fetch("/api/connections", { cache: "no-store", signal: AbortSignal.timeout(15_000) });
      const body: unknown = await response.json().catch(() => null);
      if (response.status === 401) { window.location.assign("/login"); return; }
      if (!response.ok) throw new Error("Accounts are unavailable. Try checking again.");
      setConnections({ kind: "ready", accounts: AccountsResponseSchema.parse(body).accounts });
    } catch (error) {
      setConnections({ kind: "unavailable", message: error instanceof Error ? error.message : "Accounts are unavailable." });
    }
  }

  function updateShared(value: string): void {
    setDraft((current) => ({ ...current, shared: value, x: value, linkedin: value }));
    setPublishState({ kind: "idle" });
  }

  function updateProvider(provider: Provider, value: string): void {
    setDraft((current) => ({ ...current, [provider]: value }));
    setPublishState({ kind: "idle" });
  }

  function toggleProvider(provider: Provider, checked: boolean): void {
    setDraft((current) => ({ ...current, selection: { ...current.selection, [provider]: checked } }));
    setPublishState({ kind: "idle" });
  }

  function toggleTailored(checked: boolean): void {
    setDraft((current) => ({
      ...current,
      tailored: checked,
    }));
    setPublishState({ kind: "idle" });
  }

  async function publish(): Promise<void> {
    if (publishing.current || !canPublish) return;
    publishing.current = true;
    const previousResults = publishState.kind === "complete" ? publishState.results : [];
    setPublishState({ kind: "publishing" });
    try {
      const destinations = selectedProviders.map((provider) => ({ provider, text: textFor(provider) }));
      const response = await fetch("/api/posts", {
        signal: AbortSignal.timeout(45_000),
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ destinations }),
      });
      const body: unknown = await response.json().catch(() => null);
      if (!response.ok) {
        if (response.status >= 500) throw new Error("Delivery could not be confirmed. Check both feeds before publishing again.");
        const error = ErrorResponseSchema.safeParse(body);
        setPublishState({ kind: "error", message: error.success ? error.data.error : "Twofold could not publish this draft." });
        return;
      }
      const results = PublishResponseSchema.parse(body).results;
      if (results.length !== selectedProviders.length || new Set(results.map((result) => result.provider)).size !== selectedProviders.length || results.some((result) => !selectedProviders.includes(result.provider))) {
        throw new Error("Delivery could not be confirmed. Check both feeds before publishing again.");
      }
      setDraft((current) => applyDeliveryResults(current, results));
      setPublishState({ kind: "complete", results: [...previousResults.filter((old) => !results.some((result) => result.provider === old.provider)), ...results] });
    } catch {
      setDraft((current) => ({ ...current, selection: { x: false, linkedin: false } }));
      setPublishState({ kind: "error", message: "Delivery could not be confirmed. Check both feeds before publishing again." });
    } finally {
      publishing.current = false;
    }
  }

  async function disconnect(provider: Provider): Promise<void> {
    if (busy || disconnecting) return;
    setDisconnecting(provider);
    try {
      const response = await fetch(`/api/connections?provider=${provider}`, { method: "DELETE", signal: AbortSignal.timeout(15_000) });
      if (!response.ok) throw new Error("The account could not be disconnected. Try again.");
      await loadConnections();
      setNotice(message(`${providerLabel(provider)} is disconnected.`));
    } catch (error) {
      setNotice(message(error instanceof Error ? error.message : "The account could not be disconnected. Try again."));
    } finally {
      setDisconnecting(null);
    }
  }

  function clearDraft(): void {
    setDraft((current) => ({ ...current, shared: "", x: "", linkedin: "" }));
    setPublishState({ kind: "idle" });
  }

  function restoreDraft(previous: Draft): void {
    setDraft(previous);
    setNotice(null);
    setPublishState({ kind: "idle" });
  }

  // The person finishes in X's composer, so deselect X here to keep the next Publish from posting it twice.
  function handOffToX(): void {
    setDraft((current) => ({ ...current, selection: { ...current.selection, x: false } }));
    setPublishState({ kind: "idle" });
    setNotice(message("Finish posting in the X tab. X is deselected here so it is not posted twice."));
  }

  function startNewPost(): void {
    setDraft(createDraft());
    setPublishState({ kind: "idle" });
  }

  const editorProps = { onSubmit: () => void publish(), onClear: clearDraft } as const;

  return (
    <div className="app-shell">
      <header className="topbar">
        <span className="brand"><span className="brand-mark">2F</span><span>Twofold</span></span>
        <form method="post" action="/logout">
          <Button type="submit" variant="ghost" size="sm" className="sign-out"><LogOut /> Sign out</Button>
        </form>
      </header>

      {notice && <NoticeBanner notice={notice} onDismiss={() => setNotice(null)} onRestore={restoreDraft} />}

      <main className="workspace">
        <section className="composer-column" aria-labelledby="composer-heading">
          <div className="section-heading">
            <h1 id="composer-heading"><PenLine aria-hidden="true" /> New post</h1>
            <span className="draft-status" role="status">{!draftLoaded ? "Loading draft…" : draftSaved ? "Saved on this device" : "Not saved. Keep a copy."}</span>
          </div>

          <div className="paper-card composer-card">
            <fieldset className="composer-controls" disabled={busy || !draftLoaded}>
              <div className="destination-row">
                <span className="field-label">Publish to</span>
                <div className="destination-list">
                  {providers.map((provider) => (
                    <label className="destination-chip" key={provider}>
                      <NetworkIcon provider={provider} />
                      <span>{providerLabel(provider)}</span>
                      <Switch aria-label={`Publish to ${providerLabel(provider)}`} checked={draft.selection[provider]} onCheckedChange={(checked) => toggleProvider(provider, checked)} />
                    </label>
                  ))}
                </div>
              </div>

              {!draft.tailored ? (
                <Editor label="Post text" value={draft.shared} counters={selectedProviders.length ? selectedProviders : providers} onChange={updateShared} {...editorProps} />
              ) : (
                <div className="tailored-editors">
                  <Editor label="X version" value={draft.x} counters={["x"]} onChange={(value) => updateProvider("x", value)} {...editorProps} />
                  <Editor label="LinkedIn version" value={draft.linkedin} counters={["linkedin"]} onChange={(value) => updateProvider("linkedin", value)} onSubmit={editorProps.onSubmit} />
                </div>
              )}

              <label className="tailor-row">
                <span><strong>Tailor each version</strong><small>Write a short X post and a longer LinkedIn version.</small></span>
                <Switch aria-label="Tailor each version" checked={draft.tailored} onCheckedChange={toggleTailored} />
              </label>

              <div className="publish-row">
                <PublishHint readiness={readiness} tailored={draft.tailored} onRetryAccounts={() => void loadConnections()} />
                <Button type="button" size="lg" className="publish-button" disabled={!canPublish} onClick={() => void publish()}>
                  {busy ? <LoaderCircle className="spin" /> : <Send />}
                  {busy ? "Publishing…" : publishLabel(selectedProviders)}
                  {!busy && <Kbd className="publish-shortcut">⌘ ↵</Kbd>}
                </Button>
              </div>
            </fieldset>
            <PublishResult state={publishState} onStartNewPost={startNewPost} />
          </div>
        </section>

        <aside className="preview-column" aria-labelledby="preview-heading">
          <h2 id="preview-heading" className="column-heading">Preview</h2>
          <div className="preview-stack">
            {selectedProviders.map((provider) => (
              <FeedPreview key={provider} provider={provider} message={textFor(provider)} displayName={displayName} initials={initials} account={accountFor(connections, provider)} onPostOnX={handOffToX} disabled={busy} />
            ))}
            {selectedProviders.length === 0 && <div className="empty-preview">Choose a network to see its preview.</div>}
          </div>
          <section id="accounts" className="connections-card" aria-labelledby="connections-heading">
            <h2 id="connections-heading" className="column-heading">Accounts</h2>
            {providers.map((provider) => <AccountRow key={provider} provider={provider} state={connections} onDisconnect={disconnect} disabled={busy || disconnecting !== null} disconnecting={disconnecting === provider} />)}
          </section>
        </aside>
      </main>
    </div>
  );
}

function message(text: string): Notice {
  return { kind: "message", text };
}

function readStoredDraft(): StoredDraft {
  try {
    const stored = window.localStorage.getItem(DRAFT_KEY);
    if (!stored) return { kind: "none" };
    const parsed = DraftSchema.safeParse(JSON.parse(stored));
    if (parsed.success) return { kind: "found", draft: parsed.data };
    window.localStorage.removeItem(DRAFT_KEY);
    return { kind: "none" };
  } catch {
    return { kind: "unreadable" };
  }
}

async function fetchStagedDraft(id: string): Promise<StagedDraft> {
  try {
    const response = await fetch(`/api/drafts/${id}`, { cache: "no-store", signal: AbortSignal.timeout(15_000) });
    if (response.status === 404) return { kind: "missing" };
    if (!response.ok) return { kind: "failed" };
    return { kind: "found", draft: StagedDraftResponseSchema.parse(await response.json()).draft };
  } catch {
    return { kind: "failed" };
  }
}

function NoticeBanner(props: { readonly notice: Notice; readonly onDismiss: () => void; readonly onRestore: (previous: Draft) => void }) {
  const notice = props.notice;
  return (
    <div className="notice-banner" role="status">
      {notice.kind === "message" ? <span>{notice.text}</span> : (
        <span>
          Your agent staged this draft. Nothing is published until you choose Publish.
          {notice.previous && <button type="button" className="text-button" onClick={() => notice.previous && props.onRestore(notice.previous)}>Restore previous draft</button>}
        </span>
      )}
      <button type="button" onClick={props.onDismiss} aria-label="Dismiss notice">×</button>
    </div>
  );
}

function publishReadiness(args: {
  readonly selectedProviders: ReadonlyArray<Provider>;
  readonly textFor: (provider: Provider) => string;
  readonly connections: ConnectionState;
}): Readiness {
  if (args.selectedProviders.length === 0) return { kind: "no-destination" };
  for (const provider of args.selectedProviders) {
    const text = args.textFor(provider);
    if (!text.trim()) return { kind: "empty", provider };
    if (!postTextIsValid(provider, text)) {
      const over = countPostCharacters(provider, text) - POST_LIMITS[provider];
      return over > 0 ? { kind: "over-limit", provider, over } : { kind: "invalid", provider };
    }
  }
  if (args.connections.kind === "loading") return { kind: "checking-accounts" };
  if (args.connections.kind === "unavailable") return { kind: "accounts-unavailable", message: args.connections.message };
  const state = args.connections;
  const missing = args.selectedProviders.filter((provider) => accountFor(state, provider)?.status !== "connected");
  if (missing.length) return { kind: "not-connected", providers: missing };
  return { kind: "ready" };
}

function publishLabel(selected: ReadonlyArray<Provider>): string {
  if (selected.length === 1) return `Publish to ${providerLabel(selected[0])}`;
  return selected.length === 2 ? "Publish to both" : "Publish";
}

function Editor(props: {
  readonly label: string;
  readonly value: string;
  readonly counters: ReadonlyArray<Provider>;
  readonly onChange: (value: string) => void;
  readonly onSubmit: () => void;
  readonly onClear?: () => void;
}) {
  const id = useId();
  const over = props.value.trim().length > 0 && props.counters.some((provider) => !postTextIsValid(provider, props.value));

  function submitOnShortcut(event: KeyboardEvent<HTMLTextAreaElement>): void {
    if (event.key !== "Enter" || !(event.metaKey || event.ctrlKey)) return;
    event.preventDefault();
    props.onSubmit();
  }

  return (
    <div className="writing-area">
      <label className="editor-label" htmlFor={id}>{props.label}</label>
      <Textarea id={id} aria-invalid={over} aria-describedby={`${id}-count`} className="post-textarea" value={props.value} onChange={(event) => props.onChange(event.target.value)} onKeyDown={submitOnShortcut} placeholder="What do you want to share?" />
      <div className="writing-toolbar">
        <span id={`${id}-count`} className="character-counts">
          {props.counters.map((provider) => <CharacterCount key={provider} provider={provider} value={props.value} labelled={props.counters.length > 1} />)}
        </span>
        {props.onClear && <Button type="button" variant="ghost" size="sm" onClick={props.onClear} disabled={!props.value}><Trash2 /> Clear</Button>}
      </div>
    </div>
  );
}

function CharacterCount(props: { readonly provider: Provider; readonly value: string; readonly labelled: boolean }) {
  const over = props.value.trim().length > 0 && !postTextIsValid(props.provider, props.value);
  return (
    <span className={over ? "character-count is-over" : "character-count"}>
      {props.labelled && <span className="count-label">{providerLabel(props.provider)}</span>}
      {countPostCharacters(props.provider, props.value)} / {POST_LIMITS[props.provider]}
    </span>
  );
}

function FeedPreview(props: { readonly provider: Provider; readonly message: string; readonly displayName: string; readonly initials: string; readonly account: Account | null; readonly onPostOnX: () => void; readonly disabled: boolean }) {
  const isX = props.provider === "x";
  const connected = props.account?.status === "connected" ? props.account : null;
  const identity = connected?.accountHandle ? `@${connected.accountHandle}` : isX ? "@yourhandle" : "Your LinkedIn profile";
  const segments = previewSegments(props.provider, props.message);
  return (
    <article className={`feed-card ${isX ? "x-preview" : "linkedin-preview"}`} aria-label={`${providerLabel(props.provider)} post preview`}>
      <div className="post-head">
        <Avatar><AvatarFallback>{props.initials}</AvatarFallback></Avatar>
        <div><strong>{connected?.accountName ?? props.displayName}</strong><span>{identity} · now</span></div>
        <NetworkIcon provider={props.provider} />
      </div>
      <p className="preview-copy">
        {segments.length === 0 ? <span className="preview-placeholder">Your post will appear here.</span> : segments.map((segment, index) => segment.kind === "entity" ? <span key={index} className="preview-entity">{segment.value}</span> : segment.value)}
      </p>
      <div className="engagement-line">{(isX ? ["Reply", "Repost", "Like", "Share"] : ["Like", "Comment", "Repost", "Send"]).map((label) => <span key={label}>{label}</span>)}</div>
      {isX && <XComposerHandoff message={props.message} connected={connected !== null} onOpen={props.onPostOnX} disabled={props.disabled} />}
    </article>
  );
}

function XComposerHandoff(props: { readonly message: string; readonly connected: boolean; readonly onOpen: () => void; readonly disabled: boolean }) {
  const empty = props.message.trim().length === 0;
  const note = props.connected && hasLink(props.message)
    ? "Posts with links cost $0.20 through the X API. Posting on X.com is free."
    : "Opens X's composer with this text. Free, and no developer app needed.";
  return (
    <div className="x-handoff">
      <Button asChild variant="outline" size="sm" aria-disabled={empty || props.disabled}>
        <a href={empty || props.disabled ? undefined : xComposerUrl(props.message)} target="_blank" rel="noreferrer" onClick={props.onOpen}>Post on X.com <ArrowUpRight /></a>
      </Button>
      <small>{note}</small>
    </div>
  );
}

function NetworkIcon({ provider }: { readonly provider: Provider }) {
  return <span className={provider === "x" ? "network-icon x-icon" : "network-icon linkedin-icon"} aria-hidden="true">{provider === "x" ? "X" : "in"}</span>;
}

function accountFor(state: ConnectionState, provider: Provider): Account | null {
  return state.kind === "ready" ? state.accounts.find((account) => account.provider === provider) ?? null : null;
}

function AccountRow(props: { readonly provider: Provider; readonly state: ConnectionState; readonly onDisconnect: (provider: Provider) => Promise<void>; readonly disabled: boolean; readonly disconnecting: boolean }) {
  const account = accountFor(props.state, props.provider);
  const label = providerLabel(props.provider);
  const status = props.state.kind === "loading" ? "Checking…"
    : props.state.kind === "unavailable" ? "Unavailable"
    : account?.status === "connected" ? account.accountHandle ? `@${account.accountHandle}` : account.accountName
    : account?.status === "unconfigured" ? "Needs app credentials"
    : "Not connected";
  return (
    <div className="account">
      <div className="connection-row">
        <NetworkIcon provider={props.provider} />
        <div className="connection-name"><strong>{label}</strong><span>{status}</span></div>
        {account?.status === "connected" && (
          <Button type="button" size="sm" variant="ghost" disabled={props.disabled} onClick={() => void props.onDisconnect(props.provider)}>{props.disconnecting ? "Disconnecting…" : "Disconnect"}</Button>
        )}
        {account?.status === "disconnected" && (
          <Button asChild size="sm" variant="outline"><a href={`/api/oauth/${props.provider}`}>Connect <ArrowUpRight /></a></Button>
        )}
      </div>
      {account?.status === "unconfigured" && <SetupSteps guide={setupGuides[props.provider]} callbackUrl={account.callbackUrl} />}
    </div>
  );
}

function SetupSteps({ guide, callbackUrl }: { readonly guide: SetupGuide; readonly callbackUrl: string }) {
  return (
    <ol className="setup-steps">
      <li>Create an app in <a href={guide.portal.href} target="_blank" rel="noreferrer">{guide.portal.label} <ArrowUpRight /></a></li>
      {guide.steps.map((step) => <li key={step}>{step}</li>)}
      <li>{guide.callbackStep}<CopyField value={callbackUrl} /></li>
      <li>Set <code>{guide.secrets[0]}</code> and <code>{guide.secrets[1]}</code> in <code>.env.local</code> or as Worker secrets, then restart.</li>
    </ol>
  );
}

function CopyField({ value }: { readonly value: string }) {
  const [copied, setCopied] = useState(false);

  async function copy(): Promise<void> {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard access can be denied; the value stays selectable.
    }
  }

  return (
    <span className="copy-field">
      <code>{value.split(/(?<=\/)/u).map((part, index) => <Fragment key={index}>{part}<wbr /></Fragment>)}</code>
      <Button type="button" size="icon-xs" variant="ghost" onClick={() => void copy()} aria-label="Copy callback URL">{copied ? <Check /> : <Copy />}</Button>
    </span>
  );
}

function PublishHint(props: { readonly readiness: Readiness; readonly tailored: boolean; readonly onRetryAccounts: () => void }) {
  const readiness = props.readiness;
  switch (readiness.kind) {
    case "no-destination":
      return <p>Choose X, LinkedIn, or both.</p>;
    case "empty":
      return <p>{props.tailored ? `Write the ${providerLabel(readiness.provider)} version.` : "Write something to publish."}</p>;
    case "over-limit":
      return <p className="error-hint"><XCircle /> {props.tailored ? `The ${providerLabel(readiness.provider)} version is ${readiness.over} characters over the limit.` : `${readiness.over} characters over the ${providerLabel(readiness.provider)} limit. Shorten it or tailor each version.`}</p>;
    case "invalid":
      return <p className="error-hint"><XCircle /> {providerLabel(readiness.provider)} does not accept some characters in this text.</p>;
    case "checking-accounts":
      return <p>Checking your accounts…</p>;
    case "accounts-unavailable":
      return <p><LockKeyhole /> {readiness.message} <button type="button" className="text-button" onClick={props.onRetryAccounts}>Retry</button></p>;
    case "not-connected":
      return <p><LockKeyhole /> <a href="#accounts">Connect {listLabel(readiness.providers)}</a> to publish{readiness.providers.includes("x") ? ", or use Post on X.com in the X preview" : ""}.</p>;
    case "ready":
      return <p><Check /> Ready to publish.</p>;
    default: {
      const exhaustive: never = readiness;
      return exhaustive;
    }
  }
}

function PublishResult({ state, onStartNewPost }: { readonly state: PublishState; readonly onStartNewPost: () => void }) {
  if (state.kind === "idle" || state.kind === "publishing") return null;
  if (state.kind === "error") return <div className="result-panel is-error" role="alert">{state.message}</div>;
  const done = state.results.every((result) => result.kind !== "failed");
  return (
    <output className="result-panel" aria-live="polite">
      {state.results.map((result) => result.kind === "published" ? (
        <a key={result.provider} href={result.postUrl} target="_blank" rel="noreferrer"><Check /> Published to {providerLabel(result.provider)}. View post <ArrowUpRight /></a>
      ) : (
        <span key={result.provider} className="failed-result"><XCircle /> {providerLabel(result.provider)}: {result.message}{result.kind === "failed" && result.reconnect && <a href={`/api/oauth/${result.provider}`}>Reconnect</a>}</span>
      ))}
      {done && <Button type="button" variant="outline" size="sm" className="new-post-button" onClick={onStartNewPost}><PenLine /> Start a new post</Button>}
    </output>
  );
}
