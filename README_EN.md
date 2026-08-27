# dsh-research-autoresearch

A DeepSeek Harness bundle plugin implementing the six stages of the **AutoResearch** protocol as agent tools, plus a live Web settings card for its visualization layer.

[中文 README](./README.md)

| Tool | Stage |
|---|---|
| `arxiv_search` | Literature recall — keyword fan-out against the arXiv API, dedup by id |
| `lit_score` | LQS scoring — recency 30 / citations 25 / venue 20 / institution 10 / acceptance 15, bucketed into must-cite / conditional / dropped (Semantic Scholar live counts) |
| `research_state` | The five durable state files (spec, progress, findings, directions, iteration log) behind one read/write boundary |
| `stall_check` | Stall traffic-light: stale count, pivot/escalate/cap recommendations, "pivot structure, not tactics" |
| `peer_review` | Five-persona review protocol — MEDIAN (never mean), binding constraint, honest downward-revision signal |
| `research_ui_switch` | Runtime master console for all five progress-card streams |

## Design inspiration

This plugin operationalizes Deli Chen's AutoResearch framework:

- **Inspiration paper / case study**: Deli Chen, *"From Draft to Strong-Accept: How a Self-Play Survey Hit 8.6"* ([blog_self_play_story.html](https://victorchen96.github.io/blog_self_play_story.html)). Its 16-round review history shaped three core mechanics here: the median-not-mean scoreboard (a single enthusiastic reviewer cannot inflate it), the honest downward-revision signal (round V12: the framework cut its own 8.5 to 8.2 after external citation checks), and stall's structural-pivot rule with 15-round / 30-minute caps.
- **Protocol**: [AutoResearch Framework Protocol (SKILL.md)](https://victorchen96.github.io/auto_research/framework.html).

## Engineering shape (mirrors dsh-github-manager)

- `src/bundle.ts` — host half: pure named exports only (`name`, `inject: ['tools']`, `Config`, `apply`). **Never add a default export**: the loader unwraps `exports.default ?? exports`, and a default would shadow the inject declaration and brick profile boot.
- `src/client/` — browser half: TypeScript sources compiled by `scripts/build-client.mjs` into a lazy-CJS `__ModuleLoader__` envelope (`lib/client.js`, generated — do not hand-edit). Declares its own module-level `inject = ['locale', 'settingsScope', 'slots']` for the browser-side cordis property gate.
- Strict `tsconfig.client.json` typechecks the browser half with zero `@types` dependencies (ambient shims only).
- `tests/`: host smoke (mount, settings sync, lossless-JSON registry gate, boot-order contract) + vm-sandbox client replay that emulates the cordis inject gate.

## v0.4.0 the orchestration layer (diagnosis-driven)

Post-release forensics (all 83 host session logs decompressed) showed **zero tool invocations** - installed but inert. Root cause: the AutoResearch framework natively ships as a pair - a SKILL.md protocol (orchestration) plus tools (mechanics) - and this package only had the mechanics. Passive tool descriptions get near-zero spontaneous uptake. Fixes:

1. Registers an `autoresearch` **runtime skill** through the official `ctx.skills` seam: bilingual trigger description in the model-facing catalog; the full loop (task-dir conventions, iteration protocol, literature funnel, five-persona review cycle, stall semantics) loads on demand.
2. The registration uses an optional `ctx.get('skills')` lookup - never the inject gate - so profiles without the skills subsystem boot the six tools exactly as before (asserted in smoke, brick-proofed).
3. All five visualization streams now **default ON**; the three opt-out layers are unchanged.

## v0.3.0 literature-driven upgrades (2026-07)

The plugin ran its own Recall->Score funnel over 67 frontier papers (2024-09..2026-08) to audit itself. Two evidence-backed defects fixed:

1. **lit_score citation-window correction** - a batch of 22 fresh 2026 papers was 100% dropped purely because citation counts had not accrued yet (<400-day papers now impute the citation component with the mean of the other components, flagged via `citationEmergingImputed`). Backtest: 22 dropped -> 16 conditional + 6 legitimately dropped.
2. **peer_review judge-uncertainty band** - following the 2025-2026 LLM-as-a-judge literature (bias/uncertainty estimation, conformal rankings, reviewer-vulnerability studies): new `judgeDisagreement` (spread) and `scoreBand` (median +/- 1.4826 MAD, the robust scale-consistent band). A polarized panel (spread >= 4) auto-tags `judge_disagreement` and can no longer reach `accept` before convergence.
3. **Self-contained build** - all six tool sources are vendored into `src/`; `prepare` no longer touches paths outside the package (publish.zh.md red line), so git installs build standalone.

## Verification results

| Layer | Result |
|---|---|
| Host smoke tests | 11/11 |
| Browser replay (gated) | 9/9 |
| Installed-package stability probe | 16/16 (incl. live arXiv/Semantic Scholar round-trips) |
| Cold-boot stability, isolated DSH_HOME x3 | 3/3 HTTP 200, plugin tree clean |
| `tsc --noEmit` (strict) | 0 diagnostics |
| End-to-end research simulation harness | 133/133 |

## Install

```bash
# git install (approve the one-time prepare build as documented)
dsh plugin --profile web add github:yuan-source-666/dsh-research-autoresearch

# or from a prebuilt tarball (no build approval needed)
npm run build && npm pack
dsh plugin --profile web add ./dsh-research-autoresearch-0.3.1.tgz
```

Then the bundle appears in your profile's `dsh.profile.bundles`. Disable any time via `cordis.patch.yml`:

```yaml
- id: dsh-research-autoresearch
  disabled: true
```

The Web settings page gains a **科研可视化总控台 / Research UI console** card (zh/en) to flip each visualization stream at runtime; changes sync live to the agent-side service.

## License

MIT
