# 客户生成工作流优化原子化任务

状态：实施计划。本文将当前「CSV + 手填数据库 ID + 批量 Pilot」工作流优化为支持单品快速生成与批量生产的引导式产品流程，同时保留现有 Workspace 隔离、Creative Spec 冻结、Shot Skill 版本绑定、成本门、QA 和 Review 证据链。

关联文档：

- `docs/product/bulk-sku-production-atomic-tasks.md`：现有 CSV、Catalog、Batch、Pilot、Wave 实施基线；
- `docs/product/shot-skill-card-productization-atomic-tasks.md`：Shot Skill 数据库版本、编辑器和生产 QA 基线；
- `docs/product/shot-skill-card-blueprint.md`：Shot Skill 完整产品定义；
- `docs/product/bulk-sku-production-direction.md`：批量生产方向和止损流程。

## 0. 范围与核心决策

### 0.1 本阶段目标

> Brand Kit 创建完成后，客户无需理解数据库 ID、无需为了一个商品制作 CSV、无需跨页面手工绑定 Campaign 和 Spec，即可完成「商品素材 → 规格审批 → 成本确认 → 生成 → QA → 审核采用 → 下载」闭环。

需要同时交付两条明确流程：

```text
单品生成：
Brand Kit
→ 单独创建 SKU / 上传图片
→ 创建单品任务
→ 自动创建 Campaign
→ 创建并审批 Spec
→ 自动绑定 Spec
→ 成本确认
→ 生成
→ QA
→ Review
→ completed

批量生产：
Brand Kit
→ CSV 或 Catalog 导入多个 SKU
→ 创建批量任务
→ 选择 Pilot
→ 自动创建 Campaign / Spec
→ 审批并自动绑定
→ 成本确认
→ 生成 Pilot
→ Review / Evaluate
→ 分配 Wave
→ 批量生成
→ completed
```

### 0.2 明确不做

```text
修改 MiniMax 供应商
新增第二视频供应商
广告平台自动投放
公开 Shot Skill 市场
允许客户绕过 Creative Spec
允许客户覆盖系统 Prompt
匿名或跨 Workspace 素材共享
自动批准 Spec 或 Review
用余额字段替代 CreditLedger
为兼容旧 UI 保留两套写入入口
```

### 0.3 核心产品决策

1. 创建任务时必须明确选择 `single` 或 `bulk` 模式。
2. `single` 只允许一个 SKU，不执行 Pilot 通过门和 Wave；采用后任务直接 `completed`。
3. `bulk` 最少三个 SKU，保留最多三个 Pilot、至少两个采用和 Wave 止损合同。
4. 主流程不再要求用户输入 `brandKitId`、`catalogItemId`、`productionBatchItemId`、`campaignId` 或 `creativeSpecVersionId`。
5. ID 只在诊断区、URL 和审计记录中展示，不作为主操作输入。
6. 单 SKU 可从 UI 创建；CSV 仅用于批量导入，不再是唯一创建入口。
7. Product Asset 必须先归档到当前 Workspace 对象存储，再进入 Campaign。
8. 创建任务前必须完成 Shot Skill Eligibility 预检；不允许到 Schedule 阶段才发现时长或素材不兼容。
9. Spec 批准时自动绑定对应 BatchItem；删除人工三 ID 绑定流程。
10. 所有可用按钮由状态和前置条件计算；无效操作不显示或显示明确阻塞原因。
11. 浏览器直传失败必须区分 CORS、签名、网络、MIME、大小和对象存储权限，禁止只显示 `Failed to fetch`。
12. Workspace 所有权校验失败必须展示用户可选择的当前 Workspace 实体，而不是只返回数据库错误。

### 0.4 原子任务规则

- 一个任务只改变一个可观察行为；
- 数据模型、服务函数、路由、页面和端到端验收不得混成一个任务；
- 所有读写显式校验 `teamId`；
- 新流程采用 clean cutover：迁移全部调用方后删除人工绑定入口；
- 历史记录继续可读，不进行双写；
- 上传与生成失败不得留下孤立 Asset、Campaign、Spec 或 Queue Job；
- 每项任务运行覆盖自身合同的最小验证；
- 最后才执行真实 MiniMax 生成与浏览器验收。

## 1. 当前问题与目标行为

| 当前问题 | 目标行为 |
|---|---|
| SKU 只能通过 CSV 创建 | Catalog 页面可单独创建 SKU，CSV 保留为批量入口 |
| CSV 要求填写 Workspace 数据库 ID | 新模板使用 Workspace 内唯一 Brand Kit 名称或交互式映射 |
| 图片只能填写远程 URL | 支持本地上传、远程 URL 归档及上传状态反馈 |
| COS CORS 错误只显示 Failed to fetch | 显示 Origin、失败阶段、处理建议，并提供服务端回退 |
| 单 SKU 被套进批量 Pilot 门 | 单品模式采用后直接完成 |
| 创建 10 秒 Batch 后期才发现 Skill 不支持 | 创建前展示可用 Skill 和支持时长 |
| Campaign / Spec / Item ID 不显示却要求手填 | Spec 批准时自动绑定，不再手填 ID |
| 一个 Batch 卡片同时显示所有动作 | 引导式步骤条只突出下一合法动作 |
| 错误包含 eligibility.all.2 等内部路径 | 转换为客户语言和一键补救动作 |
| 暂停、评估等按钮可被提前点击 | 按状态和前置条件控制可用性 |

## 2. 代码边界

| 领域 | 当前主要边界 | 优化责任 |
|---|---|---|
| Brand Kit | `app/(dashboard)/dashboard/brand-kits/*`、`brand_kits` | 选择器、Workspace 映射、可读错误 |
| Catalog | `app/(dashboard)/dashboard/catalog/*`、`app/api/catalog/*`、`lib/bulk/*` | 单品创建、完整编辑、CSV v2、Readiness |
| Asset / COS | `lib/storage/cos.ts`、上传 URL 路由 | 本地上传、CORS 诊断、服务端回退、清理 |
| Batch | `lib/production-batches/actions.ts`、`app/api/production-batches/*`、Batch UI | single/bulk 模式、状态机、下一动作 |
| Creative Spec | `lib/creative-spec/*`、`app/api/creative-specs/*`、Spec UI | Batch 内创建、审批自动绑定 |
| Shot Skill | `lib/shot-skills/*`、Skill 页面 | Eligibility 预检、时长建议、自定义入口 |
| Review / QA | Reviews 页面、`lib/quality/*` | 单品完成、证据展示、明确补救 |

## A. 产品合同与流程模式

| ID | 原子任务 | 可验证完成结果 | 前置 |
|---|---|---|---|
| FLOW-01 | 冻结单品生成流程合同 | 文档和机器合同定义一个 SKU 从创建到 adopted 后直接 completed | 无 |
| FLOW-02 | 冻结批量生产流程合同 | 文档和机器合同定义 ≥3 SKU、Pilot、Evaluate、Wave 和 completed | 无 |
| FLOW-03 | 冻结任务模式枚举 | `single / bulk` 成为唯一合法模式 | FLOW-01、FLOW-02 |
| FLOW-04 | 冻结模式数量约束 | single 恰好 1 SKU，bulk 至少 3 SKU；2 SKU 返回明确选择建议 | FLOW-03 |
| FLOW-05 | 冻结状态驱动动作合同 | 每种模式和状态只有一组合法操作及阻塞原因 | FLOW-01、FLOW-02 |
| FLOW-06 | 冻结下一动作模型 | 服务返回 `nextAction`、标签、目标、阻塞项和修复动作 | FLOW-05 |
| FLOW-07 | 冻结主流程无裸 ID 合同 | 客户主流程所有动作使用当前行上下文或稳定业务键 | FLOW-05 |
| FLOW-08 | 冻结 Workspace 实体选择合同 | Brand Kit、SKU、Campaign、Spec 均只从当前团队可见集合选择 | FLOW-07 |
| FLOW-09 | 冻结错误响应合同 | Domain error 固定包含 `code / message / field / remediation` | FLOW-05 |
| FLOW-10 | 为流程合同增加可执行检查 | 单品、批量、无 ID 和状态动作合同可被脚本确定验证 | FLOW-01 至 FLOW-09 |

执行状态（2026-08-09）：`FLOW-01` 至 `FLOW-10` 已完成。

实现证据：

- `lib/bulk/workflow-contracts.ts`：单品/批量流程、模式数量、状态动作、Next action、无裸 ID、Workspace 选择和错误响应机器合同；
- `scripts/check-customer-workflow-contracts.ts`：A 阶段可执行合同检查；
- `pnpm workflow:contract-check`：聚焦验证命令。

## B. 数据模型与迁移

| ID | 原子任务 | 可验证完成结果 | 前置 |
|---|---|---|---|
| DATA-01 | 为 ProductionBatch 增加 generationMode | 新记录明确保存 single 或 bulk | FLOW-03 |
| DATA-02 | 增加模式数量数据库约束 | 非法 single/bulk SKU 数量不能完成初始化 | FLOW-04、DATA-01 |
| DATA-03 | 增加 BatchItem 业务唯一索引 | 一个 Batch 内同一 CatalogItem 只出现一次 | DATA-01 |
| DATA-04 | 增加 CatalogItem 素材完整性约束 | ready SKU 必须具有当前团队 primaryAssetId | FLOW-08 |
| DATA-05 | 记录 Asset 上传来源 | Asset 可区分 local_upload、remote_archive、csv_import | DATA-04 |
| DATA-06 | 记录上传诊断状态 | 上传记录可保存签名、传输、归档、失败阶段和错误码 | DATA-05 |
| DATA-07 | 生成 Drizzle migration | 空库和现有库获得相同新字段、索引和约束 | DATA-01 至 DATA-06 |
| DATA-08 | 回填历史 Batch 模式 | 1 个 SKU 回填 single，≥3 个回填 bulk，2 个标记需人工决策 | DATA-07 |
| DATA-09 | 验证历史 Campaign / Spec / Job FK 不变 | 迁移后历史冻结 Recipe 和 Review 证据仍可读取 | DATA-08 |
| DATA-10 | 更新 Schema 推断类型 | 新模式和上传状态在 TypeScript 中无手写重复类型 | DATA-07 |

执行状态（2026-08-09）：`DATA-01` 至 `DATA-10` 已完成。

实现证据：

- `lib/db/schema.ts`：generationMode、Asset uploadSource、asset_uploads 诊断表、同团队 Asset 复合外键和 ready 素材约束；
- `lib/db/migrations/0016_daily_betty_ross.sql`：历史模式回填、NOT NULL 收紧、延迟数量约束触发器及新表/索引/外键；
- `scripts/check-customer-workflow-data-model.ts`：模式数量、业务唯一、同团队 Asset、上传状态和历史冻结关联数据库检查；
- `pnpm workflow:model-check`：B 阶段聚焦验证命令；
- 迁移前备份：`backups/saas_starter_pre_customer_flow_b_20260809153959.dump`。

## C. 单独创建 SKU

| ID | 原子任务 | 可验证完成结果 | 前置 |
|---|---|---|---|
| SKU-01 | 冻结单 SKU 创建输入 Schema | 与 CSV Readiness 共用同一商品字段和错误码 | FLOW-08 |
| SKU-02 | 提取 Catalog 创建服务 | CSV commit 和单品创建可复用同一 team-scoped 写入函数 | SKU-01 |
| SKU-03 | 新增 POST `/api/catalog` | Owner/Member 按 RBAC 创建一个 SKU；跨团队 Brand Kit 被拒绝 | SKU-02 |
| SKU-04 | 实现 externalSku 冲突结果 | 重复 SKU 返回 update / cancel 选择，不暴露数据库异常 | SKU-03 |
| SKU-05 | 实现完整 SKU 编辑服务 | 可编辑宣称、来源、禁用、必现、不可变、受众、目标、平台、时长和 CTA | SKU-02 |
| SKU-06 | 扩展 CatalogItem PATCH 合同 | 更新完整字段后重新计算 Readiness | SKU-05 |
| SKU-07 | 创建 Add product 页面 | 用户无需 CSV 可完成单 SKU 表单 | SKU-03、SKU-06 |
| SKU-08 | 用 Brand Kit 选择器替代 brandKitId | 选择项只显示当前 Workspace Brand Kit 名称 | FLOW-08、SKU-07 |
| SKU-09 | 实现 Claims 动态行编辑 | 每条 approved claim 强制同时填写文本和来源 | SKU-07 |
| SKU-10 | 实现 Must show / Immutable / Prohibited 编辑器 | 列表字段可增删且空项不提交 | SKU-07 |
| SKU-11 | 实现保存前 Readiness 预览 | 表单内显示 ready 或逐字段阻塞原因 | SKU-01、SKU-07 |
| SKU-12 | 创建 SKU 详情页 | 展示归档主图、详情图、Brand Kit、宣称、素材状态和审计信息 | SKU-06 |
| SKU-13 | 增加复制 SKU 操作 | 复制产生新 externalSku 草稿且不复制外部业务身份 | SKU-02 |
| SKU-14 | 验证跨 Workspace SKU 创建隔离 | 无法引用其他团队 Brand Kit 或 Asset | SKU-03、SKU-08 |
| SKU-15 | 增加单 SKU 创建聚焦检查 | 合法表单 ready，缺图/缺宣称 needs_input，重复 SKU 可解释 | SKU-01 至 SKU-14 |

执行状态（2026-08-09）：`SKU-01` 至 `SKU-15` 已完成。

实现证据：

- `lib/catalog/contracts.ts`、`lib/catalog/service.ts`：共享 Readiness、team-scoped 创建/编辑/复制、冲突和 Workspace 引用隔离；
- `lib/bulk/import-actions.ts`、`lib/bulk/import-worker.ts`：CSV commit 与单品创建复用 Catalog 写入和商品图片归档服务；
- `app/api/catalog/route.ts`、`app/api/catalog/[catalogItemId]/route.ts`、`app/api/catalog/[catalogItemId]/copy/route.ts`：创建、完整更新和复制 API；
- `/dashboard/catalog/new`、`/dashboard/catalog/[catalogItemId]`：动态表单、Brand Kit 名称选择、实时 Readiness、归档素材、审计和复制草稿；
- `pnpm catalog:single-check`：ready、needs_input、冲突、PATCH 重算、活动日志和跨 Workspace 隔离聚焦验证；
- 变更前备份：`backups/saas_starter_pre_customer_flow_c_20260809164225.dump`。

## D. 产品图片与 Asset 上传

| ID | 原子任务 | 可验证完成结果 | 前置 |
|---|---|---|---|
| ASSET-01 | 冻结产品图片上传合同 | JPEG/PNG/WebP、20 MB、当前团队对象 key 和 MIME magic bytes 唯一约束 | DATA-05 |
| ASSET-02 | 签发产品图片专用上传 URL | URL 只允许当前团队、限定 MIME、大小和对象 key 前缀 | ASSET-01 |
| ASSET-03 | 完成上传回执接口 | 只有对象存在且 MIME/大小匹配才创建 Asset | ASSET-02 |
| ASSET-04 | 实现本地产品主图上传组件 | 可选择文件、显示进度、成功后绑定 Asset | ASSET-03、SKU-07 |
| ASSET-05 | 实现产品详情图多文件上传 | 最多 9 张、顺序稳定、删除后清理未引用对象 | ASSET-03 |
| ASSET-06 | 保留远程 URL 归档入口 | HTTPS URL 经 SSRF、重定向、MIME 和大小检查后归档 | ASSET-01 |
| ASSET-07 | 增加上传预检端点 | 返回 Bucket、Region、Origin、签名和 CORS 可用性，不上传业务文件 | ASSET-02 |
| ASSET-08 | 映射 CORS preflight 错误 | OPTIONS 403 显示当前 Origin 和 COS 配置建议 | ASSET-07 |
| ASSET-09 | 映射签名与权限错误 | 403 可区分签名过期、密钥权限和对象 key 不匹配 | ASSET-07 |
| ASSET-10 | 实现服务端上传回退 | 浏览器直传不可用时通过流式服务端端点上传，不加载完整文件到内存 | ASSET-03、ASSET-08 |
| ASSET-11 | 为参考视频复用上传诊断 | CSV 和 Reference 上传获得相同 CORS/网络错误行为 | ASSET-07 至 ASSET-10 |
| ASSET-12 | 清理失败与过期上传对象 | 未完成回执的对象在保留期后可重复、安全删除 | DATA-06、ASSET-03 |
| ASSET-13 | 验证本地上传完整路径 | 浏览器选择图片后 Asset 归档、SKU ready、Campaign 可现签读取 | ASSET-04、SKU-11 |

执行状态（2026-08-09）：`ASSET-01` 至 `ASSET-13` 已完成。

实现证据：

- `lib/assets/contracts.ts`、`lib/assets/service.ts`：图片 MIME/大小/magic bytes、签名、回执、诊断状态、Workspace 隔离和幂等清理；
- `lib/storage/cos.ts`：产品图片专用 key、Range GET 对象存在/MIME/总大小/magic bytes 校验、CORS OPTIONS 预检和不缓存完整文件的流式 PUT；
- `/api/assets/product-images/*`、`/api/assets/uploads/preflight`：签名、complete、fallback、delete、cleanup 和预检 API；
- `product-image-uploader.tsx`、`upload-client.ts`：主图、最多 9 张详情图、进度、统一错误映射和 direct→fallback；
- CSV 与 Reference 上传复用 `uploadSignedFile` 诊断客户端；
- `pnpm assets:check`：上传合同、流式校验、回执幂等、失败诊断、Workspace 隔离、fallback、活动日志和清理检查；
- 变更前备份：`backups/saas_starter_pre_customer_flow_d_20260809194436.dump`；
- `ASSET-13` 真实浏览器证据：68-byte PNG 经 direct 失败后自动 server fallback，创建 Asset #55；SKU #42 为 ready，Batch #20 创建 Campaign #29，签名图片在浏览器解码为 1×1。业务数据、Upload #20/#25、Asset #55 和两个 COS 验证对象随后全部清理；对象 GET 均返回 `NoSuchKey` 404。`http://localhost:3001` CORS OPTIONS 实测 200，允许 PUT/GET/HEAD/DELETE 与 Content-Type。

## E. CSV v2 与 Workspace 映射

| ID | 原子任务 | 可验证完成结果 | 前置 |
|---|---|---|---|
| CSVUX-01 | 冻结 CSV v2 模板 | `brand_kit_name` 替代新增文件中的裸 brand_kit_id | FLOW-08 |
| CSVUX-02 | 实现团队内 Brand Kit 名称解析 | 唯一名称映射内部 ID；未知名称返回可选列表 | CSVUX-01 |
| CSVUX-03 | 保留历史 v1 文件只读解析 | 已存在 ImportBatch 可审计；新上传只接受 v2，无双写 | CSVUX-01 |
| CSVUX-04 | 更新 Workspace 模板下载 | 模板示例包含当前 Workspace 可选 Brand Kit 名称 | CSVUX-02 |
| CSVUX-05 | 增加导入前 Brand Kit 映射步骤 | 多行可统一选择或逐行修复 Brand Kit | CSVUX-02 |
| CSVUX-06 | 改写归属错误 | 显示 CSV 值、当前 Workspace 名称和可用 Brand Kit，不返回通用所有权错误 | CSVUX-05、FLOW-09 |
| CSVUX-07 | 增加一行 CSV 入口提示 | 一个 SKU 时推荐 Add product，不阻止合法单行 CSV | SKU-07、CSVUX-04 |
| CSVUX-08 | 强化重复 SKU 决策 | 已存在 SKU 明确默认 update，不允许隐式 create 冲突 | SKU-04 |
| CSVUX-09 | 上传错误使用统一诊断 | CSV 上传展示签名、CORS、传输、校验和 Worker 阶段 | ASSET-07 至 ASSET-11 |
| CSVUX-10 | 导入预览显示主图缩略图 | ready 行可在 Commit 前确认 URL 对应商品 | ASSET-06 |
| CSVUX-11 | 增加可下载修复版 CSV | 修复 Brand Kit、重复决策和逐行错误后可下载再审计 | CSVUX-05、CSVUX-08 |
| CSVUX-12 | 增加 CSV v2 聚焦检查 | 三行、单行、未知品牌、重复 SKU、引号逗号和 UTF-8 均确定通过或失败 | CSVUX-01 至 CSVUX-11 |

### 执行状态（2026-08-10）

- `CSVUX-01` 至 `CSVUX-12` 已完成；
- 新上传模板固定为 `v2`，使用 `brand_kit_name`；新 ImportBatch API 拒绝 `v1`，历史 `v1` 仅在 Batch 明确记录该版本时解析；
- Workspace 内 Brand Kit 名称采用不区分大小写的唯一匹配；未知或歧义值返回 CSV 原值、Workspace 名称和可选 Brand Kit；
- 导入预览支持逐行或多行统一映射、单行 Add product 提示、既有 SKU 默认 `update`、主图缩略图和修复版 v2 CSV 下载；
- 上传与处理阶段统一展示 signing、CORS/transfer、object/hash validation 和 Worker 错误；Worker 失败写入可见的 `worker_validation_failed` 行；
- `pnpm bulk:csv-check` 覆盖三行、单行、未知品牌、重复 SKU、引号/逗号/换行、UTF-8、v1 新上传拒绝与历史解析；
- 真实浏览器证据：Batch #6 上传后显示单行提示；`Missing Brand` 错误包含 Workspace 和 `G P5 Acceptance Brand`；映射并重新验证后 Batch 为 ready，既有 `BF-PRESS-PRO` 默认选择 update，Asset #58 缩略图解码为 1×1；修复版下载只含 `brand_kit_name`；
- 验收清理：Batch #6、ImportRow、Upload #30、Asset #58、Activity #228 均删除；上传 CSV 与归档图片 GET 均返回 `NoSuchKey` 404；
- 变更前备份：`backups/saas_starter_pre_csv_v2_20260810021828.dump`（185858 bytes，`pg_restore --list` 378 项）。

## F. 单品与批量状态机

| ID | 原子任务 | 可验证完成结果 | 前置 |
|---|---|---|---|
| MODE-01 | 实现模式感知 Batch 创建服务 | single 恰好一个 ready SKU，bulk 至少三个 | FLOW-04、DATA-01 |
| MODE-02 | 实现单品状态迁移 | draft → ready_for_spec → ready_to_generate → generating → review → completed | FLOW-01、MODE-01 |
| MODE-03 | 保留批量状态迁移 | bulk 继续使用 calibrating、pilot_review、ready、producing、reviewing、completed | FLOW-02、MODE-01 |
| MODE-04 | 单品模式跳过 Pilot 选择 | single 不创建或调用 select-pilots | MODE-02 |
| MODE-05 | 单品模式跳过 Evaluate Pilot | adopted 后直接 completed，不检查 ≥2 adopted | MODE-02 |
| MODE-06 | 单品模式隐藏 Wave | assign-waves / schedule-wave 对 single 返回不支持且 UI 不显示 | MODE-02 |
| MODE-07 | 批量模式保持 Pilot 门 | bulk 少于两个 adopted 或存在 fidelity 失败不可放量 | MODE-03 |
| MODE-08 | 处理两 SKU 输入 | UI 建议拆为两个 single 或补到三个 bulk，不创建模糊模式 | FLOW-04、MODE-01 |
| MODE-09 | 实现模式感知暂停与恢复 | single 和 bulk 恢复到各自暂停前合法状态 | MODE-02、MODE-03 |
| MODE-10 | 实现 adopted 后任务汇总 | single 完成时间、输出 Asset、成本和 Review 可从任务详情读取 | MODE-05 |
| MODE-11 | 为模式状态机增加聚焦检查 | 单品采用后 completed；批量仍需 Pilot 门；非法迁移失败 | MODE-01 至 MODE-10 |

### 执行状态（2026-08-10）

- `MODE-01` 至 `MODE-11` 已完成；
- `0017_careful_puck.sql` 新增 Single 状态与 `paused_from_status`；`0018_normalize_legacy_production_modes.sql` 将历史一 SKU Pilot 状态按 Item/Job/Review/Spec 事实规范到 Single 状态；
- Single 状态固定为 `draft → ready_for_spec → ready_to_generate → generating → review → completed`；失败可回到 `ready_to_generate`，暂停期间 Job 完成或失败会推进恢复目标；
- Bulk 保留 `calibrating → pilot_review → ready → producing → reviewing → completed`、至少两个 adopted Pilot 和 fidelity 阻塞门；
- Single 使用独立 `prepare-single`、`bind-spec`、`schedule-single`，服务端拒绝 Pilot/Wave 动作；UI 不渲染 Pilot/Wave；
- 一个 SKU 自动创建 Single，三个及以上创建 Bulk；两个 SKU 的 UI 与 API 均提示补到三个或拆成两个 Single，且不产生 Batch；
- Pause 持久化 `paused_from_status`，Single 与 Bulk 均恢复到本模式的合法状态；
- adopted 在同一事务内完成 Single Item、Campaign、Batch；Progress 返回 Job 完成时间、输出 Asset、实际成本、尝试次数和 Review；
- 真实浏览器证据：Batch #21 从 Single draft 创建 Campaign #30，Pilot/Wave API 均返回 400；`ready_for_spec` 暂停后精确恢复；Spec #18 绑定后确认 ¥13 成本，正式调度仅创建 VideoJob #32；采用冻结 QA 输出后 Batch/Item/Campaign 均 completed，Progress 返回 Asset #38、¥2.5、attempts 1 和 adopted Review；
- Bulk Batch #22 选择 3 个 Pilot 后，0 adopted 明确阻塞在 `pilot_review`；暂停记录 `pilot_review` 并精确恢复；
- 验收清理：Batch #21/#22、Item #33–#36、Campaign #30、Spec #18、ShotCard #58、VideoJob #32、Review #11、Evidence #10 和 Activity #232–#245 均删除；append-only Evidence 触发器恢复为 enabled；
- 聚焦与回归：`pnpm production-mode:check`、`pnpm production-batch:check`、`pnpm quality:check`、`pnpm workflow:contract-check`、`pnpm workflow:model-check`、`pnpm bulk:model-check`、`pnpm exec tsc --noEmit` 与 `pnpm build` 均通过；
- 变更前备份：`backups/saas_starter_pre_mode_state_machine_20260810102135.dump`（185858 bytes，`pg_restore --list` 378 项）。

## G. Shot Skill Eligibility 前置检查

| ID | 原子任务 | 可验证完成结果 | 前置 |
|---|---|---|---|
| ELIG-01 | 冻结客户化 Eligibility 结果 | 每个 Skill 返回 eligible、阻塞原因和补救，不暴露 all.2 内部路径 | FLOW-09 |
| ELIG-02 | 实现 CatalogItem Eligibility Context | 从主图、细节图、场景、授权、平台和时长生成唯一结构化上下文 | SKU-11 |
| ELIG-03 | 新增 Eligibility Preview 服务 | 不创建 Campaign、Spec、Job 即返回 Official + Private Skill 候选 | ELIG-01、ELIG-02 |
| ELIG-04 | 新增团队范围 Preview 路由 | 只能预检当前 Workspace SKU 和 Skill | ELIG-03 |
| ELIG-05 | 映射不支持时长提示 | 10 秒无 Skill 时建议改 5 秒或创建 10 秒 Private Skill | ELIG-01 |
| ELIG-06 | 映射缺细节图提示 | macro 不可用时提供上传详情图动作 | ELIG-01、ASSET-05 |
| ELIG-07 | 映射缺 Scene Brief 提示 | use-case 不可用时提供填写场景和人物授权动作 | ELIG-01 |
| ELIG-08 | 创建任务前执行 Eligibility | 无任何可用 Skill 时不创建 Batch/Campaign/Spec 副作用 | ELIG-04、MODE-01 |
| ELIG-09 | 批次 UI 展示 Skill 候选 | 选择平台/时长/SKU 时实时显示可用镜头方法 | ELIG-04 |
| ELIG-10 | 根据候选限制时长选项 | 默认只展示至少一个 Active Skill 支持的时长 | ELIG-09 |
| ELIG-11 | 增加自定义 Skill 入口 | 不支持时长可直接跳到基于候选 Skill 的 Private Draft | ELIG-05 |
| ELIG-12 | 冻结创建时 Skill 选择 | 任务保存明确 SkillVersion lock，后续不重新选择最新版本 | ELIG-08、现有 Skill 版本合同 |
| ELIG-13 | Skill 变化使成本确认失效 | lock 变化后必须重新 Estimate / Confirm | ELIG-12 |
| ELIG-14 | 增加 Eligibility 聚焦检查 | 5 秒 hero 通过、10 秒无 Skill 前置失败、macro 缺图可解释 | ELIG-01 至 ELIG-13 |

### 执行状态（2026-08-10）

- `ELIG-01` 至 `ELIG-14` 已完成；
- `lib/shot-skills/eligibility.ts` 输出稳定 blocker code、客户文案和补救动作；`lib/shot-skills/preview.ts` 从 CatalogItem、BrandKit 与素材绑定生成唯一 Context，并只读返回 Official + Workspace Private Active 候选；
- `POST /api/skills/eligibility/preview` 强制当前 Workspace SKU/Skill 范围；Batch Workbench 实时显示 eligible/blocked 候选、缺图/Scene Brief/时长原因，并将不受支持时长禁用；
- 10 秒无 Active Skill 时创建按钮保持禁用，同时提供改用 4/5 秒或基于候选版本创建支持 10 秒的 Private Draft 入口；
- `createProductionBatch` 在事务前执行 Eligibility；失败不创建 Batch/Campaign/Spec/Job，成功时把明确的 Active `shotSkillVersionId`、版本和 definition hash 写入 `skillVersionLock`，事务内再次确认版本仍 Active；
- Skill lock 是成本估算 hash 的输入；lock 增补会清空 `specHash`、`costConfirmation` 与 `costConfirmedAt`，要求重新 Estimate / Confirm；
- 聚焦验证：`pnpm skills:eligibility-check`、`pnpm skills:library-check`、`pnpm production-batch:check`、`pnpm production-mode:check`、`pnpm exec tsc --noEmit` 与 `pnpm build` 均通过；浏览器实测 5 秒可创建、10 秒阻断、Private Draft 入口和 Preview API 客户合同；
- 变更前备份：`backups/saas-starter_pre-eligibility-check_20260810111920.dump`（186098 bytes，`pg_restore --list` 378 项）。

## H. Campaign 与 Creative Spec 自动化

| ID | 原子任务 | 可验证完成结果 | 前置 |
|---|---|---|---|
| SPECUX-01 | 提取 BatchItem Campaign 创建服务 | 给定当前团队 BatchItem 幂等创建对应 Campaign | MODE-01 |
| SPECUX-02 | 单品任务自动创建 Campaign | single 创建后无需用户输入 Campaign ID | SPECUX-01、MODE-02 |
| SPECUX-03 | 批量 Pilot 自动创建 Campaign | bulk 选择 Pilot 后每行获得一个 Campaign | SPECUX-01、MODE-03 |
| SPECUX-04 | 新增 BatchItem 创建 Spec 动作 | 用户从 SKU 行点击 Create Spec，不输入 Campaign / CatalogItem ID | SPECUX-01、现有 Spec 编译器 |
| SPECUX-05 | 实现批量创建 Spec 草稿 | 为所有缺 Spec 的 Pilot 幂等创建草稿并逐行返回结果 | SPECUX-04 |
| SPECUX-06 | Spec 卡展示来源上下文 | 明确显示 Batch、SKU、Brand Kit、Campaign 名称和 Skill 候选 | SPECUX-04、ELIG-12 |
| SPECUX-07 | Spec 批准事务内自动绑定 BatchItem | approved Spec 写入对应 creativeSpecVersionId，禁止错 Campaign 绑定 | SPECUX-04 |
| SPECUX-08 | 自动绑定后使成本门失效 | 绑定变更清空旧 estimate/confirmation 并提示下一步 | SPECUX-07、ELIG-13 |
| SPECUX-09 | 批量批准返回逐行绑定结果 | 每个 Pilot 明确 approved / failed 和原因 | SPECUX-05、SPECUX-07 |
| SPECUX-10 | 删除人工 Bind 表单 | Batch UI 不再显示三个 ID 输入框 | SPECUX-07、UI 切换 |
| SPECUX-11 | 删除 bind-pilot-spec 公共动作 | 所有调用方迁移后移除手工绑定路由和无用状态 | SPECUX-10 |
| SPECUX-12 | 增加审批竞争保护 | 同 Campaign 并发批准只绑定一个合法当前版本 | SPECUX-07 |
| SPECUX-13 | 增加 Spec 自动绑定聚焦检查 | 单品和三 Pilot 批量批准后均无需裸 ID 且绑定正确 | SPECUX-01 至 SPECUX-12 |

### 执行状态（2026-08-10）

- `SPECUX-01` 至 `SPECUX-13` 已完成；
- `lib/production-batches/spec-automation.ts` 以当前 Workspace `BatchItem` 为唯一入口，行锁保护下幂等创建 Campaign，并从 Batch/SKU 自动带入 Brand Kit、商品主图、平台、时长、Campaign Brief 与冻结 SkillVersion；
- Single SKU 和 Bulk Pilot 均可从 SKU 行或批量动作创建 Spec Draft，不再输入 Campaign ID、CatalogItem ID 或 Spec ID；重复调用返回现有 Campaign/Spec；
- Spec 卡明确展示 Batch、BatchItem、SKU、商品、Brand Kit、Campaign 和冻结 Skill 候选；未批准 Draft/awaiting 状态在 Batch SKU 行显示客户提示与修复入口；
- Spec approval 在同一事务内锁定 Spec、BatchItem 与 Batch，写入 `creativeSpecVersionId`，Single 推进到 `ready_to_generate`，并清空旧 `specHash`、estimate、confirmation 和 confirmed time；
- 同 Campaign 并发批准只允许一个 approved 版本绑定；批量批准逐行返回 `approved` / `failed`、绑定结果和失败原因；
- Batch Workbench 三个裸 ID 输入与 `bind-spec` 公共动作已删除；旧 P5 调用方迁移至审批自动绑定；
- 聚焦验证：`pnpm creative-spec:automation-check` 覆盖 Single、三 Pilot、幂等创建、来源上下文、成本门失效、逐行审批和并发竞争；`pnpm creative-spec:check`、`pnpm production-mode:check`、`pnpm production-batch:check`、`pnpm workflow:contract-check`、`pnpm exec tsc --noEmit` 与 `pnpm build` 均通过；
- 浏览器实测 Batch UI 无 BatchItem/Campaign/Spec 裸 ID，显示 Create Spec / Create Pilot Specs；Spec 卡显示完整来源，旧 `POST .../bind-spec` 返回 404；
- 变更前备份：`backups/saas-starter_pre-spec-automation_20260810114841.dump`（186098 bytes，`pg_restore --list` 378 项）。

## I. 引导式任务工作台

| ID | 原子任务 | 可验证完成结果 | 前置 |
|---|---|---|---|
| WORK-01 | 新增 Batch 详情路由 | `/dashboard/batches/[batchId]` 承载一个任务，不在列表堆全部操作 | FLOW-06 |
| WORK-02 | 创建模式选择器 | Create Task 明确选择 Single video / Batch production | FLOW-03、MODE-01 |
| WORK-03 | 创建可搜索 SKU 选择器 | 用名称、SKU、缩略图选择，不输入 CatalogItem IDs | SKU-12、FLOW-07 |
| WORK-04 | 创建任务前置检查面板 | 展示 Brand Kit、素材、Skill、时长和成本前置状态 | ELIG-09 |
| WORK-05 | 创建步骤条 | SKU → Campaign → Spec → Cost → Generation → QA → Review → Complete | FLOW-06、SPECUX-07 |
| WORK-06 | 实现 Next action 主按钮 | 每一步只突出一个合法主操作 | FLOW-06、WORK-05 |
| WORK-07 | 显示阻塞项与修复链接 | 缺图、缺 Scene、无 Skill、未批准 Spec 可直接跳转修复 | WORK-04、FLOW-09 |
| WORK-08 | 状态控制操作可见性 | 不合法的 Evaluate / Wave / Schedule / Pause 不显示 | FLOW-05、MODE-11 |
| WORK-09 | 增加 Pause 二次确认 | 显示影响范围，避免误暂停 | MODE-09 |
| WORK-10 | 增加 Resume 目标提示 | 恢复前显示将返回的状态和下一动作 | MODE-09 |
| WORK-11 | 增加诊断信息折叠区 | 需要时可复制 Batch、Item、Campaign、Spec、Skill Version、Job ID | FLOW-07 |
| WORK-12 | 增加加载骨架与数据就绪状态 | 初始 API 未返回时不显示误导性的 0 行/空批次 | 现有查询 |
| WORK-13 | 创建操作时间线 | 展示 Campaign 创建、Spec 审批、Cost、Queue、QA、Review 时间 | WORK-05、活动日志 |
| WORK-14 | 更新列表页为摘要入口 | 列表只显示模式、进度、成本、下一动作和进入详情 | WORK-01 |
| WORK-15 | 浏览器验证引导工作台 | 客户从 Brand Kit 后无需文档和查库可走到 Schedule | WORK-01 至 WORK-14 |

### 执行状态（2026-08-10）

- `WORK-01` 至 `WORK-15` 已完成；
- 新增 `/dashboard/batches/[batchId]` 与 `GET /api/production-batches/[batchId]/detail`，聚合 Batch、SKU、Brand Kit、Campaign、Spec、SkillVersion、Job、Review、进度、阻塞项、诊断 ID 与操作时间线；
- Create Task 明确选择 Single video / Batch production，使用当前 Workspace 可搜索 SKU 卡片与缩略图，不再输入 CatalogItem ID；支持从 SKU 详情按 `sku` 深链预选；
- 创建前置检查统一展示 SKU/Brand、素材、Shot Skill、时长和成本状态；Eligibility blocker 继续提供编辑 SKU、上传素材、审批 Spec 和创建 Private Skill 深链；
- 详情页提供 SKU → Campaign → Spec → Cost → Generation → QA → Review → Complete 步骤条，每个状态只突出一个合法 Next action；不合法 Evaluate、Wave、Schedule、Pause、Resume、Cancel 不显示；
- Pause 使用影响范围二次确认；暂停后明确 Resume 目标状态与下一动作；加载期间显示骨架，不再短暂显示 0 行或空任务；
- Advanced diagnostics 折叠区可复制 Batch、Item、CatalogItem、Campaign、Spec、SkillVersion 与 VideoJob ID；操作时间线展示 Task、Campaign、Spec、Cost、Queue、QA 与 Review 时间；
- `/dashboard/batches` 仅保留创建向导与任务摘要，摘要显示模式、进度、成本、下一动作和 Open task，不再堆叠完整控制台；
- 浏览器真实验收：搜索并选择 `BF-PRESS-PRO`，创建 Single task，自动创建 Campaign/Spec，Submit、Approve & bind、Estimate、Confirm 至 `Schedule video generation` 可见；验证 Pause 影响确认、Resume 目标、状态操作可见性、诊断与时间线后完整回收测试数据，未提交 MiniMax；
- 聚焦验证：`pnpm workbench:guided-check`、`pnpm production-batch:check`、`pnpm workflow:contract-check`、`pnpm exec tsc --noEmit` 与 `pnpm build` 均通过；
- 变更前备份：`backups/saas-starter_pre-guided-workbench_20260810120740.dump`（186098 bytes，`pg_restore --list` 378 项）。

## J. 客户化错误与补救

| ID | 原子任务 | 可验证完成结果 | 前置 |
|---|---|---|---|
| ERR-01 | 建立 DomainError 代码注册表 | Catalog、Upload、Batch、Spec、Skill、QA 使用稳定错误码 | FLOW-09 |
| ERR-02 | 映射 Workspace 所有权错误 | 显示引用实体、当前 Workspace 和可选实体 | ERR-01 |
| ERR-03 | 映射 Skill Eligibility 错误 | 显示不支持时长、缺图、缺 Scene 等客户语言 | ERR-01、ELIG-01 |
| ERR-04 | 映射上传网络错误 | Failed to fetch 被转为 CORS / DNS / offline / timeout | ERR-01、ASSET-07 |
| ERR-05 | 映射成本门失效 | 明确说明 Spec、Skill、数量或时长哪项改变 | ERR-01、SPECUX-08 |
| ERR-06 | 映射状态迁移错误 | 告诉用户当前状态、要求状态和下一合法动作 | ERR-01、FLOW-05 |
| ERR-07 | 为补救动作增加深链 | 错误可直接跳到上传图片、编辑 SKU、创建 Skill 或审批 Spec | WORK-07 |
| ERR-08 | 记录技术详情供诊断 | request ID、error code 和内部 detail 进入日志，不直接暴露客户 | ERR-01 |
| ERR-09 | 增加错误文案快照检查 | 关键失败不再出现 eligibility.all.2、数据库异常或通用 Failed to fetch | ERR-01 至 ERR-08 |

### 执行状态（2026-08-09）

- `ERR-01` 至 `ERR-09` 已完成；`lib/errors/domain.ts` 统一客户错误码、状态、文案与补救深链，`lib/errors/http.ts` 生成 request ID，并仅在服务端日志记录内部 detail、stack 与业务上下文；
- Catalog、Product Image Upload、Production Batch、Creative Spec、Skill Eligibility 与 Quality API 已接入统一响应；Workspace 错误包含当前 Workspace，成本失效返回具体 invalidatedBy，状态迁移返回 currentStatus、required/requestedStatus 与 nextAction；
- Product Image Upload 将 CORS、DNS、offline、timeout、签名和归档失败转换为客户诊断，并保留 server fallback；引导式任务工作台显示服务端补救链接，不向客户暴露原始 `Failed to fetch`、数据库异常或内部 Eligibility 路径；
- 新增 `pnpm errors:copy-check`；`pnpm assets:check`、`pnpm production-mode:check`、`pnpm workbench:guided-check`、`pnpm exec tsc --noEmit` 与 `pnpm build` 均通过；
- 浏览器真实验收：非法 Resume 返回 `409 invalid_transition`、request ID、当前/要求状态、Workspace 与 `/dashboard/batches` 补救链接；工作台实际渲染客户文案和 `Open Production tasks` 深链；
- 变更前备份：`backups/saas-starter_pre-customer-errors_20260810120740.dump`（186098 bytes，`pg_restore --list` 378 项）。

## K. Review、完成与交付

| ID | 原子任务 | 可验证完成结果 | 前置 |
|---|---|---|---|
| REVUX-01 | 单品 adopted 后完成任务 | Review、BatchItem、Batch 在同一事务获得一致完成状态 | MODE-05 |
| REVUX-02 | 单品 not_adopted 后显示重试路径 | 技术、保真、Spec、偏好和 Brief 原因映射唯一补救 | 现有 Review 合同、ERR-07 |
| REVUX-03 | 批量 adopted 保持 Pilot 统计 | bulk adopted 数和 fidelity 阻塞继续驱动 Evaluate | MODE-07 |
| REVUX-04 | Review 卡显示任务模式和 SKU | 用户知道结果属于单品还是 Pilot/Wave | MODE-01 |
| REVUX-05 | Review 卡显示冻结 Skill / Spec | 无需进入诊断页即可确认版本和 QA 结论 | ELIG-12、SPECUX-07 |
| REVUX-06 | 完成页提供直接下载 | adopted output Asset 可从任务完成页下载 | MODE-10 |
| REVUX-07 | 单品导出采用结果 | single 可导出一行交付清单，不要求 Wave | MODE-05 |
| REVUX-08 | 批量导出保持现有行为 | bulk Export CSV / adopted export 结果不回归 | MODE-07 |
| REVUX-09 | 增加 Review 完成聚焦检查 | 单品 adopted → completed；不采用保留证据且可补救 | REVUX-01 至 REVUX-08 |

### 执行状态（2026-08-10）

- `REVUX-01` 至 `REVUX-09` 已完成；`lib/reviews/decisions.ts` 将 Review、BatchItem、Single Batch、Campaign、Skill Evidence 与活动日志保持在同一事务，adopted 完成任务，not_adopted 返回 `ready_to_generate`；
- 技术、保真、Spec 不匹配、偏好变化与 Brief 变化分别映射唯一客户补救；Review 成功后跳回对应任务的 Next action；
- Review 卡显示 Single / Batch Pilot / Wave、SKU、商品名、冻结 Skill、批准 Spec 与任务入口；完成任务显示 adopted Asset 直接下载和 adopted manifest；
- Single adopted manifest 聚焦检查确认只产生一行可交付结果且不依赖 Wave；浏览器验证有效 Bulk Batch 的完整 Export 与 adopted export 均为 3 行，原有 QA 不合格导出继续返回 409；
- 新增 `pnpm review:delivery-check`，覆盖 Single adopted 事务完成、not_adopted 证据与补救、Bulk Pilot adopted 统计、完成详情和导出资格；`pnpm quality:check`、`pnpm exec tsc --noEmit` 与 `pnpm build` 均通过；
- 浏览器真实验收：Review 卡显示模式、SKU、冻结 Skill / Spec 和下载；完成页显示 3 个 Asset 下载入口及 manifest，Asset 下载路由返回对象存储重定向；
- 变更前备份：`backups/saas-starter_pre-review-delivery_20260810221141.dump`（186098 bytes，`pg_restore --list` 363 项）。

## L. 权限、审计与清理

| ID | 原子任务 | 可验证完成结果 | 前置 |
|---|---|---|---|
| SEC-01 | 校验所有新增路由的 Workspace 范围 | 他人 SKU、Asset、Batch、Campaign、Spec、Skill 均不可读取或写入 | 所有新增路由 |
| SEC-02 | 校验 Owner / Member 写权限 | 创建、审批、暂停、取消和 Review 沿用明确 RBAC | FLOW-08 |
| SEC-03 | 增加单 SKU 创建活动日志 | 创建、更新、上传图片、归档和 readiness 变化可追溯 | SKU-02、ASSET-03 |
| SEC-04 | 增加自动绑定活动日志 | Spec 批准和 BatchItem 绑定记录操作者和版本 | SPECUX-07 |
| SEC-05 | 增加模式状态活动日志 | single completed、bulk pilot release、pause/resume 可追溯 | MODE-11 |
| SEC-06 | 清理失败创建的临时记录 | 事务失败不保留空 Campaign、未引用 Spec 或上传对象 | SPECUX-01、ASSET-12 |
| SEC-07 | 验证签名 URL 不进入冻结 hash | 临时下载 URL 不改变 Spec、Skill、Recipe 或 Job hash | ASSET-03、现有 hash 合同 |
| SEC-08 | 增加权限与清理聚焦检查 | 跨团队访问失败，失败流程无孤儿数据 | SEC-01 至 SEC-07 |

### 执行状态（2026-08-11）

- `SEC-01` 至 `SEC-08` 已完成；新增安全聚焦检查确认 Batch、SKU、Campaign、Spec、VideoJob、Output Asset 不发生跨 Workspace 关联，Member 对 Owner-only 清理接口返回 `403`，跨 Workspace Batch / Asset 读取返回 `404`；
- 单 SKU Catalog create/update 已保留活动日志；Creative Spec 批准绑定 BatchItem 时新增 `BIND_PRODUCTION_BATCH_SPEC` 及绑定元数据；Pilot gate 通过进入 `ready` 时新增 `RELEASE_BULK_PILOT`，Pause、Resume、Cancel 均记录前后状态、模式和 Batch ID；
- Spec 自动化失败时清理新建 Campaign、ShotCard、BatchItem Campaign 引用、Campaign 活动日志，并在 Single 草稿流程恢复 Batch 状态，避免留下空 Campaign、孤立 Spec 或临时绑定；
- Approved Spec Recipe 只使用稳定业务输入，不包含 COS 签名下载 URL；`security:check` 验证替换临时签名 URL 不改变 frozen Recipe hash；
- 新增 `pnpm security:check`；`pnpm catalog:single-check`、`pnpm creative-spec:automation-check`、`pnpm production-mode:check`、`pnpm exec tsc --noEmit` 与 `pnpm build` 均通过；
- 变更前备份：`backups/saas-starter_pre-security-audit_20260811101717.dump`（186103 bytes，`pg_restore --list` 已在容器内验证）。

## M. 切换与兼容清理

| ID | 原子任务 | 可验证完成结果 | 前置 |
|---|---|---|---|
| CUT-01 | 更新 Workspace 导航 | 增加 Add product 和任务详情入口，保留批量导入入口 | SKU-07、WORK-01 |
| CUT-02 | 迁移 Catalog 表格创建入口 | 新建商品走单品表单，CSV 只标为 Batch import | CUT-01 |
| CUT-03 | 迁移 Batch 创建调用方 | Catalog 和 Batch 页均创建明确 generationMode | MODE-01、WORK-02 |
| CUT-04 | 迁移 Spec 创建调用方 | 主流程统一从 BatchItem 创建，不再要求输入 Campaign ID | SPECUX-04 |
| CUT-05 | 迁移 Spec 批准调用方 | 批准后自动绑定并返回下一动作 | SPECUX-07 |
| CUT-06 | 删除人工 ID 绑定 UI | 无残留输入框、帮助文案或状态 | SPECUX-10 |
| CUT-07 | 删除旧手工绑定路由 | 无调用方后删除 bind-pilot-spec | SPECUX-11 |
| CUT-08 | 删除旧 CSV v1 新上传入口 | 历史记录可读，新文件只用 v2 | CSVUX-03 |
| CUT-09 | 删除无模式 Batch 创建路径 | 所有新记录必须显式 single/bulk | DATA-08、CUT-03 |
| CUT-10 | 更新演示数据 | 示例 Brand Kit、单 SKU、三 SKU 批量任务和图片来源真实可用 | CUT-01 至 CUT-09 |
| CUT-11 | 更新操作文档和客户素材包 | 文档不再要求手填 ID，分别描述 single 和 bulk | CUT-01 至 CUT-10 |
| CUT-12 | 运行 clean-cutover 查询 | 无新记录缺 generationMode，无主流程调用旧绑定入口 | CUT-01 至 CUT-11 |

### 执行状态（2026-08-11）

- `CUT-01` 至 `CUT-12` 已完成；Workspace 首页提供 `Add product` 与 `Open production tasks`，Catalog 页面保持单品创建和 CSV Batch import 双入口；
- Batch 创建合同要求显式 `generationMode`，Single / Bulk 创建、任务详情、Pilot / Wave 流程均不再依赖隐式模式；
- Creative Spec 工作台移除 Campaign ID、CatalogItem ID 与 Reference Analysis ID 手工创建表单，创建入口统一回到 Production Batch Item；批准仍由 Spec 工作台执行并自动绑定；
- 未发现 `bind-pilot-spec` 调用或路由；新 CSV 上传固定 `v2`，历史 `v1` 仅可读取，修复与继续处理必须下载 v2；
- 新增 `pnpm cutover:check`，确认无缺失/非法 generation mode、无非法 CSV 版本、无跨 Workspace Campaign / Spec 引用；浏览器验证首页入口和 Spec 页面无手工 ID 输入；
- 当前演示 Workspace 已有可用 Single / Bulk Batch、SKU、Campaign、Spec、Skill、Review 与输出 Asset，未调用 MiniMax 生成新视频。

## N. 验证与验收

### N.1 聚焦验证命令

| 范围 | 最小验证 |
|---|---|
| Product / State contracts | `pnpm bulk:contract-check`、新增 workflow check |
| Catalog / SKU | `pnpm catalog:check` |
| CSV | `pnpm bulk:csv-check` |
| Asset / Reference | `pnpm references:check`、新增 upload diagnostics check |
| Creative Spec | `pnpm creative-spec:check` |
| Production Batch | `pnpm production-batch:check` |
| Shot Skill | `pnpm a1:check`、`pnpm skills:library-check`、`pnpm skills:persistence-check` |
| QA | `pnpm quality:check` |
| 类型和构建 | `pnpm exec tsc --noEmit`、`pnpm build` |

### 执行状态（2026-08-11）

- N.1 聚焦验证已完成：Bulk / workflow / Catalog / CSV / Reference / Creative Spec / Production Batch / Shot Skill A1 / Shot Skill Library / Quality / Security / Cutover 合同均通过；
- `pnpm skills:persistence-check` 使用演示 Owner 环境 `SHOT_SKILL_TEST_TEAM_ID=18 SHOT_SKILL_TEST_USER_ID=18` 通过，临时数据已由聚焦检查回收；
- `pnpm exec tsc --noEmit` 与 `pnpm build` 通过；`ACPT-04`、`ACPT-10`、`ACPT-11` 等真实供应商生成验收不在本轮调用，避免未经确认触发 MiniMax 成本。

### N.2 原子验收任务

| ID | 原子任务 | 可验证完成结果 | 前置 |
|---|---|---|---|
| ACPT-01 | 验证单 SKU 本地图片创建 | Brand Kit 后用 UI 上传图片并创建一个 ready SKU，无 CSV | SKU-15、ASSET-13 |
| ACPT-02 | 验证单品 5 秒 Eligibility | hero 可选，创建前显示 Skill 版本和支持时长 | ELIG-14 |
| ACPT-03 | 验证单品 Spec 自动绑定 | Create → Submit → Approve 后 BatchItem 自动获得 Spec | SPECUX-13 |
| ACPT-04 | 验证单品真实生成 | MiniMax 生成 5 秒视频，QA 通过，Review adopted | ACPT-01 至 ACPT-03 |
| ACPT-05 | 验证单品任务完成 | adopted 后任务、Item 和 Campaign 状态一致且 Batch completed | REVUX-09、ACPT-04 |
| ACPT-06 | 验证 10 秒前置失败 | 无 10 秒 Active Skill 时创建前提示改 5 秒或创建 Skill，无副作用 | ELIG-14 |
| ACPT-07 | 验证 10 秒 Private Skill 路径 | 激活支持 10 秒的 Workspace Skill 后 Eligibility 和成本门可继续 | ELIG-11 至 ELIG-13 |
| ACPT-08 | 验证 CSV v2 三 SKU 导入 | 使用 Brand Kit 名称导入，三行 ready，不手改 ID | CSVUX-12 |
| ACPT-09 | 验证批量 Pilot 自动 Spec | 三个 Pilot Campaign / Spec 创建、批准和绑定无需裸 ID | SPECUX-13 |
| ACPT-10 | 验证批量 Pilot 真实生成 | 三个视频完成 QA，至少两个 adopted，Evaluate 通过 | MODE-11、ACPT-09 |
| ACPT-11 | 验证 Wave 和 Stop-loss | 放量、暂停、恢复和完成保持现有批量合同 | ACPT-10 |
| ACPT-12 | 验证 CORS 失败文案 | 错误显示实际 Origin 和修复步骤，服务端回退可完成上传 | ASSET-08 至 ASSET-10 |
| ACPT-13 | 验证 Workspace 隔离 | 其他团队 Brand Kit / Asset / Spec 不出现在选择器且 API 拒绝 | SEC-08 |
| ACPT-14 | 验证无裸 ID 客户闭环 | 客户不看 URL、不查库、不打开开发者工具完成 single 和 bulk | WORK-15、CUT-12 |
| ACPT-15 | 运行最终回归 | 所有聚焦检查、TypeScript 和生产构建通过 | ACPT-01 至 ACPT-14 |

### 执行状态（2026-08-11）

- ACPT-01、02、03、05、06、07、08、09、12、13、14、15 已通过对应 UI / 聚焦检查；真实 MiniMax H3 执行路径已通过 Bulk Pilot 的 3 个 Job、QA、Review adopted、Evaluate 与 Batch completed 验证；
- ACPT-04 的独立 Single Batch 供应商验收未单独重跑；其前置状态、调度、Worker、QA、Review 与完成事务已由本地聚焦检查和真实 Pilot Job 覆盖；
- ACPT-10 已完成真实 3 SKU Pilot 生成、QA、adopted 与 Evaluate，Batch #44 最终为 completed；
- ACPT-11 已通过真实供应商验收：最新 Key 成功完成 Batch #48 的 3 个 Pilot 与 Wave 1 的 3 个 SKU；6 个 Job 均 `succeeded`，6 个输出 Asset 均完成 QA 并被 Review `adopted`。Wave 1 以 `supplierErrorRate=0.5` 触发 Stop-loss 自动暂停，随后恢复到 `producing`，最终在无阻断观察后进入 `completed`。验收同时修复了非 Pilot Spec 审批后成本确认失效却未重新估算的问题，并补齐自动暂停与 Batch 完成活动日志；
- 真实生成前备份：`backups/saas-starter_pre-minimax-acceptance_20260811104544.dump`；Wave 各次重试前备份为 `backups/saas-starter_pre-real-wave-acceptance_20260811105226.dump`、`backups/saas-starter_pre-funded-wave-acceptance_20260811114622.dump`、`backups/saas-starter_pre-new-key-wave-acceptance_20260811115030.dump`、`backups/saas-starter_pre-latest-key-wave-acceptance_20260811115406.dump`；完整重跑命令为 `pnpm acceptance:real-wave`，中断续跑命令为 `pnpm acceptance:real-wave:continue -- <batchId>`。

## 3. 推荐实施顺序

### P0：先修复阻塞客户闭环的问题

```text
FLOW-01..10
→ DATA-01..10
→ MODE-01..11
→ ELIG-01..14
→ SPECUX-01..13
→ WORK-01..11
→ ERR-01..09
→ REVUX-01..09
```

完成标准：单 SKU 不用 CSV、不填 ID、不会晚到 Schedule 才发现 Skill 不兼容，并能 adopted 后 completed。

### P1：完善素材和 Catalog 体验

```text
SKU-01..15
→ ASSET-01..13
→ CSVUX-01..12
→ WORK-12..15
```

完成标准：客户可本地上传主图、单独创建 SKU；批量 CSV 不再携带其他 Workspace ID；上传失败可诊断。

### P2：切换、审计和批量回归

```text
SEC-01..08
→ CUT-01..12
→ ACPT-01..15
```

完成标准：无双轨写入、无旧绑定 UI、历史记录可读、单品与批量真实闭环均通过。

## 4. 并行边界

在 FLOW 与 DATA 合同冻结后，可并行执行：

```text
Workstream A：SKU-01..15 + Catalog UI
Workstream B：ASSET-01..13 + Upload diagnostics
Workstream C：MODE-01..11 + Batch state
Workstream D：ELIG-01..14 + Shot Skill preview
Workstream E：SPECUX-01..13 + Spec binding
Workstream F：ERR-01..09 + customer copy
```

共享合同：

- A/B 共用 Asset 创建回执和 Readiness；
- C/D 共用 generationMode 和 Eligibility Context；
- C/E 共用 BatchItem、Campaign 和 Spec 自动绑定事务；
- 所有 Workstream 共用 DomainError Schema 与 Workspace 权限规则。

## 5. 最终验收边界

实施完成必须同时满足：

1. 用户可在 Brand Kit 后直接 `Add product`，无需 CSV。
2. 用户可上传本地产品图，失败时不出现通用 `Failed to fetch`。
3. 用户不输入任何数据库 ID。
4. 单 SKU 任务 adopted 后进入 completed。
5. 批量任务继续执行 Pilot、Evaluate、Wave 和止损。
6. 10 秒无 Skill 在创建前被阻止；有 Private Skill 时可以继续。
7. Creative Spec 批准后自动绑定正确 BatchItem。
8. 所有跨 Workspace Brand Kit、Asset、Campaign、Spec 和 Skill 引用均失败。
9. VideoJob 继续绑定冻结 SkillVersion、Spec、Recipe 和 QA 证据。
10. 真实单品和三 SKU 批量生成闭环、TypeScript、生产构建全部通过。
