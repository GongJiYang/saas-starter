# 高频多 SKU 广告生产原子化任务

本文件拆解 `docs/product/bulk-sku-production-direction.md` 的批量实施任务，并承载 `docs/product/shot-skill-card-blueprint.md` 的第一阶段 MVP。每项任务只交付一个可验证结果，不把数据模型、Server Action、Worker、查询和页面混在同一任务。

任务覆盖：Shot Skill Card 第一阶段 MVP、大部分结果不满意时的止损与补救、生成前规避、可选参考视频、禁止未授权一比一复刻、CSV 导入、SKU Catalog 表和 Production Batch 状态表。

## 0. 前提与执行规则

### 已复用能力

```text
User / Team / Membership / RBAC
BrandKit
Asset 与 COS 签名上传下载
Campaign
BullMQ / Redis Worker
MiniMax H3 提交和轮询
VideoJob
Review 与活动日志
```

### 必须先完成的前置合同

`docs/product/market-validation-mvp.md` 定义的单 SKU `AdPlan / ShotPlan / ShotVersion / AdVersion / QualityAssessment` 垂直切片必须先通过。批量任务不得继续复用旧的“ShotCard 对应一条 5 秒候选”语义。

### 原子任务规则

- 一个任务只改变一个可观察行为；
- 每个写操作必须显式接收并校验 `teamId`；
- CSV 导入不得直接创建 VideoJob；
- 未批准的 Creative Spec 不得入队；
- Pilot 未通过不得释放剩余 SKU；
- 暂停只影响未调度任务；
- 不实施 CreditLedger、Checkout、多供应商路由或广告平台投放；
- 第一阶段 Shot Skill Card 只允许仓库内受控定义，不提供用户 Prompt 覆盖、导入或市场；
- 每项任务完成时执行该任务描述中的最小验证，不提前运行全套项目检查。

## A. 产品验证门

| ID | 原子任务 | 可验证完成结果 | 前置 |
|---|---|---|---|
| GATE-01 | 完成单 SKU 完整广告垂直切片 | 一个真实 SKU 交付三条完整广告且至少两条可真实使用 | `market-validation-mvp.md` |
| GATE-02 | 准备真实多 SKU 验证资料 | 一个目标客户提供至少 20 个有授权 SKU 和实际表格字段 | GATE-01 |
| GATE-03 | 记录客户现有生产基线 | 记录每 SKU 人工分钟数、使用工具、成本、返工率和采用率 | GATE-02 |
| GATE-04 | 手工执行 CSV 预检流程 | 20 行资料能被分类为 ready 或明确的 needs_input | GATE-02 |
| GATE-05 | 手工生成三份 Creative Spec | 客户能理解并审批 Angle、Hook、主体结构和禁止元素 | GATE-04、SKILL-16 |
| GATE-06 | 选择三个代表 Pilot SKU | 三个 SKU 覆盖至少两个类别和不同素材风险 | GATE-05 |
| GATE-07 | 完成 Pilot 完整广告审批 | 至少两个 Pilot SKU 各有一条广告被采用且无商品错误 | GATE-06 |
| GATE-08 | 决定是否进入批量开发 | 只有相对客户基线更省时且 Pilot 通过才解锁 CONTRACT-01 | GATE-03、GATE-07 |

## A1. Shot Skill Card 第一阶段 MVP

完整功能蓝图见 `docs/product/shot-skill-card-blueprint.md`。本阶段只验证三个内部镜头卡和 MiniMax H3 编译器，不建设数据库 Skill 表、用户编辑器、导入导出、动态 Lorebook、公开市场或多供应商适配。

| ID | 原子任务 | 可验证完成结果 | 前置 |
|---|---|---|---|
| SKILL-01 | 冻结精简镜头卡 Schema | 只保留 MVP 真正读取的标识、资格、输入、语法、约束、QA 和 H3 字段 | GATE-01 |
| SKILL-02 | 冻结 Prompt 合并优先级 | 商品事实、Brand Kit、Creative Spec、Skill 和供应商字段冲突时只有一个确定结果 | SKILL-01 |
| SKILL-03 | 实现镜头卡 Zod 校验 | 非法版本、未知字段、空约束和越权配置在加载时明确失败 | SKILL-01 |
| SKILL-04 | 编写 product-hero 内部卡 | 主图输入可编译单商品英雄镜头规则和阻塞 QA | SKILL-03 |
| SKILL-05 | 编写 product-macro-detail 内部卡 | 缺少细节图时不可选择，满足输入时编译微距时间语法 | SKILL-03 |
| SKILL-06 | 编写 product-use-case 内部卡 | 缺少合法场景或人物授权时不可请求对应内容 | SKILL-03 |
| SKILL-07 | 建立只读镜头卡 Registry | 三个唯一 ID 和版本可加载，重复 ID 或版本使启动失败 | SKILL-04 至 SKILL-06 |
| SKILL-08 | 实现确定性 Eligibility 计算 | 相同结构化 Brief 和 Shot role 始终返回相同 eligible 卡片集合及原因 | SKILL-07 |
| SKILL-09 | 实现镜头卡 Prompt 编译器 | 相同稳定输入、版本和顺序生成相同 provider-neutral 配方和 hash，签名 URL 与执行时间不参与哈希 | SKILL-02、SKILL-08 |
| SKILL-10 | 实现 MiniMax H3 Skill Adapter | provider-neutral 配方转换为当前 H3 请求且不丢失上层约束 | SKILL-09 |
| SKILL-11 | 绑定 Skill 版本到 ShotPlan | 每个生成式 ShotPlan 保存明确 skillId、version 和 hash | SKILL-10 |
| SKILL-12 | 冻结 Skill 到 GenerationRecipe | 重试读取冻结快照，不能自动切换 Registry 中的新版本 | SKILL-11 |
| SKILL-13 | 映射 Skill 阻塞质量检查 | 三个卡片的阻塞 QA 进入 QualityAssessment 且不合格镜头不能组装 | SKILL-07、单 SKU QA 基线 |
| SKILL-14 | 生成 Prompt CompilationTrace | 每个最终字段可追溯来源、覆盖关系、Skill 版本和 Prompt hash | SKILL-09、SKILL-12 |
| SKILL-15 | 运行同输入 A/B 基准实验 | 同一组真实 SKU、素材、参数比较旧 Prompt 与 Skill Prompt 的质量、重试、成本和耗时 | SKILL-12 至 SKILL-14 |
| SKILL-16 | 决定是否保留 Skill MVP | 至少一个核心指标改善且商品一致性等阻塞指标不退化才允许进入 Pilot | SKILL-15 |

## B. 产品与数据合同

| ID | 原子任务 | 可验证完成结果 | 前置 |
|---|---|---|---|
| CONTRACT-01 | 冻结 CSV 模板版本契约 | `v1` 列名、必填、可选、类型和最大行数有唯一机器契约 | GATE-08 |
| CONTRACT-02 | 冻结 SKU Readiness 规则 | 每条规则有字段、错误码、阻塞级别和用户修复说明 | CONTRACT-01 |
| CONTRACT-03 | 冻结参考视频权利契约 | `owned / licensed / inspiration_only` 的允许和禁止行为明确 | GATE-08 |
| CONTRACT-04 | 冻结 Reference Analysis 契约 | 只允许保存结构属性，不包含未授权原文、原音频或身份素材 | CONTRACT-03 |
| CONTRACT-05 | 冻结 Creative Spec 契约 | Angle、Hook、Shot List、证据、约束、参考结构和成本字段固定 | CONTRACT-02、CONTRACT-04 |
| CONTRACT-06 | 冻结批次状态迁移规则 | ProductionBatch 每个合法迁移、操作者和失败条件明确 | CONTRACT-05 |
| CONTRACT-07 | 冻结 Pilot 通过规则 | 最多三个 Pilot、至少两个采用、无未解决商品错误 | CONTRACT-06 |
| CONTRACT-08 | 冻结 Wave 暂停阈值 | 商品错误、同因拒绝率、供应商错误率和成本上限有明确公式 | CONTRACT-07 |
| CONTRACT-09 | 冻结补救责任分类 | technical、fidelity、spec_mismatch、preference_change、brief_change 唯一映射处理方式 | CONTRACT-05 |
| CONTRACT-10 | 冻结批次成本确认契约 | 用户看到镜头数、重试准备金、最大预计成本，不出现抽象积分 | CONTRACT-08 |

## C. 批量领域数据模型

| ID | 原子任务 | 可验证完成结果 | 前置 |
|---|---|---|---|
| DATA-01 | 新增批量领域状态枚举 | ImportBatch、CatalogItem、CreativeSpecVersion、ProductionBatch 状态只接受合同值 | CONTRACT-06 |
| DATA-02 | 新增 CatalogItem 表 | Workspace 可用 `externalSku` 唯一保存商品资料和 readiness 状态 | DATA-01 |
| DATA-03 | 关联 CatalogItem 商品素材 | 一个 CatalogItem 可按用途和顺序关联现有 Asset | DATA-02 |
| DATA-04 | 新增 ImportBatch 表 | 文件 key、哈希、模板版本、汇总数量和状态按 team 保存 | DATA-01 |
| DATA-05 | 新增 ImportRow 表 | 原始值、规范化值、行号、错误列表和提交状态可追溯 | DATA-04 |
| DATA-06 | 新增 CreativeReference 表 | 参考素材、权利模式、来源和团队归属可保存 | CONTRACT-03、DATA-01 |
| DATA-07 | 新增 ReferenceAnalysis 表 | 结构分析版本、模型、结果和排除项关联参考素材 | DATA-06 |
| DATA-08 | 新增 ProductionBatch 表 | 批次默认值、Pilot 规则、Wave 大小、阈值和成本上限可保存 | DATA-01 |
| DATA-09 | 新增 ProductionBatchItem 表 | 每个批次行唯一关联 CatalogItem 和独立 Campaign | DATA-02、DATA-08 |
| DATA-10 | 新增 CreativeSpecVersion 表 | 每个 Campaign 的草稿、审批快照和 superseded 关系可追溯 | CONTRACT-05 |
| DATA-11 | 关联参考分析与规格版本 | CreativeSpecVersion 可引用零或一个 ReferenceAnalysis | DATA-07、DATA-10 |
| DATA-12 | 增加批量唯一约束和索引 | 团队、状态、批次、SKU、Wave 常用查询有约束和索引 | DATA-02 至 DATA-11 |
| DATA-13 | 生成批量领域 Drizzle migration | 空库和现有库升级后获得相同批量结构 | DATA-12 |
| DATA-14 | 增加团队范围批量查询基元 | 未传 teamId 的 Catalog、Import、Batch 查询无法调用 | DATA-13 |
| DATA-15 | 增加批量领域推断类型导出 | 所有新表导出 select / insert 类型且 TypeScript 可解析 | DATA-13 |

## D. CSV 模板、上传与解析

| ID | 原子任务 | 可验证完成结果 | 前置 |
|---|---|---|---|
| CSV-01 | 选择服务端 RFC CSV 解析器 | 带引号、逗号、换行和 UTF-8 BOM 的文件解析一致 | CONTRACT-01 |
| CSV-02 | 生成 Workspace CSV 模板 | 下载文件包含 v1 表头、字段说明和当前 Brand Kit ID 示例 | CSV-01、DATA-14 |
| CSV-03 | 签发 CSV 专用上传 URL | 只允许当前团队、`.csv` MIME、大小上限和限定对象 key | DATA-14 |
| CSV-04 | 创建 ImportBatch 写入操作 | 上传完成后以文件哈希和 idempotency key 创建一次导入记录 | DATA-04、CSV-03 |
| CSV-05 | 建立 CSV 解析 Worker | Worker 读取对象存储文件并写入逐行原始值 | DATA-05、CSV-01、CSV-04 |
| CSV-06 | 实现 CSV 表头版本校验 | 缺列、未知版本或重复列返回确定错误码 | CSV-05、CONTRACT-01 |
| CSV-07 | 实现 CSV 单元格规范化 | 空白、URL、枚举、时长和展开列表列产生统一规范值 | CSV-06 |
| CSV-08 | 实现逐行字段规则校验 | 错误精确记录到 rowNumber、column 和 readiness error code | CSV-07、CONTRACT-02 |
| CSV-09 | 实现导入内重复 SKU 检查 | 同一文件重复 externalSku 的每一行都可见且不可提交 | CSV-08 |
| CSV-10 | 实现 Catalog 重复 SKU 检查 | 用户可明确选择更新现有 SKU 或排除重复行 | CSV-08、DATA-02 |
| CSV-11 | 实现素材 URL 安全校验 | 只接受 HTTPS，拒绝私网、回环、超限重定向和非法端口 | CSV-08 |
| CSV-12 | 建立远程素材归档 Worker | 合法 URL 经 MIME、大小和内容检查后写入团队对象存储 | CSV-11、DATA-03 |
| CSV-13 | 计算 SKU Readiness 结果 | 每行输出 ready 或完整、可解释的阻塞原因 | CSV-08、CSV-12 |
| CSV-14 | 查询 ImportBatch 预览数据 | 服务端分页返回行值、错误、重复决策和 readiness 汇总 | CSV-13、DATA-14 |
| CSV-15 | 实现单行导入修复操作 | 用户修改一行后只重跑该行规范化和 readiness | CSV-14 |
| CSV-16 | 实现批量排除错误行操作 | 被排除行保留审计记录且不参与提交 | CSV-14 |
| CSV-17 | 提交 ready 行到 Catalog | 一个事务只写入确认后的 ready 行并更新 ImportBatch 汇总 | CSV-10、CSV-13、CSV-16 |
| CSV-18 | 验证 CSV 提交幂等性 | 重放相同提交不会创建重复 CatalogItem 或素材关联 | CSV-17 |
| CSV-19 | 导出逐行错误 CSV | 下载文件保留原行并增加 error_code、column、message | CSV-14 |

## E. 参考视频与结构分析

| ID | 原子任务 | 可验证完成结果 | 前置 |
|---|---|---|---|
| REF-01 | 签发参考视频上传 URL | 只允许当前团队、支持的格式、大小和限定对象 key | DATA-06 |
| REF-02 | 保存参考视频权利声明 | 未选择权利模式不能创建 CreativeReference | CONTRACT-03、REF-01 |
| REF-03 | 拒绝未授权复刻请求 | inspiration_only 无法选择自有模板复用模式 | REF-02 |
| REF-04 | 探测参考视频技术属性 | 保存时长、比例、编码、音轨和可读取状态 | REF-02 |
| REF-05 | 定义结构分析 Zod Schema | 镜头边界、节奏、构图、字幕区和 CTA 字段可严格解析 | CONTRACT-04 |
| REF-06 | 建立参考视频分析 Worker | 一个 CreativeReference 只创建一次可重放分析任务 | REF-04、REF-05 |
| REF-07 | 提取参考视频镜头边界 | 输出有序且不重叠、覆盖合法时长的镜头段 | REF-06 |
| REF-08 | 提取允许的结构属性 | 输出景别、运动、节奏、字幕区、转场和 CTA，不输出原文案 | REF-07 |
| REF-09 | 生成 Reference Analysis 摘要 | 用户能看到“借用什么”和“明确不复制什么” | REF-08、DATA-07 |
| REF-10 | 实现 Reference Analysis 审批 | 未审批分析不能进入 CreativeSpecVersion | REF-09 |
| REF-11 | 绑定参考分析到单个 SKU | Batch 默认参考可被某行显式覆盖或移除 | REF-10、DATA-11 |
| REF-12 | 基准测试 H3 reference_video 模式 | 只记录成本、连续性和商品准确率，不进入默认生产路径 | GATE-07、REF-10 |
| REF-13 | 决定自有模板视频直传门 | 只有 REF-12 明确优于结构提取时才允许配置开启 | REF-12 |

## F. Creative Spec 与生成前审批

| ID | 原子任务 | 可验证完成结果 | 前置 |
|---|---|---|---|
| SPEC-01 | 实现 CatalogItem Brief 编译器 | ready SKU 与 Batch 默认值编译成冻结 Product Brief | DATA-02、CONTRACT-05 |
| SPEC-02 | 实现适用 Angle 资格过滤 | 缺证据的 comparison、social proof、offer 等角度不会入选 | SPEC-01 |
| SPEC-03 | 生成三个排序 Angle Proposal | 每个建议包含理由、证据要求、风险和来源字段 | SPEC-02 |
| SPEC-04 | 保存 Selected Creative Angle | 一个 Spec 版本只允许选择一个当前 Proposal | SPEC-03、DATA-10 |
| SPEC-05 | 生成三个受控 Hook Variant | 三个 Hook 共享 Selected Angle 且只改变前五秒表达 | SPEC-04 |
| SPEC-06 | 编译共享主体 Shot List | 三个 AdVersion 引用同一主体、卖点、字幕、音乐和 CTA 结构 | SPEC-05 |
| SPEC-07 | 合并批准参考结构属性 | 只合并 ReferenceAnalysis 允许字段并记录来源 | SPEC-06、REF-10 |
| SPEC-08 | 生成确定性 Spec 预览 | 无视频调用即可查看 Hook、Shot List、约束、参考和预计成本 | SPEC-07、CONTRACT-10 |
| SPEC-09 | 提交 Creative Spec 审批 | 状态从 draft 进入 awaiting_approval 且内容快照不可变 | SPEC-08 |
| SPEC-10 | 实现 Creative Spec 采用操作 | 审批人、时间和版本保存后状态变为 approved | SPEC-09 |
| SPEC-11 | 实现 Creative Spec 驳回操作 | 必须选择结构化原因并可创建后继草稿版本 | SPEC-09、CONTRACT-09 |
| SPEC-12 | 阻止未批准 Spec 创建任务 | 直接调用入队服务也不能绕过 approved 状态 | SPEC-10 |
| SPEC-13 | 实现批量 Spec 共同字段更新 | 更新 Batch 默认值只创建受影响行的新草稿版本 | SPEC-11、DATA-09 |
| SPEC-14 | 实现批量 Spec 审批操作 | 只批准当前用户选中的 awaiting_approval 版本 | SPEC-10、DATA-14 |

## G. Production Batch、Pilot 与 Wave

| ID | 原子任务 | 可验证完成结果 | 前置 |
|---|---|---|---|
| BATCH-01 | 创建 Production Batch 操作 | 只接受当前团队的 ready CatalogItem 且去重保存 | DATA-09、CSV-17 |
| BATCH-02 | 保存 Batch 默认生产参数 | Brand Kit、平台、目标、时长、参考和 Wave 大小冻结 | BATCH-01、CONTRACT-10 |
| BATCH-03 | 估算 Batch 最大模型成本 | 逐行镜头数、重试准备金和批次总上限可复算 | BATCH-02、SPEC-08 |
| BATCH-04 | 确认 Batch 成本上限 | 未确认或 Spec 改版后旧确认自动失效 | BATCH-03 |
| BATCH-05 | 计算 SKU 视觉风险等级 | 根据类别、素材数量、文字包装和参考复杂度输出可解释等级 | BATCH-02 |
| BATCH-06 | 选择代表 Pilot SKU | 最多三个，覆盖类别和最高风险且结果确定可重现 | BATCH-05、CONTRACT-07 |
| BATCH-07 | 创建 Pilot Campaign 记录 | 每个 Pilot Item 创建独立 Campaign 并绑定 approved Spec | BATCH-06、SPEC-12、BATCH-04 |
| BATCH-08 | 创建 Pilot 镜头任务 | 只为 Pilot Campaign 创建 ShotVersion 和 VideoJob | BATCH-07 |
| BATCH-09 | 汇总 Pilot 审批结果 | 输出采用 SKU 数、商品错误和未决项 | BATCH-08 |
| BATCH-10 | 执行 Pilot 通过判定 | 只有合同条件满足才进入 ready，其他情况进入 pilot_review | BATCH-09、CONTRACT-07 |
| BATCH-11 | 分配剩余 SKU Wave 序号 | 非 Pilot Item 按风险和配置大小获得稳定 Wave 顺序 | BATCH-10 |
| BATCH-12 | 调度下一 Wave 入队 | 只调度当前可释放 Wave，重复调用不重复入队 | BATCH-11 |
| BATCH-13 | 限制 Workspace 并发任务 | 新 Wave 不超过团队和供应商并发上限 | BATCH-12 |
| BATCH-14 | 聚合 Batch 实时进度 | 返回总数、未就绪、Pilot、排队、生成、质检、审批和完成数 | BATCH-12、DATA-14 |
| BATCH-15 | 实现暂停未调度任务 | paused 后不再释放新 Wave，已提交任务继续归档 | BATCH-12 |
| BATCH-16 | 实现恢复批次调度 | 仅阻塞原因解除且成本确认仍有效时恢复下一 Wave | BATCH-15 |
| BATCH-17 | 实现取消未调度任务 | 只取消尚未入队 Item，不伪造外部任务取消成功 | BATCH-15 |
| BATCH-18 | 保证 Batch 操作幂等 | 创建、确认、调度、暂停、恢复重复提交均不产生重复副作用 | BATCH-01 至 BATCH-17 |

## H. 质量门、止损与补救

| ID | 原子任务 | 可验证完成结果 | 前置 |
|---|---|---|---|
| QA-01 | 运行镜头技术质量检查 | 编码、比例、时长、可播放性和音频检查有结构化结果 | 单 SKU QA 基线 |
| QA-02 | 运行商品一致性质量检查 | 商品数量、包装、颜色、Logo 和 immutable elements 有结构化结果 | QA-01 |
| QA-03 | 运行 Creative Spec 一致性检查 | Angle、Hook、批准卖点、禁止元素、字幕和 CTA 可对照 Spec | QA-01、SPEC-10 |
| QA-04 | 分类质量失败责任 | 每个失败唯一映射 technical、fidelity 或 spec_mismatch | QA-02、QA-03、CONTRACT-09 |
| QA-05 | 自动重试技术失败镜头 | 只创建失败 ShotPlan 的新 ShotVersion 并遵守上限 | QA-04 |
| QA-06 | 阻止商品错误进入 AdVersion | fidelity 未通过的镜头不能被组装或交付 | QA-02 |
| QA-07 | 记录 Wave 商品失败计数 | 两个不同 SKU 失败可被阈值计算器识别 | QA-04、BATCH-12 |
| QA-08 | 计算同因人工拒绝率 | 至少五个结论后按批次级原因计算拒绝比例 | CONTRACT-08、BATCH-14 |
| QA-09 | 计算供应商错误和成本偏差 | 当前 Wave 的错误率与实际成本可对照确认上限 | CONTRACT-08、BATCH-14 |
| QA-10 | 自动触发 Batch 暂停 | 任一止损阈值成立时只调用暂停路径一次 | QA-07 至 QA-09、BATCH-15 |
| QA-11 | 创建批次补救 Spec 版本 | 保留旧版本和已采用结果，仅修改选定批次级字段 | SPEC-11、QA-10 |
| QA-12 | 创建补救 Canary 任务 | 只为二至三个被拒 SKU 生成新版本，不重跑整批 | QA-11、BATCH-08 |
| QA-13 | 判定补救 Canary 结果 | Canary 通过才允许剩余未调度 Item 绑定新 Spec | QA-12、BATCH-16 |
| QA-14 | 记录每次重生成原因成本 | 每个新 ShotVersion 可追溯原因、旧版本、责任和实际成本 | QA-05、QA-12 |

## I. SKU Catalog 与批次表格页面

| ID | 原子任务 | 可验证完成结果 | 前置 |
|---|---|---|---|
| UI-01 | 增加 Catalog 和 Batch 导航 | 当前 Workspace 成员可访问两个新入口 | DATA-14 |
| UI-02 | 构建 Catalog 分页查询 | 每页 50 行并支持状态、Brand Kit、类别和更新时间筛选 | DATA-14 |
| UI-03 | 渲染 SKU Catalog 表格 | 显示缩略图、SKU、商品名、readiness、Brand Kit 和更新时间 | UI-02 |
| UI-04 | 构建 CSV 导入弹窗 | 可下载模板、上传文件并看到解析状态 | CSV-02 至 CSV-05 |
| UI-05 | 渲染 CSV 导入预览表 | 逐行显示错误列、重复决策、readiness 和排除状态 | CSV-14 |
| UI-06 | 构建导入行修复抽屉 | 修改一行后局部刷新校验结果，不重传整个文件 | CSV-15 |
| UI-07 | 增加导入提交确认界面 | 明确显示新增、更新、排除和错误行数量 | CSV-17 |
| UI-08 | 构建 Catalog 批量选择操作 | 只能选择 ready 行创建 Production Batch | BATCH-01、UI-03 |
| UI-09 | 构建 Batch 默认值表单 | 可设置 Brand Kit、平台、目标、时长、参考和 Wave 大小 | BATCH-02 |
| UI-10 | 渲染成本和 Pilot 确认页 | 显示代表 SKU、预计镜头数、最大成本和确认状态 | BATCH-03、BATCH-06 |
| UI-11 | 构建 Creative Spec 审批页 | 可查看 Angle、三个 Hook、主体、约束、参考摘要和成本 | SPEC-08 至 SPEC-11 |
| UI-12 | 构建批量 Spec 审批操作栏 | 只对选中且可审批行执行批准或驳回 | SPEC-14 |
| UI-13 | 构建 Batch 分页状态查询 | 支持 Wave、Campaign、生成、QA、Review 和失败原因筛选 | BATCH-14 |
| UI-14 | 渲染 Production Batch 表格 | 每行显示 SKU、Spec、Pilot/Wave、进度、成本、结果和操作 | UI-13 |
| UI-15 | 增加 Batch 暂停恢复操作 | 用户看到暂停原因并只能执行合法状态操作 | BATCH-15、BATCH-16、UI-14 |
| UI-16 | 增加批量取消确认操作 | 明确提示只取消未调度行并显示影响数量 | BATCH-17、UI-14 |
| UI-17 | 渲染参考视频分析抽屉 | 展示权利模式、借用结构、排除内容和审批状态 | REF-09、REF-10 |
| UI-18 | 保持表格键盘和读屏可用 | 表头、筛选、复选框、状态和错误均有可访问名称 | UI-03、UI-05、UI-14 |

## J. 审批、反馈、导出与运营保护

| ID | 原子任务 | 可验证完成结果 | 前置 |
|---|---|---|---|
| REVIEW-01 | 扩展结构化拒绝原因枚举 | 原因可区分行级、批次级和责任分类 | CONTRACT-09 |
| REVIEW-02 | 保存 AdVersion 审批结论 | 采用或拒绝关联 Spec 版本、审批人和时间 | 单 SKU Review 基线 |
| REVIEW-03 | 汇总 Batch 审批指标 | 返回 ready SKU 采用率、批次拒绝率和原因分布 | REVIEW-01、REVIEW-02、BATCH-14 |
| REVIEW-04 | 构建批次问题汇总视图 | 用户可看到共同问题、受影响 SKU 和建议补救字段 | REVIEW-03、QA-10 |
| REVIEW-05 | 实现保存 Brand Preference 操作 | 只有显式确认才将选定反馈写入 Brand Kit 新版本 | REVIEW-04 |
| REVIEW-06 | 防止单次拒绝自动学习 | 未执行 REVIEW-05 时后续 Spec 输入保持不变 | REVIEW-05 |
| EXPORT-01 | 导出 Batch 状态 CSV | 文件包含 SKU、状态、成本、采用结果、失败原因和结果 URL | BATCH-14、REVIEW-03 |
| EXPORT-02 | 导出已采用广告包 | 只包含已采用 AdVersion、批准文案、事实和审批记录 | REVIEW-02、对象存储下载基线 |
| EXPORT-03 | 保持未采用资产团队隔离 | 下载和导出查询无法访问其他 Workspace 或未授权对象 key | DATA-14、EXPORT-02 |
| OPS-01 | 写入批量关键活动日志 | 导入、提交、Spec 审批、Pilot、暂停、恢复、补救和导出均留痕 | 各对应操作 |
| OPS-02 | 记录批量吞吐与成本指标 | 可观测每 Wave 耗时、重试、供应商错误和实际模型成本 | BATCH-14、QA-14 |
| OPS-03 | 增加停止条件运营告警 | 自动暂停后向 Workspace Owner 显示原因和受影响数量 | QA-10、OPS-01 |
| OPS-04 | 限制 CSV 和素材抓取频率 | 单团队、单用户和单目标主机均有请求上限 | CSV-03、CSV-12 |
| OPS-05 | 清理失败导入临时对象 | 超过保留期且未提交的 CSV 和临时素材可安全删除 | CSV-17 |
| OPS-06 | 完成批量闭环烟测 | 真实 CSV 经校验、Spec、Pilot、Wave、QA、Review 和导出完成一次 | EXPORT-03、OPS-01 至 OPS-05 |

## K. 实施阶段与并行边界

```text
P0  产品和镜头 Skill 验证
    GATE-01
    SKILL-01 至 SKILL-16
    GATE-02 至 GATE-08

P1  合同和数据模型
    CONTRACT-01 至 CONTRACT-10
    DATA-01 至 DATA-15

P2  两条可并行输入链
    CSV-01 至 CSV-19
    REF-01 至 REF-13

P3  生成前规格审批
    SPEC-01 至 SPEC-14

P4  批量调度和止损
    BATCH-01 至 BATCH-18
    QA-01 至 QA-14

P5  用户工作台
    UI-01 至 UI-18
    REVIEW-01 至 REVIEW-06

P6  交付和运营保护
    EXPORT-01 至 EXPORT-03
    OPS-01 至 OPS-06
```

GATE-02 至 GATE-04 可与 SKILL-01 至 SKILL-16 并行，GATE-05 必须等待 Skill A/B 决策。只有 CSV 链和参考视频链可以在 P2 并行。Batch 调度必须等待 Creative Spec 审批合同；批量 UI 必须等待对应查询和写操作，不能先做假数据页面。

## L. 阶段验收

| 阶段 | 必须观察到的结果 |
|---|---|
| P0 | Shot Skill A/B 至少改善一个核心指标且阻塞指标不退化；随后三个 Pilot SKU 至少两个被采用，且比原流程更省时 |
| P1 | 新表、状态、约束和团队查询可支持 Catalog、Import、Reference、Spec 与 Batch |
| P2 | 100 行 CSV 可逐行校验；参考视频只产生安全结构摘要；两者都不触发视频生成 |
| P3 | 每个 ready SKU 在生成前都有可审、版本化、成本明确的 Creative Spec |
| P4 | 未过 Pilot 不释放剩余 SKU；Wave 可暂停恢复；商品错误和同因拒绝可自动止损 |
| P5 | 用户能在普通表格内完成导入修复、批次创建、Spec 审批、状态查看和反馈 |
| P6 | 一个真实 Batch 从 CSV 到采用广告包完整交付，版本、成本、审批和活动均可追溯 |

## M. 明确删除或替换的旧语义

批量方向落地时必须 clean cutover：

```text
删除“CSV 导入后直接生成”的任何捷径
删除固定 pain / benefit / scene 的创建规则
删除 ShotCard 等同客户最终视频的语义
删除失败后无原因 Retry 的入口
删除覆盖旧 Brief、Spec 或产物的更新路径
删除“一比一复刻”客户承诺
删除绕过 Shot Skill 编译器直接拼接生产 Prompt 的路径
```

保留历史数据只用于审计；不保留旧别名、兼容写入或双轨产品流程。
