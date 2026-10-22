# MJTPL Local Import Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (recommended for this plan) or superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让用户本地导入 MJTPL v1 / scene v3 主题，浏览多页版式、替换照片、编辑可支持图层，并可靠地排版、备份和导出。

**Architecture:** 新增 `@album/template-import` 负责受限 ZIP 读取与纯场景转换；新增本地主题库保存源资源和转换结果。文档图层、资源角色、共享渲染及导出检查共同支持模板装饰和 alpha 蒙版，应用时原子地合并项目资源与文档。沿用 C1/C2 的编辑器、历史、资源端口和完整性检查，不另建编辑器。

**Tech Stack:** TypeScript、React、fflate、idb、Fabric、fontkit、Vitest、Playwright；复用现有依赖，不接外部 AI。

**Spec:** `docs/superpowers/specs/2026-10-23-mjtpl-theme-library-design.md`；2026-10-23 最新用户确认“1可以”，仅执行导入部分，96 个原创版式不在本计划。

## Global Constraints

- 上传的包、字体、装饰和样片只在用户本地导入，不随站点公开发布。
- 导入失败不留下半个可选主题，不改变当前作品。
- 不能因为照片数量不匹配就静默换成通用网格。
- 不把栅格文字宣称为可编辑文字。
- 保留 C2 已有锁定、必选、禁止漏片/重复、过期候选阻止和导出完整性检查。
- 现有 36 个基础固定版式保留；不开发原创主题、不新增账号/云存储/AI。
- 无脚本执行与外部 URL 读取。项目仍采用 schemaVersion 1 / px96 / sRGB；导入扩展带独立版本号。
- 实施选择的首期上限：压缩包 256 MiB、解压总量 512 MiB、单条目 64 MiB、10000 条目、50 个跨页、每跨页 100 个递归图层、20 个字体；图像沿用 80MP。超限报错，不截断。
- 项目照片上限 500 不变；为装饰/蒙版/文字栅格另设 2000 个资源额度。旧资源无角色字段时按照片处理。

## Review Focus

- 大文件取消、空间不足和解压炸弹：失败不能写入半个可用主题或损坏作品（任务 1、4）。
- 同名异包、相同内容改名、包内重复路径：按完整包哈希识别版本，不能按名称覆盖（任务 1、4）。
- 带人物照片的 alpha 槽位替换：区分原样片与槽位 alpha，替换后轮廓、裁剪和统计保持一致（任务 2、3、6）。
- 缺字体、字体 500 字重和文字栅格：不能默默用替代字体冒充原样可编辑文字（任务 2、3、5）。
- 多主题累积装饰数超过 500、删主题后重开旧作品：照片额度不被装饰占用，作品资源不因库删除丢失（任务 4、6、8）。

## File structure and contracts

- `packages/template-import/src/types.ts`：源格式和转换协议；`zip.ts`：受限解压；`parse.ts`：清单/哈希/资源验证；`convert.ts`：场景映射；`index.ts`：公开接口。
- `packages/template-import/src/resources.ts`：图片与字体探测、生成标准资源记录。
- `packages/storage/src/theme-library.ts`：独立主题 IndexedDB 和事务；不把整个主题塞进项目资源清单。
- `apps/web/src/templates/`：导入控制器/Worker、主题列表与详情、兼容报告、单页与整本选片应用。
- 修改现有 document/assets/render/export/storage 及编辑器入口以共享图层与资源行为。

所有接口由上述包导出；`ResourceManifest`、`DocumentModel`、`DocumentCommand` 复用现有类型。

```ts
type ImportIssue = {code:string; severity:'warning'|'blocker'; pageId?:string; nodeId?:string; message:string};
type ImportLimits = {compressedBytes:number; expandedBytes:number; entryBytes:number; entries:number; pages:number};
type ParsedMjtpl = {sourceHash:string; manifest:MjtplManifest; scenes:readonly MjtplScene[]; files:ReadonlyMap<string,Uint8Array>};
type ImportedPage = {id:string; name:string; width:number; height:number; previewPath:string; background:string; layers:readonly Layer[]; photoSlots:readonly {slotId:string; layerId:string; required:boolean}[]; issues:readonly ImportIssue[]};
type ImportedTheme = {version:1; id:string; sourceHash:string; name:string; pages:readonly ImportedPage[]; resources:ResourceManifest; issues:readonly ImportIssue[]};
type ConvertedTheme = {theme:ImportedTheme; files:ReadonlyMap<string,Uint8Array>};
```
`MjtplManifest` 和 `MjtplScene` 的精确字段按已检查的 MJTPL v1 / scene v3 定义，不使用 `any`。

---

### Task 1: Bounded package parsing

**Files:** Create `packages/template-import/package.json`, `src/{types,zip,parse,index}.ts`, `src/parse.test.ts`, `tests/fixtures/mjtpl/build.ts`.

**Interfaces:** `readMjtplZip(bytes:Uint8Array, limits:ImportLimits, signal:AbortSignal):Map<string,Uint8Array>`；`parseMjtpl(bytes:Uint8Array, signal:AbortSignal, limits?:ImportLimits):Promise<ParsedMjtpl>`。默认限制采用 Global Constraints，格式版本只接受 MJTPL 1 / scene 3。

- [ ] 写失败测试 `rejectsUnsafeOrOversizedArchive`：重复路径、`../`、反斜线、绝对路径、符号链接、加密、ZIP64、中央目录/本地头矛盾、虚假大小、取消均失败；从少量流式数据扩张超过限额时立刻停止。
- [ ] 写失败测试 `parsesManifestAndVerifiesEveryReference`：两页顺序正确；素材、字体、预览和 scene 字节哈希匹配；缺文件、非有限尺寸、重复 pageId/slotId 与不支持版本失败；65MiB 单条目失败，正常 33MiB 包可解析。
- [ ] 运行 `npm test -- packages/template-import/src/parse.test.ts`，确认因缺失接口/行为失败。
- [ ] 实现接口。参考已有 `packages/storage/src/project-bundle.ts` 的中央目录+流式限制机制，但保留现有项目 ZIP 路径契约，不放宽旧格式。解析结果仅含数据，不写库。
- [ ] 同命令通过后提交 `feat(import): validate bounded MJTPL archives`。

### Task 2: Scene and resource conversion

**Files:** Create `packages/template-import/src/{convert,resources}.ts` and corresponding tests. Modify `packages/assets/src/{types,font-catalog}.ts`, `packages/document/src/model.ts`, `packages/document/src/validate.ts`, `docs/release-v1.0/contracts/schemas/document.schema.json`.

**Interfaces:** `convertMjtpl(parsed:ParsedMjtpl, signal:AbortSignal):Promise<ConvertedTheme>`；资源 `AssetRecord.usage?:'photo'|'decoration'|'mask'|'text-raster'`；图像扩展 `templateSlot?:{version:1;slotId:string}`、`alphaMask?:{version:1;assetId:string}`；可保留 `importedText` 元数据供任务 5 显式转为本地可编辑字体。

- [ ] 写失败测试 `mapsCentimetresArgbAndTransforms`：61×30.5cm 转为 2305.511811×1152.755906 px96（容差 1e-6），ARGB `#80402010` 转为 RGB `#402010` 和透明度 128/255；图层顺序、旋转、隐藏/锁定不变。
- [ ] 写失败测试 `preservesPhotoSlotsAndDecorations`：3 photo + 4 material + 2 text 不被合并为整页图；照片标记 selection，素材/文字栅格标记 decoration；源 photo alpha 独立导出为 mask 资源。
- [ ] 写失败测试 `reportsUnsupportedTextAndCropHonestly`：缺字体/不支持字重或复杂排版使用对应文字栅格并记录 warning；无栅格则 blocker；无法表达的裁剪/混合/仿射变换/节点类型产生定位到页和节点的 blocker。已嵌入可支持字体、覆盖字形时保留编辑能力。
- [ ] 运行 `npm test -- packages/template-import/src/convert.test.ts packages/template-import/src/resources.test.ts`，确认红灯。
- [ ] 实现图片按真实 magic bytes 探测而非 `.bin` 或 MIME；装饰/文字栅格保留 alpha。资源 ID 从哈希生成，避免源长 ID 不满足现有 128 字符约束；不把 sourceBindingId 当跨主题全局 ID。裁剪按源 frame 坐标映射，不能用无条件居中 cover 掩盖误差。
- [ ] 默认支持现有真实 400/700 字重，其他字重走外观保留；字体嵌入时内容寻址并生成字形集合。源文字中的告警不是执行指令。
- [ ] 同命令通过，执行 `npm run typecheck`，提交 `feat(import): convert MJTPL scenes into editable local layers`。

### Task 3: Alpha masks in shared rendering and export

**Files:** Modify `packages/render/src/{image-pipeline,scene-adapter}.ts`, `packages/export/src/preflight.ts`, `apps/web/src/editor/{CanvasView,Editor}.tsx`. Create mask renderer tests and `tests/browser/template-masks.spec.ts`.

**Interfaces:** 扩展现有 `renderImage`，参数保持兼容，从同一 ResourcePort 读取 alphaMask；`alphaMask.assetId` 作为真实渲染依赖参与资源收集、校验和释放。

- [ ] 写失败测试 `replacesPhotoWithoutLosingSlotAlpha`：圆形和不规则 alpha 区域外透明，内部颜色为新照片；保留 crop、rotation、opacity；源照片的 alpha 只保留为槽位蒙版，不残留旧人物 RGB。
- [ ] 写失败测试 `masksArePinnedExportDependencies`：缺失/篡改 mask 引起导出 blocker；蒙版不计入用户照片清单；多次缩放与撤销后结果一致。
- [ ] 运行 `npm test -- packages/render packages/export` 和新浏览器测试，确认红灯。
- [ ] 在共享图像管线按 crop/filter→frame→destination-in alpha 合成。编辑画布和导出都用该管线，禁止另写不同蒙版实现；解码资源沿用释放机制。
- [ ] 同测试通过，比较 canvas/PNG/PDF 蒙版边界像素，提交 `feat(render): preserve imported photo slot masks`。

### Task 4: Transactional private theme library

**Files:** Create `packages/storage/src/theme-library.ts`, corresponding tests, `tests/browser/theme-storage.spec.ts`. Modify `packages/storage/src/{index,indexeddb-store,project-bundle}.ts` and resource manifest validation.

**Interfaces:** `ThemeLibrary` 提供 `put(converted:ConvertedTheme, signal:AbortSignal):Promise<{id:string;existing:boolean}>`、`list():Promise<ImportedTheme[]>`、`get(id:string):Promise<ConvertedTheme>`、`remove(id:string):Promise<void>`；实现类 `IndexedDbThemeLibrary`。主题文件与元数据放独立 DB 的单事务；主题库不直接写入项目。

- [ ] 写失败测试 `deduplicatesByContentWithoutNameCollisions`：同包改名返回 existing；同名不同字节保留两个；版本顺序确定。
- [ ] 写失败测试 `failedImportLeavesNoSelectableTheme`：模拟 quota 和取消，DB 无半成品；再次导入成功；库删除不删已经复制到项目的资源。
- [ ] 写失败测试 `countsPhotosSeparatelyFromTemplateResources`：500 照片+700 装饰有效，501 照片或2001 非照片资源失败；旧无 usage 记录仍按 photo；备份恢复保留 usage、mask 和源模板引用。
- [ ] 运行 `npm test -- packages/storage` 与 `CHROMIUM_PATH=/usr/bin/chromium npm run test:browser -- tests/browser/theme-storage.spec.ts`，确认红灯。
- [ ] 实现事务与角色额度，迁移/兼容旧备份；不同项目资源复制使用标准 ResourceWriter，不复用库资源生命周期。只复制所应用页及其 mask/font 的依赖闭包。
- [ ] 测试通过，提交 `feat(storage): add private transactional theme library`。

### Task 5: Import, preview and compatibility UI

**Files:** Create `apps/web/src/templates/{ThemeLibraryPanel,ThemeDetails,ImportReport,import-controller,import-worker}` with matching TS/TSX extensions. Modify `apps/web/src/editor/{LibraryPanel,Editor}.tsx`, `apps/web/src/App.tsx`, `apps/web/src/styles.css`. Create `tests/browser/theme-library.spec.ts`.

**Interfaces:** `importTheme(file:File, library:ThemeLibrary, signal:AbortSignal, onProgress:(stage:string)=>void):Promise<ImportedTheme>`；重工作放 Worker。`ThemeLibraryPanel` 接收当前资源和任务 6 的应用回调；源预览与转换预览明确区分。

- [ ] 写失败测试 `importsAndBrowsesFifteenPageTheme`：本地文件选择、阶段进度、取消、主题卡片、15 页顺序、页号、槽数与大图；刷新仍在；支持键盘焦点与窄屏。
- [ ] 写失败测试 `unsupportedPagesCannotSilentlyApply`：blocker 页可看源预览但禁用应用，报告明确节点和原因；字体回退显示“外观保留”，不能标记为普通文字。
- [ ] 运行 `CHROMIUM_PATH=/usr/bin/chromium npm run test:browser -- tests/browser/theme-library.spec.ts`，确认红灯。
- [ ] 在模板库提供“内置模板 / 我的模板”和“导入 .mjtpl”；导入只预览不改作品。超过 32MiB 的文件按产品限制处理；本地字体替换是显式操作，预览差异后才改变文字层。
- [ ] 同测试通过，提交 `feat(web): browse and preview imported template themes`。

### Task 6: Atomic application and photo replacement

**Files:** Create `packages/template-import/src/apply.ts` and tests; modify `apps/web/src/editor/{Editor,PropertiesPanel,AssetPanel}.tsx`, `apps/web/src/state/history.ts`, `apps/web/src/templates/ThemeDetails.tsx`.

**Interfaces:** `prepareThemeApplication(theme:ImportedTheme,pageIds:readonly string[],bindings:ReadonlyMap<string,string>,doc:DocumentModel):{command:DocumentCommand;requiredResourceIds:readonly string[]}`。`EditorProps` 的资源更新与 execute 接口增加一个明确的 `applyImportedTheme` 入口：先 stage 项目依赖资源，检查 revisionToken，再提交一次文档+资源视图更新。

- [ ] 写失败测试 `appliesAndUndoesOneImportedPage`：新 ID、选片绑定、背景、顺序与 template 引用正确；原片不丢，其他跨页不变，撤销恢复文档和资源视图。资源字节允许由垃圾回收后续清理，不能因撤销失去 redo 依赖。
- [ ] 写失败测试 `rejectsStaleOrPartiallyReadyApplication`：字体/素材加载失败、revisionToken 变化、锁定跨页或 quota 失败均不提交半页。
- [ ] 写失败测试 `decorationsDoNotAppearAsUserPhotos`：照片面板/500 张统计/选片/批量滤镜仅包含 usage photo；演示样片不冒充用户选片；替换保留模板 mask 和几何，不能保留旧样片裁剪误伤新片。
- [ ] 运行对应 unit 和 theme-library 浏览器测试，确认红灯，再实现入口。模板库跨页最大 50，应用到不同比例的项目时明确阻止或由用户创建匹配尺寸项目，不拉伸。
- [ ] 同测试通过，提交 `feat(editor): apply imported template pages atomically`。

### Task 7: Whole-book theme layout

**Files:** Create `packages/layout/src/theme-layout.ts` and tests. Modify `packages/layout/src/{types,integrity,apply}.ts`, `apps/web/src/layout/{LayoutWizard,layout-controller,layout-worker}.ts(x)`，`packages/export/src/preflight.ts`。

**Interfaces:** `generateThemeCandidates(input:LayoutInput,before:DocumentModel,theme:ImportedTheme,selectedPageIds:readonly string[]):Promise<LayoutCandidate[]>`；上下文携带 theme sourceHash 与有序页面身份；现有普通模板接口保持兼容。

- [ ] 写失败测试 `usesThemePageSequenceWithoutGridFallback`：15 页不同槽数组合按所选顺序排版，符合照片横竖比；有效分配不漏不重；无法满足时报容量冲突，不自动换通用网格。
- [ ] 写失败测试 `preservesLocksAndRejectsStaleThemeCandidates`：锁定页/层、必选/允许选片策略沿用 C2；源包或页序改变导致 hash 变化；修改候选内装饰不绕过完整性校验。
- [ ] 运行 `npm test -- packages/layout`，确认红灯。
- [ ] 基于真实槽容量分配，复用候选验证与一次应用命令。项目模板来源注册表支持项目内 content-addressed 导入页；导出不能只接受全局内置 templateRefs，也不能因此跳过签名验证。
- [ ] 测试通过并完成整本应用/撤销浏览器测试，提交 `feat(layout): compose whole books from imported theme pages`。

### Task 8: Real sample fidelity, backup and release

**Files:** Create `scripts/verify-mjtpl-samples.ts`, `tests/browser/mjtpl-export.spec.ts`, `docs/implementation/mjtpl-import/{README,acceptance-results}.md/json`（各自正确扩展名）。样本使用执行器附件路径或 `MJTPL_SAMPLE_DIR`，原始包/图片/字体不提交仓库。

**Interfaces:** 验证脚本接收 `--dir <path>`，输出逐包 sourceHash、页数、槽数、warnings/blockers 与代表页比较记录；没有样本时明确 skipped，不伪装通过。

- [ ] 写失败验收：六包页数分别15/15/15/15/15/30，槽总数分别45/55/69/45/70/78；每主题选代表页，比较源预览与转换渲染，差异处给出对应兼容性报告。
- [ ] 验证 `.album` 备份→新浏览器恢复→删除主题库→作品再打开→PNG/JPEG/PDF 导出，蒙版、字体和裁剪均保留；包中旧样片不被当作漏片/重复片。
- [ ] 运行 `npm test`、`npm run build`、`CHROMIUM_PATH=/usr/bin/chromium npm run test:browser` 和真实样本验证脚本，记录实际结果。构建既有大 chunk 提示与功能错误分开报告。
- [ ] 对照规格逐条检查；请求独立分支代码审查，修复 important 问题；未能准确转换的页保持 blocker，不用源预览冒充转换成功。
- [ ] 发布代码到现有开发分支并等待 Pages 部署成功；检查公共产物无上传包和人物样片。5 个超32MiB且当前未读取的包保持“未验证”，不阻断已验证格式能力发布，也不宣称其支持成功。
- [ ] 提交最终验证记录和用户操作说明；交付测试站链接、已验证主题范围、明确的兼容性限制。

## Self-review

规格导入部分覆盖：解析/边界→1；格式/字体→2；蒙版与导出一致→3；本地存储/删除/去重→4；主题预览→5；换片/一次撤销→6；整本排版与完整性→7；真实样本/备份/部署→8。
导入角色额度与现有500照片限制的冲突已在任务4/6处理；项目导出仅认可内置模板的冲突在任务7处理。
本次不实施原创96个跨页；仍采用同一场景模型/渲染器，没有平行编辑器。所有未验证样本和不支持场景都有明确失败语义。
