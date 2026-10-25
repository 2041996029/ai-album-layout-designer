# C1 网页编辑与真实导出

这是可运行的第一阶段实现。账号、微信支付、会员点数、AI供应商、云存储配置与服务端持久队列仍按 C2–C6 计划后续实施；本版本不提供这些服务的模拟成功入口。

## 本地运行

Node 24，执行 `npm ci`、`npm run dev`，打开终端显示的本地地址。无需云服务密钥；首次加载将随项目分发的 OFL 中文字体存入当前浏览器 IndexedDB。

网页具备照片导入与 EXIF 归一化、图层编辑、文字/形状/组合、裁剪、33种确定性 CPU 滤镜、5类原创模板、撤销重做、自动保存、项目 ZIP 备份恢复、预检及 PNG/JPEG/普通 PDF 下载。模板一次只替换当前跨页，整本 AI 智能排版后续实施。

支持桌面现代 Chromium；当前本地实际验证 Chromium 154.0.8037.57。未验证 Safari/微信小程序/移动端完整编辑。1024、1280、1920px 工作台截图见 `screenshots/`。

## 数据与恢复

- 仅保存于当前浏览器；清除浏览器数据会删除本地项目。请下载可恢复项目包。
- 保存采用 CAS revision，成功后递增。撤销保存的内容也作为新的 revision；不会倒退已提交版本。
- 备份直接读取当前内存草稿，即使保存冲突也可以备份，不覆盖冲突的已保存版本。恢复导入生成新项目 ID，记录原项目与版本。
- 撤销/重做历史仍引用的照片暂不能从素材清单移除。原片、归一化图、预览不可混用；当前未实现无引用 blob 垃圾回收。
- 资源字节按 SHA 校验。ZIP 仅接收固定路径；拒绝路径穿越、重复项、符号链接、超限和损坏资源。

## 导出契约

正式数据结构以 `docs/release-v1.0/contracts/schemas` 为准。单位 px96，sRGB。导出只能从已保存 revision 产生冻结快照。预检报告由工厂生成并深度冻结，警告确认绑定 snapshotHash，不能复用到修改后的参数。

C1 内部快照包含完整本地资源目录（字形、许可与字体子集信息）；它不是服务端 API DTO。C4 必须通过不可变资源版本目录映射为正式 API 的 object-reference snapshot，不可直接暴露本地类型。命令行反序列化后再次验证快照哈希及资源包。

PNG 写入 pHYs；JPEG 写 JFIF inch density，透明区使用指定底色；PDF 每面是一张 sRGB 栅格图，MediaBox/BleedBox 包含出血，TrimBox 为裁切尺寸。不是 PDF/X 或 CMYK 印刷文件。输出维度在加入出血后统一取整，不会静默降低 DPI。

每面最多50MP，图框缓存最多128MiB，浏览器预估工作集预算768MiB；编码/下载累计最多256MiB。预算是保守估算，不是浏览器进程 RSS 上限。PDF 逐页释放解码通道；编码字节与 PDF 对象仍有固定上限占用。500张照片、80MP源图及全部最大规格组合尚未做性能认证，超预算应分批。

缺原片、损坏资源、不可用字体/字重/字形、文字溢出、未知图层/未来 schema、未登记模板与未实现的 AI 来源/完整排版清单都会阻断导出。低清、安全区与中缝警告必须逐项接受。

## 命令行与验证

```bash
npm run build
CHROMIUM_PATH=/usr/bin/chromium npm run render:snapshot -- \
  --bundle docs/export-samples/program-c1/project.zip \
  --snapshot docs/export-samples/program-c1/snapshot-png.json \
  --output /tmp/album-output
npm run verify:artifacts -- docs/export-samples/program-c1
```

`CHROMIUM_PATH` 只用于本地系统浏览器。正常 CI 安装项目锁定的 Playwright Chromium。本地托管环境的打包浏览器下载域名返回403，因此没有绕过网络限制；跨浏览器版本不承诺编码字节一致。

CLI 是可信开发/worker 工具，不作为公网接口。随机 token/localhost 端口，仅能按快照中的资源 ID 读取；拦截外部请求。输出通过48KiB分块传回临时目录，校验完成后提交文件，取消/失败清理临时目录。合法警告可用 `--acknowledgements <warning-ids.json>` 传入 `{ "snapshotHash": "…", "warningIds": ["issue_…"] }`，只接受与该快照绑定的警告；不自动接受。

执行 `npm run typecheck`、`npm run test:unit`、`npm run build`、`CHROMIUM_PATH=/usr/bin/chromium npm run test:browser`。实际结果见 [验收记录](acceptance-results.json)。GitHub Actions 工作流见 `.github/workflows/c1.yml`；本地通过不代表远端 CI 已通过。

[真实程序样片](../../export-samples/program-c1/README.md)使用原创几何风景插画检验图框、中文、尺寸和导出链路；不代表摄影成片或 AI 生图服务已接通。33滤镜数值测试与联系表已交付，商业审美验收仍待确认。
