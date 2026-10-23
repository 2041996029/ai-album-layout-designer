# Native WeChat mini app

Open this directory in WeChat Developer Tools with TypeScript compilation enabled. `touristappid` is for local inspection only. There is no production AppID or provider credential in this bundle.

Before integration, deploy C3 HTTP services, supply the HTTPS `/v1` base URL and the selected authorized workspace in `src/config.ts`, and replace the AppID through deployment configuration. Configure WeChat request/upload/download domain allowlists for the API and private object store. Empty configuration deliberately shows an unavailable message. Session access/refresh tokens remain in memory; each fresh launch uses `wx.login`. Storage contains only workspace-scoped document revision and whitelisted recovery commands, never a serialized document or session secrets.

C4 task, layout scheduling and export capabilities default to unavailable. Enable layout/tasks only after their actual server services are connected. Export remains explicitly unavailable until the C4 preflight/export workflow is delivered; it never fabricates a completed file or job. There is no payment or upgrade detour.

The album page supports selecting original JPEG/PNG files, byte SHA-256, ticket-based PUT/POST uploads, per-file retry and scan-state refresh, folders, authorized themes, spread counts, candidate comparison/application, allowed text/crop commands, private image previews and revision saves. Recovery survives offline reopening and conflicts. A conflict must be resolved explicitly by copying the recovery commands or discarding them and reloading; commands never automatically replay on a newer revision. Task lists use server pagination and do not cancel jobs when the page closes.

Preview is deliberately labeled as a simplified native view. It displays positioned text/images/shapes and saved crops; system font substitution, filters, groups and other advanced effects require full review in the web editor. Unsupported layers remain exclusively in the server document, untouched by mini saves.

Local verification: `npm run test:unit -- apps/mini/src/album.test.ts` and `npm run typecheck` from the repository root. These exercise the injected HTTP/wx boundaries and real state functions. WeChat Developer Tools, iOS/Android authorization, domain allowlists, private storage and real login remain **not verified** until an AppID and authorized integration environment are supplied.
