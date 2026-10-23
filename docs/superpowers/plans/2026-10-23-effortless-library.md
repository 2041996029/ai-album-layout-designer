# 模板与滤镜交互 Implementation Plan

**Goal:** 点击主题自动填片，主题内部展示图数版式；滤镜自动决定单张或整本范围。
**Architecture:** 复用模板实例化、命令批处理和私有导入事务；增加共享照片选择逻辑。
**Tech Stack:** React / TypeScript / Playwright / Vitest
**Spec:** docs/superpowers/specs/2026-10-23-effortless-library-design.md

- [x] 测试共享选择逻辑：选中组、无选择回退、重复素材去重、数量不足。
- [x] TemplatePanel 按 themeId 分组，主题点击自动匹配填充；内部版式按钮直接应用，调整照片收起；保护锁定与撤销。
- [x] FilterPanel 自动范围与显式整本开关，跳过锁定和装饰；测试跨页批量和撤销。
- [x] 导入页自动填片与点击应用，保留阻止不兼容页的规则。
- [x] 更新旧流程测试与新增无逐框绑定场景，运行单元、浏览器、构建；检查 UI，推送预览。

验证：183 项单元测试通过；完整浏览器运行 73 项通过，新增版式测试定位器修正后单独回归通过；类型检查、构建、滤镜清单和 PNG/JPEG/PDF 样片校验通过。
