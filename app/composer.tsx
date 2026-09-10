"use client";

import { useEffect, useMemo, useState } from "react";
import { ArrowUpRight, Check, Feather, Link2, LoaderCircle, LockKeyhole, Send, Trash2, XCircle } from "lucide-react";
import { z } from "zod";

import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import {
  ConnectionSummarySchema,
  ProviderSchema,
  PublishResponseSchema,
  type ConnectionSummary,
  type DestinationResult,
  type Provider,
} from "@/lib/domain";

const STARTER_POST =
  "Shipped a small improvement today: our deploy preview now catches broken links before they reach production.\n\nTiny guardrail, much calmer releases.";
const DRAFT_KEY = "twofold:draft";
const providers = ["x", "linkedin"] satisfies ReadonlyArray<Provider>;
const limits = { x: 280, linkedin: 3000 } satisfies Record<Provider, number>;

const DraftSchema = z.object({
  shared: z.string(),
  x: z.string(),
  linkedin: z.string(),
  tailored: z.boolean(),
  selection: z.object({ x: z.boolean(), linkedin: z.boolean() }),
});
type Draft = z.infer<typeof DraftSchema>;

const ConnectionsResponseSchema = z.object({
  connections: z.array(ConnectionSummarySchema),
});

const StageCrosspostSchema = z.object({
  message: z.string().trim().min(1).max(3000),
  providers: z.array(ProviderSchema).min(1).max(2),
});

type ConnectionState =
  | { readonly kind: "loading" }
  | { readonly kind: "ready"; readonly items: ReadonlyArray<ConnectionSummary> }
  | { readonly kind: "unavailable"; readonly message: string };

type PublishState =
  | { readonly kind: "idle" }
  | { readonly kind: "publishing" }
  | { readonly kind: "complete"; readonly results: ReadonlyArray<DestinationResult> }
  | { readonly kind: "error"; readonly message: string };

const emptyDraft: Draft = {
  shared: STARTER_POST,
  x: STARTER_POST,
  linkedin: STARTER_POST,
  tailored: false,
  selection: { x: true, linkedin: true },
};

function countCharacters(value: string): number {
  return Array.from(value).length;
}

function providerLabel(provider: Provider): string {
  return provider === "x" ? "X" : "LinkedIn";
}

export function Composer({ displayName }: { readonly displayName: string }) {
  const [draft, setDraft] = useState<Draft>(emptyDraft);
  const [draftLoaded, setDraftLoaded] = useState(false);
  const [connections, setConnections] = useState<ConnectionState>({ kind: "loading" });
  const [publishState, setPublishState] = useState<PublishState>({ kind: "idle" });
  const [notice, setNotice] = useState<string | null>(null);

  const selectedProviders = useMemo(
    () => providers.filter((provider) => draft.selection[provider]),
    [draft.selection],
  );
  const connectedProviders = connections.kind === "ready"
    ? new Set(connections.items.map((connection) => connection.provider))
    : new Set<Provider>();
  const allSelectedConnected = selectedProviders.every((provider) => connectedProviders.has(provider));
  const xText = draft.tailored ? draft.x : draft.shared;
  const linkedInText = draft.tailored ? draft.linkedin : draft.shared;
  const hasLimitError =
    (draft.selection.x && countCharacters(xText) > limits.x) ||
    (draft.selection.linkedin && countCharacters(linkedInText) > limits.linkedin);
  const allSelectedHaveText = selectedProviders.every((provider) =>
    (provider === "x" ? xText : linkedInText).trim().length > 0,
  );
  const initials = displayName.split(/\s+/u).filter(Boolean).slice(0, 2).map((part) => part[0]?.toUpperCase()).join("") || "ME";

  useEffect(() => {
    let cancelled = false;
    queueMicrotask(() => {
      if (cancelled) return;
      const stored = window.localStorage.getItem(DRAFT_KEY);
      if (stored) {
        try {
          const parsed = DraftSchema.safeParse(JSON.parse(stored));
          if (parsed.success) setDraft(parsed.data);
          else window.localStorage.removeItem(DRAFT_KEY);
        } catch {
          window.localStorage.removeItem(DRAFT_KEY);
        }
      }
      setDraftLoaded(true);
    });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (draftLoaded) window.localStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
  }, [draft, draftLoaded]);

  useEffect(() => {
    void loadConnections();
    const parameters = new URLSearchParams(window.location.search);
    const noticeCode = parameters.get("notice");
    const provider = ProviderSchema.safeParse(parameters.get("provider"));
    queueMicrotask(() => {
      if (noticeCode === "connected" && provider.success) {
        setNotice(`${providerLabel(provider.data)} is connected.`);
      } else if (noticeCode === "configure" && provider.success) {
        setNotice(`Add your ${providerLabel(provider.data)} app credentials before you connect.`);
      } else if (noticeCode === "oauth-failed") {
        setNotice("The account connection did not finish. Check the callback URL and try again.");
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
          const staged = StageCrosspostSchema.parse(input);
          const nextSelection = {
            x: staged.providers.includes("x"),
            linkedin: staged.providers.includes("linkedin"),
          };
          setDraft({
            shared: staged.message,
            x: staged.message.slice(0, limits.x),
            linkedin: staged.message,
            tailored: false,
            selection: nextSelection,
          });
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
      const response = await fetch("/api/connections", { cache: "no-store" });
      const body: unknown = await response.json().catch(() => null);
      if (!response.ok) throw new Error(response.status === 401 ? "Sign in to connect accounts." : "Connections are unavailable.");
      setConnections({ kind: "ready", items: ConnectionsResponseSchema.parse(body).connections });
    } catch (error) {
      setConnections({ kind: "unavailable", message: error instanceof Error ? error.message : "Connections are unavailable." });
    }
  }

  function updateShared(value: string): void {
    setDraft((current) => ({ ...current, shared: value }));
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
      x: checked ? current.shared.slice(0, limits.x) : current.x,
      linkedin: checked ? current.shared : current.linkedin,
    }));
    setPublishState({ kind: "idle" });
  }

  async function publish(): Promise<void> {
    setPublishState({ kind: "publishing" });
    try {
      const destinations = selectedProviders.map((provider) => ({
        provider,
        text: provider === "x" ? xText : linkedInText,
      }));
      const response = await fetch("/api/posts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ destinations }),
      });
      const body: unknown = await response.json().catch(() => null);
      if (!response.ok) throw new Error("Twofold could not publish this draft.");
      setPublishState({ kind: "complete", results: PublishResponseSchema.parse(body).results });
    } catch (error) {
      setPublishState({ kind: "error", message: error instanceof Error ? error.message : "Publishing failed." });
    }
  }

  async function disconnect(provider: Provider): Promise<void> {
    const response = await fetch(`/api/connections?provider=${provider}`, { method: "DELETE" });
    if (response.ok) await loadConnections();
  }

  function clearDraft(): void {
    setDraft((current) => ({ ...current, shared: "", x: "", linkedin: "" }));
    setPublishState({ kind: "idle" });
  }

  return (
    <div className="app-shell">
      <header className="topbar">
        <a className="brand" href="#top" aria-label="Twofold home"><span className="brand-mark">2F</span><span>Twofold</span></a>
        <div className="topbar-actions">
          <Badge variant="outline" className="privacy-badge"><LockKeyhole aria-hidden="true" /> Private workspace</Badge>
          <a className="profile-button" href="/signout-with-chatgpt?return_to=/" title="Sign out">
            <Avatar size="sm"><AvatarFallback>{initials}</AvatarFallback></Avatar>
            <span className="profile-name">{displayName}</span>
          </a>
        </div>
      </header>

      {notice && <div className="notice-banner" role="status"><span>{notice}</span><button type="button" onClick={() => setNotice(null)} aria-label="Dismiss notice">×</button></div>}

      <main id="top" className="workspace">
        <section className="composer-column" aria-labelledby="composer-heading">
          <div className="section-heading">
            <div><p className="eyebrow">New post</p><h1 id="composer-heading">Write once. Make it fit twice.</h1></div>
            <Badge className="draft-badge" variant="secondary">Draft saved on this device</Badge>
          </div>

          <div className="paper-card composer-card">
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
              <Editor label="Post text" value={draft.shared} limit={draft.selection.x ? limits.x : limits.linkedin} onChange={updateShared} onClear={clearDraft} />
            ) : (
              <div className="tailored-editors">
                <Editor label="X version" value={draft.x} limit={limits.x} onChange={(value) => updateProvider("x", value)} />
                <Editor label="LinkedIn version" value={draft.linkedin} limit={limits.linkedin} onChange={(value) => updateProvider("linkedin", value)} />
              </div>
            )}

            <label className="tailor-row">
              <span><strong>Tailor each version</strong><small>Use a short X post and a roomier LinkedIn version.</small></span>
              <Switch aria-label="Tailor each version" checked={draft.tailored} onCheckedChange={toggleTailored} />
            </label>

            <div className="publish-row">
              <PublishHint connections={connections} selectedProviders={selectedProviders} hasLimitError={hasLimitError} />
              <Button
                type="button"
                size="lg"
                className="publish-button"
                disabled={!allSelectedHaveText || selectedProviders.length === 0 || hasLimitError || !allSelectedConnected || publishState.kind === "publishing"}
                onClick={() => void publish()}
              >
                {publishState.kind === "publishing" ? <LoaderCircle className="spin" /> : <Send />}
                {publishState.kind === "publishing" ? "Publishing" : `Publish to ${selectedProviders.length}`}
              </Button>
            </div>
            <PublishResult state={publishState} />
          </div>

          <aside className="setup-note"><Feather aria-hidden="true" /><div><strong>Built for one person, not a content team.</strong><p>Your API keys stay on the server. Twofold only asks for permission to publish.</p></div></aside>
        </section>

        <aside className="preview-column" aria-labelledby="preview-heading">
          <div className="preview-title-row"><div><p className="eyebrow">Live preview</p><h2 id="preview-heading">Both feeds</h2></div><span className="live-pill"><span /> Synced</span></div>
          <div className="preview-stack">
            {draft.selection.x && <FeedPreview provider="x" message={xText} displayName={displayName} initials={initials} connection={connectionFor(connections, "x")} />}
            {draft.selection.linkedin && <FeedPreview provider="linkedin" message={linkedInText} displayName={displayName} initials={initials} connection={connectionFor(connections, "linkedin")} />}
            {selectedProviders.length === 0 && <div className="empty-preview">Select a network to see its preview.</div>}
          </div>
          <section className="connections-card" aria-labelledby="connections-heading">
            <div><p className="eyebrow">Accounts</p><h2 id="connections-heading">Connect once</h2></div>
            {providers.map((provider) => <ConnectionRow key={provider} provider={provider} state={connections} onDisconnect={disconnect} />)}
          </section>
        </aside>
      </main>
    </div>
  );
}

function Editor(props: { readonly label: string; readonly value: string; readonly limit: number; readonly onChange: (value: string) => void; readonly onClear?: () => void }) {
  const over = countCharacters(props.value) > props.limit;
  return (
    <div className="writing-area">
      <label className="editor-label">{props.label}</label>
      <Textarea aria-label={props.label} className="post-textarea" value={props.value} onChange={(event) => props.onChange(event.target.value)} placeholder="What do you want to share?" />
      <div className="writing-toolbar">
        <span className="link-note"><Link2 /> Links stay clickable on both networks</span>
        <div className="editor-meta">
          {props.onClear && <Button type="button" variant="ghost" size="sm" onClick={props.onClear}><Trash2 /> Clear</Button>}
          <span className={over ? "character-count is-over" : "character-count"}>{countCharacters(props.value)} / {props.limit}</span>
        </div>
      </div>
    </div>
  );
}

function FeedPreview(props: { readonly provider: Provider; readonly message: string; readonly displayName: string; readonly initials: string; readonly connection: ConnectionSummary | null }) {
  const isX = props.provider === "x";
  const identity = props.connection?.accountHandle ? `@${props.connection.accountHandle}` : isX ? "@yourhandle" : "Your LinkedIn profile";
  return (
    <article className={`feed-card ${isX ? "x-preview" : "linkedin-preview"}`} aria-label={`${providerLabel(props.provider)} post preview`}>
      <div className="feed-card-topline"><span className="network-label"><NetworkIcon provider={props.provider} /> Preview</span><span>{countCharacters(props.message)} / {limits[props.provider]}</span></div>
      <div className="post-head"><Avatar><AvatarFallback>{props.initials}</AvatarFallback></Avatar><div><strong>{props.connection?.accountName ?? props.displayName}</strong><span>{identity} · now</span></div></div>
      <p className="preview-copy">{props.message || "Your post will appear here."}</p>
      <div className="engagement-line">{(isX ? ["Reply", "Repost", "Like", "Share"] : ["Like", "Comment", "Repost", "Send"]).map((label) => <span key={label}>{label}</span>)}</div>
    </article>
  );
}

function NetworkIcon({ provider }: { readonly provider: Provider }) {
  return <span className={provider === "x" ? "network-icon x-icon" : "network-icon linkedin-icon"} aria-hidden="true">{provider === "x" ? "X" : "in"}</span>;
}

function connectionFor(state: ConnectionState, provider: Provider): ConnectionSummary | null {
  return state.kind === "ready" ? state.items.find((item) => item.provider === provider) ?? null : null;
}

function ConnectionRow(props: { readonly provider: Provider; readonly state: ConnectionState; readonly onDisconnect: (provider: Provider) => Promise<void> }) {
  const connection = connectionFor(props.state, props.provider);
  return (
    <div className="connection-row">
      <NetworkIcon provider={props.provider} />
      <div><strong>{providerLabel(props.provider)}</strong><span>{connection ? connection.accountHandle ? `@${connection.accountHandle}` : connection.accountName : props.state.kind === "loading" ? "Checking connection" : "Not connected"}</span></div>
      {connection ? (
        <Button type="button" size="sm" variant="ghost" onClick={() => void props.onDisconnect(props.provider)}>Disconnect</Button>
      ) : (
        <Button asChild size="sm" variant="outline"><a href={`/api/oauth/${props.provider}`}>Connect <ArrowUpRight /></a></Button>
      )}
    </div>
  );
}

function PublishHint(props: { readonly connections: ConnectionState; readonly selectedProviders: ReadonlyArray<Provider>; readonly hasLimitError: boolean }) {
  if (props.hasLimitError) return <p className="error-hint"><XCircle /> One version is over its character limit.</p>;
  if (props.connections.kind === "unavailable") return <p><LockKeyhole /> {props.connections.message}</p>;
  const missing = props.selectedProviders.filter((provider) => !connectionFor(props.connections, provider));
  if (missing.length) return <p><LockKeyhole /> Connect {missing.map(providerLabel).join(" and ")} to publish.</p>;
  return <p><Check /> Ready to publish now.</p>;
}

function PublishResult({ state }: { readonly state: PublishState }) {
  if (state.kind === "idle" || state.kind === "publishing") return null;
  if (state.kind === "error") return <div className="result-panel is-error" role="alert">{state.message}</div>;
  return (
    <output className="result-panel" aria-live="polite">
      {state.results.map((result) => result.kind === "published" ? (
        <a key={result.provider} href={result.postUrl} target="_blank" rel="noreferrer"><Check /> {providerLabel(result.provider)} published <ArrowUpRight /></a>
      ) : (
        <span key={result.provider} className="failed-result"><XCircle /> {providerLabel(result.provider)}: {result.message}</span>
      ))}
    </output>
  );
}
