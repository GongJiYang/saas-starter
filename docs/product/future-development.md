# 产品发展路线与已敲定 V1

本文件同时记录两类内容：

1. 已敲定的 SKU Campaign 创意包 V1，作为产品行为与后续开发任务的依据；
2. 只有经过真实客户验证后才启动的积分、Skill、创意预制库和高级能力。

`docs/product/market-validation-mvp.md` 是当前阶段唯一实施蓝图；本文件保存产品语义、长期路线和明确延后能力。仓库中仍存在的 Shot Card 单选实现属于待迁移现状，不代表目标产品定位。

## 1. 创意预制库

### 已敲定的 V1 基线

V1 固定向用户返回三个候选，首轮框架固定为：

```text
痛点型
利益型
场景型
```

固定的是候选数量和首轮思考框架，不是固定 Prompt 或固定视频。每张卡的目标人群、Hook、已批准卖点、创意理由、镜头纲要和最终 Prompt 都由当前 Product Brief、Brand Kit 与创意 Brief 编译器动态产生。

`CreativeHypothesis` 与 `GenerationRecipe` 已进入 V1：

- Campaign 创建时冻结 Product Brief 与 Brand Kit Snapshot；
- 用户选择一至三个假设后，每个方向创建独立 GenerationVersion、VideoJob 和 Recipe；
- Recipe 冻结素材、Prompt、模型、时长、比例和分辨率；
- 重试不得在后台悄悄改变原假设的核心创意逻辑。

### 后续问题

V1 只有三个首轮框架，仍不能解决：

- 不同商品类目需要不同的候选策略；
- 团队不能保存和复用行业化创意套路；
- 奢侈品、香水等商品可能不适合痛点型表达；
- 已被真实采用的成功结构还不能成为团队私有资产。

### 触发条件

满足下列任一真实信号后再建设创意预制库：

- 用户持续要求不同于痛点型、利益型、场景型的方向；
- 某类目反复出现不适用或低采用的默认方向；
- 团队反复复制同类 Campaign；
- 已有足够采用与拒绝数据证明某些结构值得复用。

### 后续模型

```text
CreativePreset
- id
- name
- category                 # 电商、餐饮、美妆、3C、服装等
- hypothesisType
- promptFragment
- defaultDuration
- defaultRatio
- previewAssetId nullable
- active
- teamId nullable          # null 为平台模板；有值为团队私有模板
```

### 产品原则

- 页面仍然只返回三个候选，不扩成无限模板列表；
- V1 先固定痛点型、利益型、场景型，验证用户是否理解、选择并采用；
- 后续从内部策略池中按商品类目、Campaign 目标和品牌历史选择最合适的三个；
- 只有被真实采用的结构才进入官方或团队私有预制；
- 优先建设团队私有预制，不先做公开模板市场。

## 2. 积分账本与 API 用量计费

### 当前状态

当前项目有 Stripe 订阅骨架，但没有积分、API 用量、预扣、结算或退款实现。

```text
已有：Stripe Checkout、Team subscription status、Webhook
没有：CreditLedger、余额、VideoJob 扣费、失败退款、套餐额度
```

用户不能购买 MiniMax API Key；用户购买的是本产品的生成能力与额度，MiniMax Key 只保存在服务端 Worker。

### 触发条件

满足下列信号后再做：

- 用户完成真实视频生成并明确表现出续用或付费意愿；
- MiniMax 实际成本、成功率和平均时长已可测量；
- 已确定按时长、分辨率或模型组合的收费规则；
- 免费内测额度不足以管理成本。

### 推荐初始商业模式

先售卖积分包，而不是复杂的按量订阅：

```text
Starter：100 Credits
Growth：500 Credits
Team：2000 Credits
```

积分消耗按实际模型成本映射。当前固定 `MiniMax-H3 + 768P` 时，可先按视频时长分档：

```text
4–5 秒   = X Credits
6–10 秒  = Y Credits
11–15 秒 = Z Credits
```

具体 X/Y/Z 必须根据 MiniMax 实际价格、对象存储和运营成本确定，不能先写死。

### 目标模型

```text
CreditLedger
- id
- teamId
- videoJobId nullable
- type: purchase | reservation | settlement | refund | adjustment
- creditsDelta
- idempotencyKey
- reason
- createdAt
```

### 不变量

```text
availableCredits = SUM(CreditLedger.creditsDelta)
```

- 不以可直接修改的 `balance` 字段作为资金真相；
- 创建 VideoJob 时，在同一数据库事务中验证余额并写入 `reservation`；
- 生成成功时写入 `settlement`；
- 最终失败、取消或无法交付时写入 `refund`；
- 每条账本记录必须有幂等键，避免队列重试、Webhook 重放或重复请求重复扣费；
- Stripe 支付成功由 Webhook 写入 `purchase`，不能以浏览器回跳作为入账依据。

### 实施顺序

1. 接入真实 COS 与 MiniMax，获取真实成本数据；
2. 明确积分与实际成本的映射；
3. 建立 CreditLedger 与余额聚合查询；
4. 将 VideoJob 提交接入预扣、结算和退款；
5. 为 Stripe 配置积分包 Product / Price 与可靠 Webhook；
6. 增加团队额度页面与管理员 Adjustment 操作。

## 3. 垂直工作流 Skill

### 判断

Skill 是潜在核心卖点，但不应被定义为“大量 Prompt 的下拉列表”。

```text
无价值的 Skill = 一段风格 Prompt

有价值的 Skill = 业务目标
               + 必需素材
               + 结构化输入
               + 生成配方
               + 多步骤工作流
               + 质量约束
               + 审批标准
```

平台的目标不是做通用 MiniMax-H3 包装器，而是将特定商业结果稳定交付给特定客户群。

### 当前基础

已敲定 V1 提供 Skill Runtime 的主要组成：

| V1 模块 | Skill 中的职责 |
|---|---|
| BrandKit Snapshot | 品牌约束 |
| Product Brief | 商品事实、批准卖点、禁止项与 Campaign 目标 |
| Asset | Skill 输入素材 |
| Campaign | 一次 Skill 执行实例 |
| CreativeHypothesis | 编译器给出的三个创意假设 |
| GenerationRecipe / Version | 冻结执行配方并保存版本 |
| VideoJob | 模型执行状态与重试 |
| Review / ApprovedDeliverable | 输出验收、采用理由与交付物 |
| COS / BullMQ / MiniMax H3 | 素材、异步工作流与视频执行器 |

三张 `CreativeHypothesis` 是第一个 Skill 的候选输出，不是三个可由用户自由编辑的 Prompt，也不是三个随机风格模板。

### 首个建议 Skill

```text
Skill：电商新品发布短视频

目标：
- 为一个 SKU 生成可比较、可审批的商品视频创意包

输入：
- 商品主图与细节图
- 商品名称、规格和批准卖点
- 禁止表达与不可改变内容
- 目标人群与 Campaign 目标
- Brand Kit
- 目标平台与视频时长

V1 固定候选框架：
1. 痛点型
2. 利益型
3. 场景型

输出：
- 三张动态生成并通过校验的创意假设卡
- 用户选中方向的 H3 候选视频
- GenerationRecipe 与版本记录
- 采用 / 不采用及结构化原因
- ApprovedDeliverable 与 Campaign 下载入口
```

### 触发条件

在完成首批真实客户验证后，满足下列信号再实现通用 Skill 层：

- 同一行业工作流被重复使用；
- 用户反复要求特定行业、场景或镜头套路；
- 用户需要保存、复用或分享成功结构；
- 已有足够的采用 / 不采用原因来判断哪个工作流有效；
- 已能够定义每个 Skill 的输入完整性与输出验收标准。

### 产品原则

- 先打磨一个垂直 Skill，不同时铺开美妆、服装、餐饮、3C、家居等多个行业；
- 不直接抓取和堆积未验证的互联网 Prompt；
- 以真实客户 Brief、生成结果、失败原因和采用率持续优化 Skill；
- Skill 需要明示适用商品、需要的素材、禁止场景和预期输出；
- 只有被真实采用的工作流，才进入官方 Skill 库；
- 团队私有 Skill 优先于公开 Skill 市场。

### 后续模型

在 `CreativePreset` 与 `GenerationRecipe` 之上增加：

```text
WorkflowSkill
- id
- name
- category
- description
- requiredInputs
- assetRequirements
- creativePresetIds
- validationRules
- reviewRubric
- active
- teamId nullable

SkillRun
- id
- workflowSkillId
- campaignId
- inputSnapshot
- recipeIds
- outcome
- adopted
- createdAt
```

### 衡量指标

Skill 的成功不按“生成次数”衡量，而按：

```text
输入完成率
→ Campaign 提交率
→ 生成成功率
→ 审批采用率
→ 复用率
→ 付费转化率
```

### 实施顺序

1. 用“电商新品发布短视频”闭环服务首批真实用户；
2. 记录每次 Product Brief、CreativeHypothesis、Recipe、生成版本与审批原因；
3. 比较痛点型、利益型、场景型在不同类目的选择率与采用率；
4. 根据真实数据调整内部候选策略，但页面仍只返回三个；
5. 将被反复采用的结构固化为官方或团队私有 `CreativePreset`；
6. 最后才评估通用 WorkflowSkill 层和公开 Skill 市场。

## 4. 自助 SaaS V1：原子化必做任务

### V1 交付边界

V1 的目标不是“用户可以调用 H3”，而是：

```text
首次用户
→ 自助完成 Brand Onboarding
→ 提交 Product Brief
→ 获得三个创意假设
→ 选择一个或多个假设生成
→ 比较结果
→ 审批与下载
→ 明确扣费、失败退款与剩余额度
```

在这个流程中，`VideoJob` 是内部执行记录；用户看到和管理的核心对象是 `Campaign` 创意实验。

### A. Campaign 创意实验模型

| ID | 原子任务 | 完成定义 | 依赖 |
|---|---|---|---|
| EXP-01 | 扩展 Product Brief 字段 | 保存产品名称、类别、目标人群、目标、CTA、合规限制 | 现有 Campaign |
| EXP-02 | 冻结 Brand Kit 快照 | 创建 Campaign 时保存不可变 Brand Kit Snapshot | EXP-01 |
| EXP-03 | 定义 CreativeHypothesis | 每个 Campaign 保存三个有目标、理由和预期结果的营销假设 | EXP-01 |
| EXP-04 | 迁移 Shot Card 语义 | ShotCard 只作为 CreativeHypothesis 的镜头结构，不再是核心对象 | EXP-03 |
| EXP-05 | 定义 GenerationRecipe | 冻结 Prompt、模型、时长、比例、分辨率、输入 Asset 版本 | EXP-02、EXP-03 |
| EXP-06 | 定义 GenerationVersion | 一条假设可有多个生成版本；每个版本关联一个 VideoJob | EXP-05 |
| EXP-07 | 定义 CampaignDecision | 保存胜出假设、最终采用版本和 Campaign 级决策原因 | EXP-06 |
| EXP-08 | 定义 ApprovedDeliverable | 一次 Campaign 可交付多个已采用视频，而不是只有一条 MP4 | EXP-07 |

**V1 约束：** 保留 `Campaign` 名称，不做破坏性重命名；它在产品语义上即是 Campaign 创意实验。

### B. 创意 Brief 编译器

三个创意方向由本产品的创意 Brief 编译器生成，不由用户手写，也不由 H3 自由决定。责任链固定为：

```text
用户提供商品事实
→ 规则层冻结 Product Brief 与 Brand Kit 边界
→ 文本 LLM 起草三个结构化创意假设
→ 程序校验卖点、禁用项、字段完整性和方向差异
→ 封闭 Beta 由创意运营人员审核修正
→ 客户选择一至三个方向
→ H3 只负责执行选中方向并生成视频
```

文本 LLM 只能引用已批准卖点，不能补造功效、规格、数字或证明。编译失败必须显示业务化错误并允许重试，不能用空卡、通用兜底文案或未校验结果继续生成视频。

| ID | 原子任务 | 完成定义 | 依赖 |
|---|---|---|---|
| COMP-01 | 建立文本模型适配器 | 服务端可调用一个锁定的文本模型；供应商密钥不进入浏览器 | 运行配置 |
| COMP-02 | 定义假设输出 Schema | 每张卡固定包含类型、Hook、批准卖点引用、理由、镜头纲要、适用条件和测试变量 | EXP-03 |
| COMP-03 | 定义 V1 三框架模板 | 痛点型、利益型、场景型只规定思考框架，不写死具体文案和 Prompt | COMP-02 |
| COMP-04 | 构建事实约束 Prompt | 模型输入只使用冻结 Brief、Brand Kit、批准卖点和禁止项 | EXP-02、COMP-03 |
| COMP-05 | 校验模型输出 | 拒绝缺字段、重复方向、未批准卖点、禁用表达和凭空增加的商品事实 | COMP-02、COMP-04 |
| COMP-06 | 实现三假设编译操作 | 一次调用只得到三个全部通过校验的假设；失败不写入半成品并可安全重试 | COMP-05 |
| COMP-07 | 建立封闭 Beta 人工审核 | 运营人员可在客户看到前批准或修正假设，所有修改留痕 | COMP-06 |

`COMP-07` 是封闭 Beta 的质量兜底，不是自助 SaaS V1 的永久运行依赖。进入公开自助阶段前，`COMP-01` 至 `COMP-06` 必须能在没有人工介入时稳定完成。

### C. 自助创作流程

| ID | 原子任务 | 完成定义 | 依赖 |
|---|---|---|---|
| FLOW-01 | 建立品牌引导向导 | 通过品牌名称、语气、禁用项和视觉偏好生成初始 Brand Kit | EXP-02 |
| FLOW-02 | 建立 Product Brief 向导 | 用户填业务 Brief，不要求写 Prompt | EXP-01 |
| FLOW-03 | 校验输入完整性 | 缺商品图、卖点、合规项或平台时给出业务化提示 | FLOW-02 |
| FLOW-04 | 生成三个创意假设 | 调用编译器返回全部通过校验的痛点型、利益型、场景型假设，不暴露底层 Prompt | EXP-03、FLOW-03、COMP-06 |
| FLOW-05 | 展示假设理由与预期 | 每张卡显示适用目标、镜头结构、预期表达和所需素材 | FLOW-04 |
| FLOW-06 | 允许按假设生成 | 用户可选择当前 Campaign 中一至三个互异假设，每个方向创建独立 GenerationVersion | EXP-06、FLOW-05 |
| FLOW-07 | 比较生成版本 | 在一个 Campaign 内并排预览不同假设和不同版本 | EXP-06 |
| FLOW-08 | 复制成功 Campaign | 复用已采用 Brief、Skill 和 Recipe，同时要求用户确认新素材 | EXP-05、EXP-08 |

### D. 当前市场验证商业规则

当前阶段不实施 CreditLedger，也不出售抽象积分。使用一次性 `CampaignOrder` 销售 Focus、Compare、Full Experiment 三种 SKU Campaign 套餐；订单直接授权本次 Campaign 可生成的一至三个方向以及有限技术失败重试。

CampaignOrder、Stripe 一次性 Checkout、Beta 免单订单和无积分定价的原子任务以 `docs/product/market-validation-mvp.md` 为准。

积分账本、余额、充值包、预扣、结算和退款保留在本文件第 2 节，只有市场验证证明用户愿意重复购买 Campaign 后才启动。

### E. 交付、恢复与信任

| ID | 原子任务 | 完成定义 | 依赖 |
|---|---|---|---|
| DEL-01 | 业务化失败提示 | 将队列、COS、MiniMax 原始错误映射为可行动的用户提示 | 现有 VideoJob |
| DEL-02 | 生成恢复操作 | 用户可基于同一 Recipe 重试、换素材或修改 Brief 后重新生成 | EXP-05、EXP-06 |
| DEL-03 | 素材权利确认 | 上传时记录用户对素材使用权和授权责任的确认 | FLOW-02 |
| DEL-04 | 结构化审批原因 | 采用 / 不采用包含标签与补充文本，例如产品变形、品牌不一致、卖点不清晰 | EXP-06 |
| DEL-05 | Campaign 交付包 | 用户在 Campaign 级下载全部 ApprovedDeliverables | EXP-08 |
| DEL-06 | 客户支持入口 | 每个失败或不采用结果都能发起带上下文的支持请求 | DEL-01 |

### F. 验证和运营指标

| ID | 原子任务 | 完成定义 | 依赖 |
|---|---|---|---|
| METRIC-01 | 定义漏斗事件 | 记录 onboarding、Brief 完成、假设生成、生成提交、成功、采用、复用 | FLOW-01 至 FLOW-07 |
| METRIC-02 | 计算假设采用率 | 按 Skill、创意假设、产品类别和平台计算采用率 | EXP-07、DEL-04 |
| METRIC-03 | 计算复购和付费指标 | 计算价格页到 CampaignOrder 支付转化，以及第二个付费 Campaign 的创建率 | CampaignOrder |
| METRIC-04 | 建立内部验证视图 | 团队可查看失败率、采用率、返工原因和高价值客户 | METRIC-01 至 METRIC-03 |

### V1 完成标准

公开市场验证 MVP 必须在没有人工运营介入时完成：

```text
新用户注册
→ 完成 Brief
→ 编译器生成三个通过校验的创意假设
→ 用户选择一至三个方向
→ 购买对应 Campaign 套餐或使用 Beta 免单订单
→ 生成候选视频
→ 失败时理解并执行受限重试
→ 比较结果
→ 审批与下载创意包
```

同时必须满足：

```text
恰好返回痛点型、利益型、场景型三个互异假设
假设只能引用已批准卖点，不出现禁用表达或新增商品事实
编译失败不保存半成品，也不创建视频任务
每次视频生成可复现
每笔 CampaignOrder 可追溯
未支付或未获 Beta 授权不能生成
每个输出可追溯到 Campaign、假设、Recipe、订单和审批结果
```

## 5. 本阶段明确不做

这些内容全部保留在后续待做清单；它们不能阻塞自助 SaaS V1。

### 不做：模型和编辑能力

```text
多模型选择或模型路由
自托管 GPU、模型训练或推理
时间轴编辑器
字幕编辑器
配音编辑器
逐帧视觉编辑
Prompt Playground
```

### 不做：Skill 市场和横向扩张

```text
公开 Skill 市场
用户出售 Skill
一次覆盖多个行业
数十个未验证模板
团队 Skill 共享市场
复杂的 Skill 推荐算法
```

V1 只打磨：

```text
电商新品发布短视频
```

### 不做：复杂协作与企业能力

```text
多级审批流
可配置审批节点
客户门户
复杂 RBAC
项目成员任务分配
SLA 排班系统
批量客户管理后台
```

### 不做：高级交付形态

```text
客户界面中的 30 秒多段拼接
自动配乐
自动字幕
自动社媒发布
广告投放平台回传
批量导出和批量生成
```

当前的 `pnpm sample:30` 仅用于内部样片和 Skill 验证；在 GenerationVersion 与 CampaignDecision 完成前，不把它作为客户承诺。

### 不做：过早商业复杂度

```text
多币种
税务系统
按秒精确结算
企业合同计费
发票自动化
多层套餐矩阵
渠道分佣
```

## 6. SKU Campaign 创意包：V1 产品流程

本节是自助 SaaS V1 的产品行为定义。它优先于“VideoJob 提交页”的现有交互。

```text
提交 SKU 制作资料
→ 系统检查完整性
→ 返回 3 个创意假设
→ 用户选择 1～3 个方向
→ 每个方向生成候选视频
→ 规则质检剔除明显废片
→ 用户得到 1～3 条可审批创意视频
```

### 6.1 SKU 制作资料

“提交 SKU”是提交完整 Product Brief，不是填写 SKU 编号。

| 资料 | V1 处理方式 |
|---|---|
| 商品主图、细节图 | 必填 Asset；首版由用户上传 |
| 商品名称、型号、规格 | 必填结构化字段 |
| 已批准卖点 | 必填结构化字段 |
| 禁止宣传语 | 必填；与 Brand Kit 禁用项合并 |
| 目标人群 | 必填结构化字段 |
| Campaign 目标 | 必填，例如种草、卖点解释、促销 |
| 目标平台、时长 | 必填；驱动 Recipe |
| Brand Kit | 必填；创建 Snapshot |
| 必须展示和不能改变的内容 | 必填或显式确认“无” |

电商 SKU 库自动读取属于后续集成；首版必须允许用户上传或填写全部资料。

### 6.2 三个创意假设

系统先返回文本创意卡和简单分镜预览，不立即消耗视频生成额度。

V1 的数量和首轮方向框架固定：

```text
固定数量：恰好三个候选
固定框架：痛点型、利益型、场景型
```

具体内容不固定。创意 Brief 编译器根据本次 SKU、目标人群、Campaign 目标、已批准卖点、禁止表达和 Brand Kit 动态生成每张卡的 Hook、理由、镜头纲要与 Prompt。

生成责任分工：

| 参与者 | 责任 |
|---|---|
| 客户 | 提供商品事实、批准卖点、禁止项、目标和素材 |
| 固定策略模板 | 规定痛点型、利益型、场景型三个思考框架 |
| 文本 LLM | 起草三个方向的结构化内容 |
| 校验程序 | 拒绝编造事实、未批准卖点、禁用表达、缺字段和重复方向 |
| 创意运营人员 | 封闭 Beta 中审核或修正假设，不替代客户最终选择 |
| 客户审批人 | 选择一至三个值得生成的方向 |
| MiniMax H3 V2 | 只执行已选方向，将冻结 Recipe 生成视频 |

因此，H3 不决定创意方向，客户也不需要自己写 Prompt。V1 的生成原则是“规则确定边界、文本模型起草、程序校验、人类批准、H3 执行”。

每个 `CreativeHypothesis` 必须包含：

```text
创意名称
核心测试变量
目标人群 / 场景
创意说明
开场 Hook
镜头结构
预期表达的产品利益
适用和不适用条件
预计生成 Credits
```

示例：

```text
创意 A：痛点切入
测试变量：痛点型 Hook

创意 B：利益切入
测试变量：利益型 Hook

创意 C：场景切入
测试变量：使用场景
```

三个假设比较时，以下内容必须冻结不变：

```text
商品
已批准卖点
视频时长
品牌调性
目标平台
合规与禁止项
```

只有 Hook、叙事切入和镜头结构可以变化。这样结果才是可比较的创意实验，而不是三条随机视频。

### 6.3 选择、版本和重试

用户可以选择：

```text
只生成一个假设
生成两个假设
生成三个假设
```

每个被选假设先生成一个候选版本：

```text
创意 B：利益切入
├── B-V1：首次生成
├── B-V2：同一假设下的重试版本
└── B-V3：更换素材或 Brief 后的新版本
```

同一假设的核心创意逻辑不变；变化必须通过 `GenerationRecipe` 明确记录。

### 6.4 质量门槛

V1 的基础质量门槛是自动规则，而不是承诺每条 H3 输出都完美：

```text
生成成功
→ 视频可播放
→ 时长与期望匹配
→ 产品 Asset 关联完整
→ 无平台或存储错误
→ 进入可审批候选集合
```

人工筛除明显废片可以作为：

```text
封闭 Beta 的运营兜底
或付费的人工质检增值服务
```

它不能成为自助 SaaS V1 的隐藏强依赖；否则用户仍需要等待人工运营才能完成流程。

后续规则质检可逐步增加：

```text
商品严重变形
产品主体不可见
无关文字
品牌禁用元素
不符合时长
```

### 6.5 Campaign 创意包交付

用户最终得到的是 Campaign 创意包：

```text
某 SKU Campaign
├── 创意 A 候选视频.mp4
├── 创意 B 候选视频.mp4
├── 创意 C 候选视频.mp4
├── 每条视频的创意说明
├── 每条视频的版本与审批记录
├── 已采用交付物
└── 下载入口
```

`ApprovedDeliverable` 是对外可交付对象；`VideoJob` 不是。

封面和发布文案属于交付元数据，增加以下原子任务：

| ID | 原子任务 | 完成定义 | 依赖 |
|---|---|---|---|
| DEL-07 | 生成交付元数据 | 每个采用版本有封面候选、标题、平台发布文案和 CTA 草案 | EXP-08 |
| DEL-08 | 允许编辑发布文案 | 用户可在不改变 GenerationRecipe 的前提下修改交付文案 | DEL-07 |

### 6.6 首版套餐边界

默认 SKU Campaign 包定义为：

```text
3 个创意假设
用户选择 1～3 个方向
每个方向 1 条首次候选视频
每个方向有限次数失败重试
规则质检后的可审批结果
Campaign 级审批、版本记录和下载
```

产品承诺是：

```text
一批经过生成与质检、可供品牌审批的创意候选结果
```

产品不承诺：

```text
输入一个 SKU
→ 必定获得三条完美成片
```

模型失败、商品变形和素材不适配必须以透明失败、可重试、额度退款处理。
