# 交付包复核

本工具只读取设计合同、示例和资料，不启动产品、调用云服务或提交真实交易。

在交付包根目录使用Python3.12及相邻requirements中的精确工具版本：

```bash
python -m pip install -r docs/release-v1.0/tools/requirements.txt
python docs/release-v1.0/tools/validate_bundle.py
python docs/release-v1.0/tools/validate_bundle.py --archive docs/AI相册-全模块研发交付包-v1.0.zip
```

未保留ZIP原件时省略`--archive`。解压目录内不会再包含整包自身的ZIP；README中的整包下载链接用于GitHub或原件所在目录，离线阅读使用review.html。默认检查仅允许这个确切的整包ZIP下载目标缺失，并在结果中记录数量，其他本地资料链接仍须存在。使用`--archive`时还会逐项比较ZIP内资料与SHA清单及当前文件，避免只检查文件名。

校验内容：OpenAPI结构与本地引用、请求示例、JSON schema与结构／语义负例、49需求的页面／API／计划／测试映射、65页面状态与54动作权限、44任务220步骤、92表字典／ERD一致、SQL语法与本轮执行证据hash、33滤镜／5模板／3风格、PDF／Word／原型顺序、源文档与输出新鲜度、SHA及可选ZIP完整性。

SQL的实际执行说明和可重放样本位于database/。`001_initial.down.sql`是破坏性本地重置设计，有显式保护；本工具不会自动执行它，也不会连接数据库。真实并发、供应商、真机、性能和产品测试仍按实施计划执行。

`--source-only`仅供资料打包阶段使用，会跳过尚未生成的下载文件链接及尚未完成的manifest；不用于最终交付准出。最终交付应使用默认模式或`--archive`，并检查退出码0和返回范围。

manifest排除自身、会随每次复核刷新时间戳的artifact-checks报告、当前整包ZIP及其外置校验文件，以避免自引用hash循环；这些文件由ZIP整体SHA再保护。独立手册输出额外绑定其22份源文档SHA，改源未重建会被拒绝。
