# Schema语义、版本与示例

5份JSON Schema使用draft2020-12，无网络依赖，文件相对引用；每个均有$defs/root。document定义权威文档，layout定义请求／candidate／assignmentManifest，export定义选项／资源／快照／预检，config定义21类typed value覆盖20配置域，provider定义适配器元数据及提交／查询状态。

结构通过不代表业务通过。必须在API与worker校验：ID全局唯一、有限JSON数值、组递归总量、crop矩形和fit比例、工作区归属、素材ready与不可变hash、字体／模板许可、照片完整性和锁定、view与pageIds、像素乘积、资源内存预算、文字缺字／超框、警告确认、模型真实能力和预算。

config使用kind判别，kind等于路由namespace；API envelope与配置release独立。任何secret只能secretRef＋secretVersion引用；JSON schema禁止额外字段仍不能代替秘密分类和网络目的地校验。storage路径在URL百分号解码后检查前缀越界；元数据名称不拼云路径；endpoint需HTTPS、批准host、DNS／重定向重复验证。

跨字段约束：layout min<=max、必选／排除互斥、所有ID属于输入；config时长／租约／预算与adapter相容，weights和为1；export pageIds按文档顺序筛选、不重复、不把封面算入内页。根schema保留同版本未知图层／字段，导出遇未知层阻断；未知schemaVersion不能自动截断。

SHA对稳定canonical数据计算：对象键Unicode码点排序、数组原序、几何最多6位小数、严格JSON，不含NaN／Infinity。revision数据与引用文件hash不可变。导出snapshotHash绑定文档、manifest、选项、配置和创建时间；manifest不含签名URL或密钥。

examples为自制小型JSON输入／合同样例，不表示实际素材或供应商可用。invalid-cases.json列出应被结构或语义校验拒绝的变体；tools/validate_bundle.py会实际验证。API框架仍须使用生成DTO或等价validator，禁止只在文档包运行后假定服务端安全。
