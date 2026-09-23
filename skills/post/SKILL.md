---
name: post
description: Draft a post for X and LinkedIn from what happened in this session, then open it in Twofold for the user to edit and publish. Use for /post (Claude Code), $post (Codex), or when the user asks to post, tweet, or share something from the current work.
argument-hint: "[angle or topic]"
allowed-tools: mcp__twofold__stage_post
---

# Draft a post from this session

Write a post about what the user asked for, or about the most useful thing from this session, and stage it with the Twofold `stage_post` tool.

The tool's description holds the drafting rules and the user's voice guide. Follow them exactly. Staging never publishes: the user edits and publishes in the browser.

If the `stage_post` tool is unavailable, show the draft in your reply and tell the user to run `npm run setup:agent` in the Twofold project.
