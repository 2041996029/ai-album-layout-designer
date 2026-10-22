# C1 真实程序导出样片

这些文件由共享编辑/导出内核及固定 Chromium 命令行实际生成。输入为程序原创几何风景插画，文字使用本地 OFL Noto Sans SC；不是摄影成片，也不是 AI 生图功能输出。旧目录的婚礼 AI 设计示意与这些实际导出文件分别保留。

- [PNG](png/0001-spread-01.png)：600×300mm，300DPI，四边3mm出血，7157×3614px。
- [JPEG](jpeg/0001-spread-01.jpg)：相同尺寸和DPI，JFIF密度，白色透明底色。
- [PDF](pdf/album-r12.pdf)：4个内页＋独立封面正背面，共6页；每页裁切300×300mm，含出血306×306mm，普通sRGB栅格PDF。
- [可恢复项目包](project.zip)、[编辑文档](document.json)、三个 `snapshot-*.json` 固定版本12。
- 各格式子目录含 `manifest.json`、`preflight.json`、`environment.json`，记录文件 SHA、快照、资源版本与实际环境。

复现：`npm ci && npm run build`，再按 `docs/implementation/c1/README.md` 执行 `render:snapshot`，替换不同格式快照与输出目录。`npm run verify:artifacts -- docs/export-samples/program-c1` 从实际文件验证 SHA、像素尺寸、DPI、PDF 页框和版本绑定。

CLI 环境记录的峰值内存是 Node 进程自身观测，**不包含 Chromium 子进程**，不能作为整体性能指标或上线 SLA。执行耗时受当前共享环境影响。
