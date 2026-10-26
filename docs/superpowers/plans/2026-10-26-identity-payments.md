# Identity and Payments Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Ship email/WeChat identity and real Web WeChat/Alipay merchant adapters on the existing account and commerce system.
**Architecture:** Extend contracts and schema first; verified identity and signed merchant facts enter existing services. Server-only configuration composes adapters and exposes accurate capabilities.
**Tech Stack:** TypeScript, React, PostgreSQL, Node crypto, SMTP, Vitest, Playwright.
**Spec:** docs/superpowers/specs/2026-10-26-identity-payments-design.md

## Global Constraints
- Preserve existing role checks, workspace authorization, CSRF and immutable order snapshots.
- No default accounts, logged credentials, client-asserted identities, automatic account merges or fabricated payment success.
- OTP: six digits, 5 minutes, 5 attempts, 60-second send interval; encrypted destination.
- Small-program virtual payment admission remains distinct from Web merchant payment.

## Review Focus
- Concurrent OTP consumption must not create extra sessions or bind to another session.
- Delivery failures and wrong codes must preserve attempts and sending limits.
- Callback identity/amount must match original snapshot; signed non-success states must never grant benefits.
- Repeated refund callbacks and channel retries retain existing idempotency.
- Server upgrades retain existing database data and do not expose keys to Web bundles.

### Task 1: Verified email and WeChat identity
Files: auth/email.ts, auth/wechat.ts, auth/*.test.ts, auth/identity.ts, auth/bindings.ts, auth/reauthentication.ts, database/005_identity_payments.up.sql, test/database.ts.
Interfaces: EmailIdentityService.start/adapter/linkedDestination, WechatMiniAdapter.exchange; existing IdentityAdapter/VerifiedIdentity extended with email.
- [x] Write and observe failing OTP expiry/attempt/replay/purpose/session/concurrency and official WeChat exchange tests.
- [x] Implement encrypted email challenges, SMTP sender, provider extension and schema migration.
- [x] Run relevant tests and commit.

### Task 2: Identity HTTP and UI
Files: contracts/openapi.yaml, contracts/src/api.ts, http/contract-http.ts, http/runtime.ts, runtime.ts, web/auth/LoginPanel.tsx, web/commerce/useHumanVerification.tsx, account binding UI.
Interfaces: POST /auth/email/challenges, POST /auth/email/login; public login challenges and authenticated bind/reauth challenges distinct.
- [x] Write and observe failing HTTP login, secure cookies, bad origin, binding conflict and UI tests.
- [x] Wire real adapters, capabilities, email login and explicit binding flows.
- [x] Regenerate API types; run tests/typecheck and commit.

### Task 3: Signed merchant adapters and channel integration
Files: payments/wechat.ts, payments/alipay.ts, payments/merchant.test.ts, payments/types.ts, payments/adapters.ts, commerce runtime/http/refunds/reconciliation, config schema, web membership UI.
Interfaces: existing PaymentAdapter and RefundAdapter, channel extended with alipay; approved server composition retains published binding versions.
- [x] Write and observe failing signature/decryption/amount/pending/query/close/refund and channel contract tests.
- [x] Implement signed official protocols, webhook raw parsers, runtime binding and dual-channel launch.
- [x] Run focused merchant/commerce tests and commit.

### Task 4: Deployment, verification and delivery
Files: deploy/server-test/*, deployment docs, migration script, complete source packager.
- [x] Test configuration rejection/redaction and migration packaging.
- [x] Document required server-only identity/mail/merchant fields and existing DB upgrade.
- [x] Run full tests, builds, contract consistency and affected browser flows; final independent review, fix important findings with regression tests.
- [x] Commit, create draft PR and regenerate full server source ZIP with SHA256.

## Final verification

72 files / 526 unit tests passed with real PostgreSQL/Redis/Chromium and zero skips after the final mini retry fix. 18 affected browser tests passed; production builds, generated contract consistency, actual container startup/restart persistence and C4→005 data preservation were verified. Independent review findings were fixed with regressions. The final delivery publishes a draft PR and complete server source archive, while actual mail/merchant credentials remain server-side and live integration remains unclaimed.
