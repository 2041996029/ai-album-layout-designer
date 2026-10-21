# 内容种子与许可边界

- filter-catalog.json：完整33项配方、强度、seed与原CSV SHA；kernel定义见filter-kernel.md。配方是设计合同，视觉状态仍required，不能伪造视觉验收。
- template-seeds.json：五类原创槽位设计（婚礼／旅行／亲子／写真／国风），含图框／标题／日期、可编辑字段和源坐标；不是直接提交admin templateVersion API的有效发布请求。实现需将槽位转成DocumentModel，注册有许可占位素材／字体，建立spreadId/layerId的TemplateSlot绑定，生成合法预览、licenseRef后再发布；替换绑定后产出真实文档，不以占位图作为客户成品。
- style-presets.json：山水水墨／人像淡彩／花鸟写意三份项目原创提示词草案，模型与报价未绑定且处于draft；模型商业授权／数据用途／审核标识与真实样例完成后才发布。没有调用受限Zine Skill或复制其样例。
- 字体推荐@fontsource/noto-sans-sc与noto-serif-sc各400/700真实字重、候选5.3.1/OFL-1.1，C1实施复制实际文件和许可证并计算SHA；文档不提供不存在的字体文件hash或把系统fallback当授权字体。

不可变内容版本、源文件hash、许可证据、发布时间、撤回／退役均进入后台登记。许可不明默认不可发布；会员商用权益不能替代字体／图片／模型的具体许可。生成结果来源、原始参考用途与标识随素材／导出保留。
