# Task 2 report — immutable image imports and pinned local fonts

## Outcome

Implemented all task-owned image/font resource modules, source generators, committed synthetic fixtures and locally vendored fonts, plus a reusable Vite/Chromium browser-core harness. No root dependencies, document/storage implementation, or another task's files were edited. Root already installed/pinned dependencies and owns package.json/lock changes.

Public exports are in `packages/assets/src/index.ts`. `ResourcePort`/`ResourceWriter` are shared interfaces; task 3 implements persistence. `ResourceError` exposes code and converts to the task-1 `DocumentIssue` shape via `toIssue(path)`.

## RED evidence

- `npm run test:unit -- packages/assets/src/assets.test.ts` initially exit 1: missing `./index` asset entry, as required by the brief.
- `CHROMIUM_PATH=/usr/bin/chromium npm run test:browser -- tests/browser/assets.spec.ts` initially 4 failures: Vite could not resolve missing assets entry; all browser tests failed at harness readiness. An initial readiness helper accidentally passed timeout as an argument, corrected to the third options parameter before the recorded complete RED run. Two attempts also encountered an occupied old harness port during interrupted-server shutdown; final harness uses 4175 and shuts down normally.
- Additional RED: unit catalog assertion failed because full license.text was absent; then embedded actual OFL text in each FontRecord license.
- Additional RED: browser integrity assertion returned `accepted` for a changed top-level font SHA; then added canonical `fontRecordHash` validation before resource reads.

## Final GREEN evidence (actual commands, 2026-10-21 UTC)

- `CHROMIUM_PATH=/usr/bin/chromium npm run build:fixtures`: exit 0; synthetic raster fixtures generated with actual Chromium canvas encoder.
- `npm run build:fonts`: exit 0; 2 families, 408 local WOFF2 faces; parser verifies actual OS/2 weight, extracts actual cmap.
- `npm run test:unit -- packages/assets/src/assets.test.ts`: 6/6 pass, 1 file, 1.56s.
- `CHROMIUM_PATH=/usr/bin/chromium npm run test:browser -- tests/browser/assets.spec.ts`: 7/7 pass, 7.4s.
- `npm test`: 57/57 pass across 5 files, 3.43s. Included concurrently added document commands tests. No concurrent test failures observed in the final full run.
- `npm run typecheck`: exit 0 after the final full-suite run. An earlier typecheck exposed fontkit's Font|FontCollection union; explicit collection rejection/narrowing fixed all 3 owned diagnostics.
- Browser version: installed `/usr/bin/chromium` 154.0.8037.57. Bundled Playwright download was unavailable in this environment (403, root discovery). Config honors CHROMIUM_PATH only when set; normal CI retains Playwright's default bundled browser. NO_COLOR/FORCE_COLOR warnings come from the environment and do not fail tests.

## Public contracts and integration notes

- All record fields are readonly. `AssetRecord` identifies original bytes via `id=image-${originalSha256}`, version 1, and top-level original SHA. Top-level width/height/mimeType describe normalized pixels. `variants.original`, `.normalized`, `.preview` each carry their own SHA/byteLength/MIME/dimensions; original variant dimensions are pre-orientation source dimensions. Runtime returned image records and nested metadata are frozen.
- Source is `{kind:'import'|'bundled',name,url?}`; license is `{id,usable,source?,text?}`; status is ready/missing/unlicensed. Photo import retains user-provided provenance. Bundled FontRecord includes full OFL text for self-contained project ZIPs; source path points to combined `/fonts/OFL.txt` as well.
- `ResourceManifest` is `{assets:readonly AssetRecord[],fonts:readonly FontRecord[]}`. `AssetBytes` has independent original/normalized/preview Uint8Arrays. ResourceWriter methods match the brief exactly, including font files keyed by subset resource ID. `read(id,variant)` is exact; no fallback is built into any asset code.
- Each FontFaceRecord is a real local subset: independent content ID, SHA, byte length, local file reference, weight 400 or 700, normal style, measured codePoints. FontRecord id is family slug; version 1 identifies this exact catalog revision. `fontRecordHash` canonically hashes explicit provenance/license/face tuples; it is not SHA(raw manifest JSON). Constructors of test records should use this exported helper.
- `loadFont(record,port,signal,text?)` preserves the required 3-argument API and optionally accepts the requested text to read/load only relevant local subsets. Omit text to load the full pinned family. It verifies aggregate identity, each actual file SHA, parsed cmap equality, and actual OS/2 weight. Family is `AlbumFont_${record.sha256}`. Both actual 400 and 700 weights are required. Rendering/preflight should reject other fontWeight values rather than allow browser synthesis.
- LoadedFont exposes family, loaded subset faces, actual coverage (intersection of actual 400/700 coverage), and idempotent dispose. Combining marks are checked as individual Unicode scalars. CR/LF are layout controls; other missing scalars are returned once in text order. The real-font browser test verifies `我们，。Á🙂` has precisely U+1F642 missing.
- Font reads and FontFace loading honor abort; partially installed faces are removed on failure; late unresolved resource reads cannot add faces. Successful fonts also dispose on subsequent signal abort. Canvas/bitmap resources are released in finally; importer creates no ObjectURLs, so none can leak.

## Image decisions and coverage

- Decimal limits: 25,000,000 bytes and 80,000,000 pixels. Magic and bounded JPEG/PNG headers are checked before browser decode. Zero dimensions and unsupported magic reject explicitly. Decoder errors are INVALID_IMAGE. Browser decoder applies EXIF from-image once; no additional rotation is applied.
- Canvas always produces normalized PNG (strips EXIF/GPS and retains alpha). Preview is also PNG, bounded to longest edge 1600 with a minimum short edge of 1; no upscale. Original bytes are returned unchanged and hashed separately.
- Browser tests assert EXIF 6/8 final dimensions 200×300, independent corner order, repeated normalized import stays 200×300, original exact bytes/hash, transparent alpha, 1600 preview limit, 10000×1 accepted extreme ratio, exact 25MB accepted, 25MB+1 rejected, 80MP+1 header rejected before decode, fake JPEG/bad PNG/corrupt raster decode rejected. Pure header test permits exactly 80MP and rejects 80,000,001 pixels; it does not claim an 80MP memory/performance benchmark.
- Fixture script paints red/green/blue/yellow quadrants, encodes 300×200 JPEG, and inserts a TIFF SHORT orientation APP1 field without rotating/recompressing the JPEG pixels. EXIF 6/8 sample interior RGB channels permit absolute JPEG error <=8. PNG is lossless. README documents fixture generation and deliberate malformed large header.
- Abort test wraps the real browser decoder, aborts after decoding, and observes its bitmap close exactly once. Font cancellation/partial-resource-failure tests verify document.fonts returns to baseline.

## Font provenance

Both Fontsource packages are exactly 5.3.1 from the root lockfile; no runtime CDN/font fetch is used. Upstream metadata is Noto Sans SC v41 and Noto Serif SC v36, source https://github.com/google/fonts, OFL-1.1. Full publisher licenses are retained. Each family has 204 faces (102 subsets × 2 weights).

- Sans: 7,186,436 font bytes; catalog SHA `41314067140a1e003cf4e235b177fdec114656b736263694ad18b3cbf29c5fcd`.
- Serif: 9,508,872 font bytes; catalog SHA `8dc89b74795c28bd2d795635815df023acbe2f7ed9769e6a769f829e677f896c`.

Unit tests independently read all 408 committed files, verify SHA-256, parse actual cmap with fontkit, and compare all codePoints with the manifest. CSS unicode-range is never used as missing-glyph evidence.

## Limits and follow-up responsibilities

No 80MP/500-photo capacity performance claim is made. Per-project photo count, render surface/workset budgeting, export preflight and ZIP contents belong to later tasks. Chromium is the exercised browser here; browser matrix coverage remains future work. Font catalog disk footprint is about 19MiB including manifest; selective text loading avoids loading every local subset for ordinary text. All resources are local and their use requires no network font service.
