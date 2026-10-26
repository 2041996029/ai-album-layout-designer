# Admin redesign and server test kit Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver a usable redesigned admin and complete source/server-test package.
**Architecture:** Retain C4 API authority, split admin navigation/presentation, add a same-origin Docker test topology and source packaging tooling.
**Tech Stack:** React/TypeScript/Vite, Node24, Docker Compose, Nginx, PostgreSQL17, Redis7.
**Spec:** docs/superpowers/specs/2026-10-26-admin-server-kit-design.md

## Global Constraints
- Target upload directory: `/www/wwwroot/HuaNian_SheJi`.
- No new auth bypass, no real credentials bundled, no remote deployment.
- Preserve C4 live roles, source binding, reauthentication and mutation requests.
- Metrics explicitly describe loaded records; unavailable data is not zero.
- New database volumes initialize once; existing volumes/secrets must never be reset by setup.

## Review Focus
- Unavailable API / forbidden actor: usable navigation, actionable state, no invented stats.
- Pagination/search: loaded records only, continuation survives filtering.
- Paid-order source selection still reaches a freshly verified adjustment.
- Mobile and long identifiers do not create page overflow.
- Fresh stack starts; restart retains DB/objects/secrets; package has actual source and no credentials.

### Task 1: Redesign admin
Files: apps/admin/src/commerce/CommerceConsole.tsx, AdminShell.tsx, admin.css; tests/browser/admin-design.spec.ts; existing commerce browser tests.
- [ ] Write browser regressions for module navigation, filter+pagination, unavailable metrics/mobile; run RED.
- [ ] Implement shell, tables, localized status, contextual review fields, loading/error/empty states.
- [ ] Adapt actual finance UI flow to navigation; run affected browser tests/typecheck, capture screenshots; commit.

### Task 2: Make server test deployment concrete
Files: deploy/server-test/{Dockerfile,compose.yaml,nginx.conf,init-env.mjs,.env.example,README.md}; scripts/package-server-test.mjs; README.md; apps/api/test/server-kit.test.ts.
- [ ] Add RED test for idempotent secret initialization and package exclusions.
- [ ] Implement build/topology/source ZIP generation and local Codex handoff.
- [ ] Validate compose and build/run a fresh test stack, check API/static pages and persisted secret reinitialization; commit.

### Task 3: Review and deliver
- [ ] Run full units with temporary PG/Redis then production builds and affected browser tests sequentially.
- [ ] Fresh read-only branch review; fix important findings with covering regression.
- [ ] Build uploadable archive and checksum; publish branch/draft PR and attach it; provide exact artifact/handoff paths and limitations.
