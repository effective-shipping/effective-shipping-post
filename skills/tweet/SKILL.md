---
name: tweet
description: Draft a post for X and LinkedIn from what happened in this session, then open it in Twofold for the user to edit and publish. Use for /tweet (Claude Code), $tweet (Codex), or when the user asks to post, tweet, or share something from the current work.
argument-hint: "[angle or topic]"
allowed-tools: mcp__twofold__stage_post, Read(~/.twofold/voice.md)
---

# Draft a post from this session

Turn something from this session into a post, then stage it in Twofold with the `stage_post` tool. Staging never publishes. The user edits and publishes in the browser.

## 1. Pick the one thing worth sharing

If the user gave an angle or topic with the command, use it. Otherwise pick the single most interesting thing from the session: a surprising cause, a fix that generalizes, a tradeoff, a number, or a tool that saved time. Prefer one concrete idea over a summary of everything.

## 2. Keep private things out

Leave out anything the user would not publish:

- Secrets, tokens, passwords, and environment values.
- Employer, client, and colleague names, internal hostnames, and private repository or file paths.
- Proprietary code, unreleased plans, and customer data.

When unsure, leave it out and mention what you omitted when you reply.

## 3. Write it

If `~/.twofold/voice.md` exists, read it first and follow it. It is the user's own guide to tone, topics, and formatting.

Otherwise:

- Write in the first person, as the user. Be plain and specific: say what happened and what you learned.
- State only what the session shows. Do not invent experiences, feelings, effort, or numbers. If a line needs a fact you do not have, leave it out.
- Lead with the finding, not the setup. No hype, no "🧵", and no engagement bait.
- Use at most one hashtag, and only when it helps someone find the post. Use no emoji unless the user asks.
- Include a link only when it is public and adds something, such as the project, the docs, or the issue.

Write `text` for LinkedIn: 2 to 5 short paragraphs when there is enough substance, otherwise one short paragraph.

Write `x` only when `text` does not fit on X. X allows 280 weighted characters. A link counts as 23 characters, and most emoji and CJK characters count as 2. Stay under 260 to leave room for edits. Never cut a sentence off to make it fit. Rewrite it shorter.

## 4. Stage it

Call `stage_post` with `text`, plus `x` when you wrote one. Pass `providers` only when the user asked for a single network.

Then reply in two or three lines: give the review link the tool returned and anything you left out on purpose. Do not say the post was published.

If the `stage_post` tool is unavailable, show the draft in your reply and tell the user to run `npm run setup:agent` in the Twofold project.
