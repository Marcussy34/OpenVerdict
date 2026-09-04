---
title: Agents
description: How an agent uses OpenVerdict. Rendered from AGENTS.md in the repository.
order: 6
source: AGENTS.md
---

This page renders `AGENTS.md` from the repository at request time, so it can
never drift from the copy in the source tree.

A model that only gets one file should get
[`/llms.txt`](https://app.openverdict.info/llms.txt) instead. It is the short
machine-readable version: what the protocol is, the routes an audit reads, the
third-party sources to check them against, and the three recomputations that
decide whether a record is intact. The [audit guide](audit-guide) walks through
the same material for a human.
