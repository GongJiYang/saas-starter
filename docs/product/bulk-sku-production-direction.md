# 高频多 SKU 广告生产新方向汇总

状态：产品方向提案；批量实现必须在单 SKU 完整广告垂直切片通过后启动。

优先级：在 `GATE-08` 通过前，`market-validation-mvp.md` 的单 SKU 垂直切片优先；通过后，本文件取代旧文档中“批量生成继续延后”和固定 `pain / benefit / scene` 的示例，但不改变已经记录的 Phase 0 历史证据。

关联文档：

- `docs/product/market-validation-mvp.md`：当前单 SKU 产品合同与质量门；
- `docs/product/reddit-product-research.md`：高 SKU、画布、商品一致性和 Hook 调研；
- `docs/product/bulk-sku-production-atomic-tasks.md`：本方向的原子化实施任务。

## 1. 决策摘要

| 问题 | 决策 |
|---|---|
| 用户对大部分生成结果不满意怎么办 | 不整批盲目重生成；暂停未调度任务，区分技术失败、商品错误、规格偏离和主观改稿，修改批次 Creative Spec 后只做小样复验 |
| 如何在生成前规避 | CSV 校验、SKU Readiness、Creative Spec 审批、三个代表 SKU 的 Pilot Gate、分波次生产和最大成本确认 |
| 是否提供参考视频 | 提供可选 `Creative Reference`，默认只提取结构和节奏；不承诺也不宣传“一比一复刻” |
| 能否一比一复刻 | 只能在用户拥有权利时确定性复用时长、镜头分段、字幕区和 CTA 布局；生成画面不能保证像素级相同，也不得复制未授权品牌、人物、脚本、音乐和标志性素材 |
| 大量 SKU 是否需要表格 | 需要；分为持久 SKU Catalog 表和 Production Batch 状态表，CSV 先导入、校验、修复和确认，再进入生成 |
| 是否一次提交全部任务 | 禁止；先 Pilot，再按 Wave 入队，确保错误不会放大到整批 SKU |

## 2. 先解决“不满意”的分类

“大部分不满意”不是一个可执行原因。Review 必须将问题分成以下类别：

| 类型 | 示例 | 系统处理 | 商业处理 |
|---|---|---|---|
| 技术失败 | 文件损坏、超时、无音频、错误比例 | 自动重试失败镜头 | 不计为客户改稿 |
| 商品一致性失败 | 多商品、Logo 变形、颜色或包装错误 | 禁止交付，修正配方后重生成对应镜头 | 不计为客户改稿 |
| 已批准规格偏离 | 没按批准 Angle、Hook、节奏或参考结构执行 | 生成新的 `CreativeSpecVersion` 并做校正版本 | 包含一次校正 |
| 主观偏好变化 | 已按批准方案完成，但客户后来不喜欢风格 | 保存新偏好，创建新版本 | 作为范围变更，不无限免费重生成 |
| Brief 变化 | 卖点、SKU 图片、CTA、目标平台发生变化 | 创建新 Brief / Spec 版本 | 新生产范围 |

禁止使用“再生成一次看看”作为默认补救。每次重生成必须绑定一个结构化原因和一个被修改的输入字段。

## 3. 生成前风险控制

### 3.1 SKU Readiness Gate

每一行 SKU 必须在生成前达到 `ready`：

```text
SKU 唯一标识有效
商品名称、型号、规格完整
主图可读取且有授权
批准卖点有依据
禁止表达已填写
必须展示和不可改变元素已填写
目标人群、平台、目标和时长有效
Brand Kit 可解析
参考视频权利声明有效（如有）
```

缺失资料的行保持 `needs_input`，不得创建 Campaign 或 VideoJob。

Readiness 不是模糊 AI 分数。V1 使用可解释的规则清单，并逐项显示缺失原因。

### 3.2 Creative Spec Gate

在产生昂贵视频任务前，系统先生成低成本、可审批的 `Creative Spec`：

```text
选定 Creative Angle
三个 Hook Variant 文案与首镜头说明
共享主体 Shot List
批准卖点与证据绑定
视觉处理、节奏和字幕方案
必须展示 / 不可改变 / 禁止元素
参考视频中允许借用的结构属性
参考视频中明确排除的内容
预计镜头数、耗时和最大模型成本
```

用户审批的是上述计划，不是 Prompt。未经审批的 Spec 不得入队。

### 3.3 Pilot Gate

批量生产不能从 0 直接放大到全部 SKU：

```text
创建 Production Batch
→ 系统按商品类别、素材风险和视觉难度选择最多 3 个代表 SKU
→ 为 Pilot SKU 生成完整广告包
→ 用户审批
→ 至少 2 个 Pilot SKU 各有 1 条广告被采用
→ 且不存在未解决的商品一致性错误
→ 才允许生产剩余 SKU
```

若批次少于 3 个 SKU，则沿用单 SKU Campaign 流程，不进入批量模式。

### 3.4 Wave Stop-Loss

Pilot 通过后，剩余 SKU 默认每波 10 个，上一波完成系统质检后再调度下一波。

满足任一条件时自动暂停未调度任务：

```text
同一 Wave 中两个不同 SKU 出现商品一致性失败
至少 5 个结果已有人工结论，且 40% 以上因同一批次级原因被拒绝
供应商错误率或平均成本超过批次确认上限
```

暂停只阻止新任务入队；已提交给供应商的任务继续归档，避免状态和账目失真。

## 4. 大部分结果不满意时的恢复流程

```text
暂停未调度 Wave
→ 汇总结构化拒绝原因
→ 区分行级问题和批次级问题
→ 保留已采用结果
→ 修改 Batch Creative Spec
→ 创建新 Spec 版本
→ 选择 2～3 个被拒 SKU 做 Canary 复验
→ Canary 通过后恢复剩余行
```

禁止：

```text
删除旧版本
覆盖已批准 Brief
整批无差别重新生成
将一次主观拒绝自动写成永久品牌规则
```

品牌偏好只能在用户明确点击“保存为 Brand Preference”后进入后续 Campaign。

## 5. 参考视频能力

### 5.1 产品名称

客户界面使用：

```text
参考视频
参考结构
复用我的自有模板
```

不得使用：

```text
一比一复刻竞品
像素级克隆
保证完全一致
```

### 5.2 三种模式

| 模式 | 输入权利 | 允许行为 |
|---|---|---|
| 无参考 | 无 | 根据 SKU、Brand Kit 和平台规则生成 |
| 结构参考 | 自有、已授权或仅作灵感 | 提取镜头数、时长、节奏、构图、字幕区、转场和 CTA 位置，不复制身份性内容 |
| 自有模板复用 | 用户声明拥有或获授权 | 确定性复用时间轴、版式、字幕和 CTA 结构；商品镜头仍重新生成或合成 |

### 5.3 可以提取的属性

```text
总时长和比例
Hook 时长
镜头边界和镜头数量
景别、构图和相机运动类别
节奏和转场位置
字幕安全区和文字节奏
音乐节拍点（不复制原音频）
CTA 和品牌尾卡位置
```

### 5.4 默认排除的内容

```text
第三方 Logo、商标和包装
可识别人物或声音
原脚本和逐字文案
原音乐和音效
水印
标志性角色、布景和受保护素材
```

用户必须声明 `owned`、`licensed` 或 `inspiration_only`。`inspiration_only` 模式只保存抽象结构，不把原音频、画面或文字带入 GenerationRecipe。

MiniMax 的 `reference_video` 参数不是默认实现。只有在自有素材基准测试证明成本、连续性和商品准确率优于结构提取后，才允许进入生产路径。

## 6. CSV 与双表工作台

### 6.1 两张表，不是一张万能表

#### SKU Catalog

持久保存可复用的商品资料：

```text
SKU
缩略图
商品名 / 类别
资料完整度
Brand Kit
批准卖点
主图和细节图
参考视频
最后更新时间
可生产状态
```

#### Production Batch

保存一次批量广告生产的执行状态：

```text
选择框
SKU 和缩略图
Creative Spec 状态
Selected Angle
参考模式
Pilot / Wave
Campaign 状态
生成进度
系统质检
人工审批
预计 / 实际成本
结果和失败原因
操作
```

Catalog 解决资料复用；Production Batch 解决一次生产。不能把长期商品资料和一次生成状态混在同一实体中。

### 6.2 CSV 工作流

```text
下载当前 Workspace 的 CSV 模板
→ 上传 CSV
→ 只解析和校验，不生成
→ 显示逐行错误与重复 SKU
→ 用户修复或排除错误行
→ 提交到 SKU Catalog
→ 选择 ready 行创建 Production Batch
→ 审批 Batch 默认值和逐行覆盖
→ 审批 Creative Spec
→ Pilot
→ Wave 生产
```

CSV 导入必须幂等。相同 Workspace、文件哈希和导入 key 不得重复创建 SKU。

### 6.3 CSV V1 字段

必填：

```text
external_sku
product_name
category
primary_image_url
approved_claim_1
approved_claim_source_1
prohibited_claim_1
must_show_1
immutable_element_1
target_audience
campaign_goal
platform
duration_seconds
brand_kit_id
cta
```

可选：

```text
product_page_url
detail_image_url_1 ... detail_image_url_9
approved_claim_2 ... approved_claim_5
approved_claim_source_2 ... approved_claim_source_5
prohibited_claim_2 ... prohibited_claim_5
must_show_2 ... must_show_5
immutable_element_2 ... immutable_element_5
reference_video_url
reference_rights
reference_mode
notes
```

列表使用展开列，不在 CSV 单元格中发明自定义分隔协议，保证 Excel 和常见表格工具可编辑。

### 6.4 表格交互

V1 使用服务端分页和普通表格，不引入复杂 Data Grid 或画布：

```text
每页 50 行
按状态、Batch、Brand Kit、类别和错误类型筛选
行详情抽屉修改资料
批量设置 Brand Kit / 平台 / 目标 / 时长
批量排除或加入 Production Batch
批量批准 Spec
暂停或恢复未调度任务
导出当前状态和结果 URL
```

CSV 中的外部 URL 必须经过 HTTPS、私网地址拦截、MIME、大小、重定向次数和授权校验，不能由 Web 请求直接任意抓取。

## 7. 建议领域对象

```text
CatalogItem
CatalogItemAsset
ImportBatch
ImportRow
CreativeReference
ReferenceAnalysis
ProductionBatch
ProductionBatchItem
CreativeSpec
CreativeSpecVersion
Campaign
AdPlan
ShotPlan
ShotVersion
VideoJob
AdVersion
QualityAssessment
Review
```

关系：

```text
ImportBatch → ImportRow → CatalogItem
ProductionBatch → ProductionBatchItem → CatalogItem
ProductionBatchItem → Campaign
Campaign → CreativeSpecVersion → AdPlan
CreativeReference → ReferenceAnalysis → CreativeSpecVersion
AdPlan → ShotPlan → ShotVersion → VideoJob
Campaign → AdVersion → QualityAssessment → Review
```

批量层只负责选择、默认值、Pilot、Wave、暂停和汇总。每个 SKU 仍然拥有独立 Campaign、配方、任务、质检和审批记录，避免一个失败污染整批事务。

## 8. 状态边界

```text
ImportBatch:
uploaded → validating → needs_fix | ready → committed | failed

CatalogItem:
needs_input → ready | archived

CreativeSpecVersion:
draft → awaiting_approval → approved | rejected | superseded

ProductionBatch:
draft → calibrating → pilot_review → ready → producing
      → paused → producing
      → reviewing → completed | cancelled
```

VideoJob、ShotVersion 和 Review 继续使用各自状态，不将所有状态塞入一个 Batch 枚举。

## 9. 批量 V1 不做

```text
从任意电商平台自动同步全部商品
一比一克隆竞品广告
自动学习所有拒绝并永久修改品牌风格
未经 Pilot 就一次入队全部 SKU
复杂时间轴和逐帧画布
无限免费主观改稿
多个视频供应商自动路由
广告平台自动投放
```

首版先支持 CSV、一个对象存储、一个视频供应商、一个平台导出规格和一个可验证的批量闭环。

## 10. 成功标准

产品成功不以“生成了多少条”衡量，而以可用结果和避免浪费衡量：

```text
CSV 100 行可以解析，错误精确定位到行和列
错误行不会创建 Campaign 或 VideoJob
未经批准的 Creative Spec 不会入队
未经 Pilot 通过的 Production Batch 不会释放剩余 SKU
自动暂停不会丢失已提交任务的状态和成本
商品一致性失败不会进入客户交付
每次重生成都有原因、Spec 版本和成本记录
至少 80% ready SKU 获得一条被采用的 AdVersion
批次级主观拒绝率低于 20%
用户处理单个 ready SKU 的平均人工时间低于 2 分钟
```

`80%` 和 `20%` 是需要真实客户验证的首轮门槛，不是已经证明的市场基准。

## 11. 实施前置门

批量能力会放大单 SKU 的每个错误。因此实施顺序必须是：

```text
单 SKU 30 秒完整广告垂直切片通过
→ 真实客户确认 Creative Spec 可理解
→ 三个真实 SKU Pilot 通过
→ 再实现 CSV Catalog 和 Production Batch
```

在上述门槛通过前，CSV 可以用于内部资料整理，但不得直接触发付费批量生成。
