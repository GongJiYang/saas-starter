# 品牌创意视频工作台：初版范围

## 目标

为国内电商品牌团队提供受商品事实和 Brand Kit 约束的创意视频生产、任务追踪与审批闭环。

首版围绕一次 SKU Campaign 完成闭环：提交完整商品 Brief，获得三张创意假设卡，选择一至三种方向生成视频，并在同一 Campaign 中比较、下载与审批结果。

产品不与海螺竞争底层生成能力。MiniMax H3 V2 负责把生成指令变成视频；本产品负责确定生成什么、约束哪些内容不能错、组织团队审批，并记录哪个创意方向被采用。

## 初版模块

### 1. 登录与企业 Workspace

- 复用现有认证、Team、Owner/Member、成员邀请和活动日志。
- Owner 管理团队与 Brand Kit。
- Member 创建 Campaign、查看任务并审批视频。
- 不新增复杂 RBAC。

### 2. Brand Kit

每个 Brand Kit 包含：

- 名称
- 品牌语调
- 必现元素
- 禁用元素
- 默认镜头偏好

不做版本树、模板市场或复杂规则引擎。

### 3. 新建 Campaign

流程：

1. 上传商品主图和必要的包装、细节参考图。
2. 填写 SKU、正式商品名称、规格、已批准卖点和禁止表达。
3. 填写目标人群、Campaign 目标、目标平台和视频时长。
4. 选择 Brand Kit。
5. 创建 Campaign，获得恰好三张创意假设卡：痛点型、利益型和场景型。
6. 查看每张卡的目标人群、Hook、核心卖点、创意理由和镜头纲要。
7. 选择一至三张创意假设卡并提交生成；每个选中方向创建一个独立视频任务。

三张卡用于比较不同的创意切入，不是三个随机风格模板。首版固定创意类型，不做节点图、Prompt Playground、时间轴、自由镜头编排或无限模板库。

### 4. 任务列表

展示：

- Campaign 与 SKU
- 关联的创意假设
- 本方向的生成版本
- 提交时间
- 状态：`排队中`、`生成中`、`成功`、`失败`
- 失败原因
- 成功视频预览与下载

失败任务可重试，重试沿用原 Campaign、创意假设、商品素材和冻结生成配方，不把重试变成新的创意方向。

### 5. 审批页

- 按 Campaign 并排展示成功视频及其创意假设。
- 显示每个方向的 Hook、核心卖点和创意理由，避免只比较画面。
- 操作：`采用`、`不采用`。
- 不采用时必须选择结构化原因，可补充文字说明。
- 保存审批人、时间、原因分类和补充说明。

不做多级审批、审批节点编排、客户门户或自动投放效果判断。

## 页面结构

```text
/dashboard                 Workspace 总览：进行中任务、待审批视频
/brand-kits                Brand Kit 列表与编辑
/campaigns                 Campaign 列表
/campaigns/new             商品 Brief → Brand Kit → 创建 Campaign
/campaigns/[id]            三张创意假设卡 → 选择 1–3 张 → 提交 → 版本比较
/jobs                      按 Campaign / 创意假设查看任务、重试与下载
/reviews                   按 Campaign 比较视频、采用或填写结构化拒绝原因
```

## 初版数据模型

```text
Team / TeamMember       复用现有企业 Workspace
BrandKit                品牌规则
Asset                   商品主图、细节图、生成视频、对象存储 key
Campaign                一次 SKU 创意实验及其商品 Brief
CreativeHypothesis      Campaign 的三个固定创意方向之一
GenerationRecipe        每个任务冻结的 Brief、规则、Prompt 与模型参数
VideoJob                假设对应的队列任务、MiniMax task_id、状态、失败原因、产物
Review                  采用/不采用、结构化原因、补充说明和审批人
```

`GenerationRecipe` 首版只在后端保存，不做复杂编辑器。Campaign 创建时先冻结商品 Brief 与 Brand Kit 快照；任务提交时，Recipe 再冻结所选创意假设、素材、Prompt 和模型参数，使同一 Campaign 的多个方向可解释、任务可复现、失败重试不改变创意变量。

多模型路由、复杂参数版本管理和公开额度页不进入首版 UI。

如果首发收费，后端使用 `CreditLedger` 保存预扣、结算和退款，余额由账本聚合得出，不直接修改余额；若首发不收费，计费模块延后。

## 技术边界

- Next.js + Postgres + Drizzle 保存业务事实。
- BullMQ 6 supports Redis/Valkey and PostgreSQL queue backends. This project intentionally uses Redis/Valkey for queues, while Postgres remains the source of business facts.
- Worker 在服务端调用 MiniMax H3 V2，浏览器不接触供应商密钥。
- 对象存储首发仅接入腾讯 COS 或阿里 OSS 之一。
- 浏览器通过短期签名 URL 上传素材。

## 明确不做

- 节点图工作流
- 多模型选择、模型路由或模型比较
- 时间轴、剪辑器、字幕编辑器、复杂 Prompt 编辑器
- 自托管 GPU、模型训练或推理服务
- 多级审批、客户门户、素材市场
- 同时接入多家对象存储供应商

## 实施顺序

1. 复用认证与 Team，新增产品导航。
2. 实现 Brand Kit、Asset、Campaign 与 CreativeHypothesis。
3. 接对象存储上传，完成商品 Brief、三张创意假设卡和一至三张多选流程。
4. 接 Redis、BullMQ Worker 与 MiniMax H3 V2，为每个选中方向创建独立任务并冻结 GenerationRecipe。
5. 完成按 Campaign 比较的 Review 审批页、结构化拒绝原因与活动日志。

## 实施时新增环境变量

```text
REDIS_URL
OBJECT_STORAGE_*
MINIMAX_API_KEY
MINIMAX_API_BASE_URL
```

## 原子化实施任务

每项任务只交付一个可验证结果；不把数据模型、接口、页面和 Worker 混在同一项中。

### A. 基础设施与运行配置

| ID | 原子任务 | 完成结果 | 前置 |
|---|---|---|---|
| INF-01 | 安装 BullMQ 与 Redis 客户端 | Web 与 Worker 共享锁定版本的队列依赖 | 无 |
| INF-02 | 新增运行环境变量校验 | 缺少 Redis、对象存储或 MiniMax 配置时服务端明确失败 | INF-01 |
| INF-03 | 建立 Redis 连接工厂 | Web 入队与 Worker 消费复用连接配置 | INF-02 |
| INF-04 | 建立 Worker 进程入口 | 可独立启动、接收终止信号并关闭队列连接 | INF-03 |
| INF-05 | 选择并实现一个对象存储适配器 | 只支持 COS 或 OSS 其中之一 | INF-02 |
| INF-06 | 签发素材上传 URL | 已授权团队成员可获得短期、限定 key 的上传 URL | INF-05 |
| INF-07 | 签发视频下载 URL | 已授权团队成员可获得短期视频下载 URL | INF-05 |

### B. 数据模型与团队隔离

| ID | 原子任务 | 完成结果 | 前置 |
|---|---|---|---|
| DATA-01 | 定义产品状态枚举 | Campaign、VideoJob、Review 状态和拒绝原因只使用受限值 | 无 |
| DATA-02 | 新增 BrandKit 表 | 品牌规则按 `teamId` 保存 | DATA-01 |
| DATA-03 | 新增 Asset 表 | 素材类型、对象存储 key、授权信息按 `teamId` 保存 | DATA-01 |
| DATA-04 | 新增 Campaign 表 | SKU、商品事实、目标人群、Campaign 目标、平台、时长、Brand Kit 快照和归属团队可保存 | DATA-01 |
| DATA-05 | 新增 CreativeHypothesis 表 | 每个 Campaign 保存恰好三个含 Hook、卖点、理由和镜头纲要的方向 | DATA-04 |
| DATA-06 | 新增 VideoJob 表 | 每个任务关联一个创意假设，并保存状态、MiniMax `task_id`、失败信息和产物 | DATA-05 |
| DATA-07 | 新增 GenerationRecipe 表 | 每个任务冻结 Brief、Brand Kit、假设、素材、Prompt 和模型参数 | DATA-06 |
| DATA-08 | 新增 Review 表 | 审批结论、结构化原因、补充说明和审批人可保存 | DATA-06 |
| DATA-09 | 增加外键、唯一约束和团队索引 | 关联完整；每个 Campaign 只有三个类型互异的假设；常用团队查询有索引 | DATA-02 至 DATA-08 |
| DATA-10 | 生成并应用 Drizzle migration | 空数据库和升级数据库均得到同一结构 | DATA-09 |
| DATA-11 | 建立团队范围查询函数 | 每次查询都要求 `teamId`，不接受未授权跨团队访问 | DATA-10 |

### C. Workspace 与产品导航

| ID | 原子任务 | 完成结果 | 前置 |
|---|---|---|---|
| WS-01 | 校验 Workspace 成员访问 | 现有 Team/Member 能决定产品页面访问权 | DATA-11 |
| WS-02 | 替换 Dashboard 产品导航 | 导航仅包含总览、Brand Kit、Campaign、任务、审批和设置 | WS-01 |
| WS-03 | 构建 Workspace 总览查询 | 返回进行中任务与待审批视频的团队范围统计 | DATA-11 |
| WS-04 | 渲染 Workspace 总览页面 | 用户进入后能跳转到 Campaign、任务或审批操作 | WS-02、WS-03 |

### D. Brand Kit

| ID | 原子任务 | 完成结果 | 前置 |
|---|---|---|---|
| BRAND-01 | 创建 BrandKit 写入校验 | 名称、语调、必现元素、禁用元素、镜头偏好合法 | DATA-02 |
| BRAND-02 | 实现 BrandKit 创建操作 | Owner 可为当前 Workspace 新建 Brand Kit | BRAND-01、WS-01 |
| BRAND-03 | 实现 BrandKit 编辑操作 | Owner 可更新当前 Workspace 的 Brand Kit | BRAND-02 |
| BRAND-04 | 实现 BrandKit 团队列表 | 用户只能看到当前 Workspace 的 Brand Kit | DATA-11 |
| BRAND-05 | 渲染 Brand Kit 管理页 | 可创建、编辑、查看 Brand Kit | BRAND-02 至 BRAND-04 |

### E. 商品 Brief 与 Campaign 创建

| ID | 原子任务 | 完成结果 | 前置 |
|---|---|---|---|
| CAMP-01 | 定义三种固定创意假设模板 | 痛点型、利益型、场景型均定义目标、Hook 规则、创意理由和镜头结构 | 无 |
| CAMP-02 | 创建 Asset 上传完成写入操作 | 商品主图和细节图上传成功后保存 Asset 元数据与对象存储 key | INF-06、DATA-03 |
| CAMP-03 | 实现 Campaign Brief 校验 | SKU、商品名、参考图、批准卖点、禁止表达、人群、目标、平台、时长和 Brand Kit 必须有效 | BRAND-04、CAMP-01 |
| CAMP-04 | 实现 Campaign 与三张创意假设写入 | 同一事务冻结 Brief 与 Brand Kit，并生成痛点型、利益型、场景型三个内容完整且类型互异的假设 | DATA-04、DATA-05、CAMP-03 |
| CAMP-05 | 实现创意假设多选校验 | 一次提交只能选择当前 Campaign 中一至三张互异的创意假设 | CAMP-04 |
| CAMP-06 | 构建 Campaign 创建页面 | 可提交完整商品 Brief、选择 Brand Kit、查看三张假设并多选提交 | CAMP-02 至 CAMP-05 |
| CAMP-07 | 构建 Campaign 团队列表 | 显示当前团队活动、SKU、已提交方向数及总体生成状态 | DATA-11 |
| CAMP-08 | 构建 Campaign 详情页 | 并排显示商品 Brief、三个创意假设及各自任务、版本和审批结果 | CAMP-05、CAMP-07 |

### F. 视频生成任务

| ID | 原子任务 | 完成结果 | 前置 |
|---|---|---|---|
| JOB-01 | 定义 VideoJob 状态迁移规则 | 只有 `queued → generating → succeeded/failed` 等合法迁移 | DATA-06 |
| JOB-02 | 批量创建 VideoJob 与 GenerationRecipe | 一次提交为每个选中假设各创建一个 `queued` Job，并用 Campaign 快照生成一份冻结配方，数量始终为一至三个 | CAMP-05、DATA-07、JOB-01 |
| JOB-03 | 实现 BullMQ 入队生产者 | 每个新 Job 只入队一次，携带内部 `videoJobId` | INF-03、JOB-02 |
| JOB-04 | 实现 MiniMax 提交 Worker | Worker 使用冻结配方创建外部任务并持久化 `task_id` | INF-04、JOB-03 |
| JOB-05 | 实现延迟轮询 Worker | 未完成任务按延迟重新入队，不忙轮询 | JOB-04 |
| JOB-06 | 实现成功产物归档 | 成功视频保存为 Asset，并将 Job 标为 `succeeded` | INF-05、JOB-05 |
| JOB-07 | 实现失败与重试处理 | 记录供应商失败原因；可重试错误沿用原假设和冻结配方并按上限重试 | JOB-05 |
| JOB-08 | 构建任务团队列表查询 | 按 Campaign 和创意假设返回任务状态、失败原因、版本和产物 | DATA-11、JOB-01 |
| JOB-09 | 渲染任务列表页面 | 可按 Campaign / 假设查看排队、生成、失败、成功、重试和下载 | INF-07、JOB-08 |

### G. 审批与交付

| ID | 原子任务 | 完成结果 | 前置 |
|---|---|---|---|
| REVIEW-01 | 实现待审批视频查询 | 按 Campaign 返回当前团队成功且尚未审批的视频及其创意假设 | DATA-08、JOB-06 |
| REVIEW-02 | 实现采用审批操作 | 保存采用结论、审批人和时间 | REVIEW-01 |
| REVIEW-03 | 实现不采用审批操作 | 结构化原因必选、补充说明可选，并保存审批人和时间 | REVIEW-01 |
| REVIEW-04 | 写入关键活动日志 | 创建 Campaign、提交所选方向、重试、采用和不采用均留痕 | CAMP-04、JOB-07、REVIEW-02、REVIEW-03 |
| REVIEW-05 | 渲染 Campaign 比较审批页 | 并排预览各方向视频、创意理由和版本，并可采用或填写拒绝原因 | INF-07、REVIEW-02、REVIEW-03 |

## 分组与交付顺序

```text
P0  基础设施与数据模型     INF-01 至 INF-07，DATA-01 至 DATA-11
P1  可见的创作工作台       WS-01 至 WS-04，BRAND-01 至 BRAND-05，CAMP-01 至 CAMP-08
P2  真实视频生成闭环       JOB-01 至 JOB-09
P3  审批与交付             REVIEW-01 至 REVIEW-05
```

P1 完成后，团队能提交完整商品 Brief，获得恰好三张创意假设卡，并选择一至三张，但不会调用模型。P2 才为每个选中方向创建独立任务并接入真实 MiniMax 生成。P3 结束时，团队可在同一 Campaign 中比较多个方向并完成审批。

## 阶段验收

| 阶段 | 可验证结果 |
|---|---|
| P0 | 服务端缺失关键配置会失败；数据库迁移可应用；团队范围查询不能读到其他团队数据。 |
| P1 | Owner 可维护 Brand Kit；Member 可提交商品 Brief；每个 Campaign 恰好得到痛点型、利益型、场景型三个假设，并可选择一至三张。 |
| P2 | 一次提交创建的任务数与选中假设数一致且为一至三个；每个任务关联唯一假设和冻结配方；任务可成功、失败、重试和下载。 |
| P3 | 同一 Campaign 的多个成功视频可按创意假设并排审批；不采用必须选择结构化原因；活动日志保留关键动作。 |
