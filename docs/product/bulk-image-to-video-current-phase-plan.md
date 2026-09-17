# 当前阶段：百图批量转视频实施计划

状态：下一阶段实施计划。

关联文档：

- `docs/product/customer-workflow-optimization-atomic-tasks.md`：现有 SKU Single / Bulk、Pilot、Wave、QA、Review 与安全基线；
- `docs/product/skill-driven-media-production-vision.md`：跨垂类长期产品愿景；
- `docs/product/google-flow-inspired-workspace-atomic-tasks.md`：创作工作区 UI/UX 原子任务。

## 0. 本阶段唯一核心结果

> 用户一次上传上百张图片后，可以用一个共享 Prompt 批量生成视频；任意图片默认复用共享 Prompt，也可以切换为独立 Prompt；用户只处理失败项和需要修改的结果，不再逐张创建 Campaign、复制 Prompt、等待和下载。

必须形成以下真实闭环：

```text
新建 Image-to-Video Batch
→ 拖入 100+ 图片
→ 浏览器直传对象存储
→ 图片按稳定顺序进入生产网格
→ 设置一个 Shared Prompt
→ 可为任意图片选择 Inherit 或 Override
→ 预检模型、时长、画幅、素材与成本
→ Pilot 生成 3 个代表性样本
→ Review Pilot
→ 批量排队其余图片
→ 实时查看 Pending / Running / Succeeded / Failed
→ 只重试失败项或修改单项 Prompt 后重生
→ 批量 Review
→ 下载采用视频与 manifest
```

本阶段不是纪录片编辑器，也不是通用工作流引擎。只解决“上百张已有图片如何高效变成上百个视频”的核心生产问题。

## 1. 第一性原理

### 1.1 用户购买的是完成吞吐量，不是功能数量

客户真正衡量的是：

```text
100 张图片进入
→ 多少人工操作
→ 多久发现错误
→ 浪费多少次生成
→ 最终得到多少个可用视频
```

因此本阶段优先级必须是：

1. 减少重复输入；
2. 把等待变成后台队列；
3. 先小样验证，再批量放量；
4. 失败只影响单项，不阻塞整批；
5. 任何产物都能追溯到输入图、有效 Prompt、模型参数和生成版本。

### 1.2 共享规则与单项差异必须分开

一百张图片的公共动画意图只保存一次：

```text
Shared Prompt v1
```

每个图片项只保存自己的选择：

```text
promptMode = inherit | override
promptOverride = null | 完整独立 Prompt
```

有效 Prompt 的规则必须唯一、可解释：

```text
inherit  → effectivePrompt = Shared Prompt

override → effectivePrompt = promptOverride
```

不采用隐式字符串拼接。用户无法可靠判断“公共 Prompt + 局部补丁”最终会变成什么；完整覆盖更适合审计、复现和重试。

### 1.3 编辑配置不能偷偷改变已提交任务

每次提交 VideoJob 时冻结：

- 输入 Asset ID 与对象存储键；
- Shared Prompt 版本；
- Prompt 模式；
- Effective Prompt；
- 模型、时长、画幅和分辨率；
- Skill 版本和 definition hash；
- Recipe hash；
- 提交人和提交时间。

修改 Shared Prompt 后：

- 尚未提交且使用 `inherit` 的项使用新版本；
- 使用 `override` 的项不受影响；
- 已提交或已成功的 Job 保持原 Recipe；
- 用户明确选择“使用新 Prompt 重新生成”才创建新 Job；
- UI 必须标记旧结果与当前配置不同，而不是覆盖历史。

### 1.4 图片不是首帧，除非供应商合同明确如此

本阶段输入语义为 `reference_image`：

```text
参考图片 + Prompt → Video
```

不是：

```text
first frame + last frame → interpolation
```

代码、接口和 UI 统一使用 `referenceImage` / `inputImage`，清理误导性的 `firstFrameUrl` 命名与错误文案。供应商适配器负责把中立语义映射到对应 API role。

### 1.5 批量不等于同时轰炸供应商

“Run 100”表示创建一个可观察的批次，不表示同时发起 100 个外部请求。

继续复用：

- BullMQ；
- Workspace 并发上限；
- Retry / backoff；
- Pilot；
- Wave；
- Stop-loss；
- 成本确认；
- Review 和活动日志。

## 2. SKU 电商垂类与跨垂类判断

### 2.1 产品入口继续聚焦 SKU 电商

当前商业定位不改变：

- 首页、销售文案和默认向导继续服务电商团队；
- Catalog、SKU、Brand Kit、商品事实、禁用表达和商品保真继续是主流程；
- 电商批量生产继续要求商品身份、包装、Logo、颜色和卖点约束；
- 不为了潜在纪录片客户弱化电商专用 QA。

### 2.2 底层生产原理确实跨垂类相同

不同垂类共享的稳定内核是：

```text
Input Asset
+ Shared Skill / Prompt
+ Per-item Override
+ Frozen Recipe
→ Async Job
→ Output Asset
→ QA
→ Review
→ Adopt / Reject / Retry
```

变化的是上游上下文和 QA：

| 垂类 | Item 代表什么 | 公共规则 | 单项差异 | QA 重点 |
|---|---|---|---|---|
| SKU 电商 | 一个商品素材 | 品牌动画规则 | 单 SKU 卖点/场景 | 商品、包装、Logo、Claim 保真 |
| 纪录片拼贴 | 一个 Visual Beat | 纸张拼贴 Motion Skill | 当前 Beat 画面 | 构图、时间码、风格连续性 |
| 房地产 | 一张房源图 | 镜头移动模板 | 房间类型 | 空间结构与装潢不变形 |
| 时尚 | 一张 Look 图 | 走秀或材质动态 | 单品重点 | 人物、服装和材质保真 |

因此正确方向不是把所有垂类都塞入 SKU，也不是立即建设万能 Workflow Engine，而是：

> 保留电商业务壳，提炼可复用的“媒体批次执行内核”，让 SKU 和未来 Visual Beat 都能调用同一套队列、Recipe、Job、资产、成本和 Review 能力。

### 2.3 本阶段的建模决策

扩展现有 Production Batch，不另建一套重复队列：

```text
ProductionBatch
  sourceMode: catalog | uploaded_images
  sharedPrompt
  sharedPromptVersion
  generationMode: single | bulk

ProductionBatchItem
  catalogItemId?      // catalog 模式必填
  inputAssetId?       // uploaded_images 模式必填
  sequence
  promptMode          // inherit | override
  promptOverride?

VideoJob
  productionBatchItemId
  inputAssetId
  campaignId?         // SKU 路径保留
  shotCardId?         // SKU 路径保留
  recipeSnapshot
```

服务层合同：

- `catalog` 项必须关联当前 Workspace CatalogItem；
- `uploaded_images` 项必须关联当前 Workspace 图片 Asset；
- 一项不能同时以 CatalogItem 和上传图片作为主输入；
- Uploaded-images 路径不创建伪 SKU、伪 Campaign 或三个无意义 ShotCard；
- SKU 路径行为和现有历史数据保持不变；
- VideoJob 执行器只消费冻结 Recipe，不关心上游是 SKU 还是 Visual Beat。

这是一条受控扩展，不是大规模重写。

## 3. 产品合同

### 3.1 上传合同

- 支持一次选择或拖入至少 100 张图片；
- 支持 JPEG、PNG、WebP，具体 MIME 与大小限制在选择文件时显示；
- 浏览器使用短期签名 URL 直传 COS，不经过 Next.js Server 中转文件体；
- 客户端上传并发有固定上限，默认 4；
- 每个文件有稳定 `clientFileId`，不能只用文件名标识；
- 同名文件不得互相覆盖；
- 页面刷新后可从服务端恢复上传清单与状态；
- 单项失败可重试，不重新上传已完成项；
- 只有归档成功的 Asset 才能进入生成队列；
- 删除未提交项时清理对应未引用上传记录；
- 离开页面不能导致已上传 Asset 失联。

### 3.2 Prompt 合同

- Batch 必须有非空 Shared Prompt 才能预检；
- 新上传项默认 `inherit`；
- 单项可切换为 `override` 并编辑完整 Prompt；
- Override 为空时不能提交；
- 单项可“恢复共享 Prompt”，删除 Override；
- 批量多选可统一设为 inherit；
- 批量多选可从模板设置相同 override，但必须二次确认；
- 卡片显示 `Shared` 或 `Custom`，用户无需打开详情即可识别；
- 提交前显示 Effective Prompt 预览；
- Shared Prompt 变更后显示受影响项数和 stale 结果数。

### 3.3 队列合同

单项状态：

```text
uploading
ready
queued
generating
quality_review
succeeded
failed
adopted
rejected
excluded
```

批次统计至少显示：

```text
Total
Uploading
Ready
Queued
Running
Succeeded
Failed
Adopted
Estimated cost
Actual cost
```

队列操作：

- Run Pilot；
- Run ready items；
- Pause scheduling；
- Resume scheduling；
- Cancel pending；
- Retry failed；
- Retry selected；
- Regenerate selected with current Prompt；
- Exclude selected；
- Download adopted；
- Export manifest。

暂停只停止新任务调度，不伪装成供应商已经取消正在运行的外部任务。

### 3.4 Pilot 与放量合同

- 100 张以上默认选择 3 个 Pilot；
- Pilot 应覆盖简单、中等和复杂画面，而不是只取前三张；
- 用户可以替换系统建议的 Pilot；
- Pilot 采用数低于门槛时不得一键放量；
- 允许用户修改 Shared Prompt 后只重跑 Pilot；
- Pilot 通过后，剩余项按 Wave 和 Workspace 并发限制调度；
- Supplier error、成本漂移和集中 QA 失败继续触发 Stop-loss。

## 4. 原子实施任务

### A. 数据合同

| ID | 原子任务 | 可验证完成结果 | 前置 |
|---|---|---|---|
| IMGVID-DATA-01 | 为 ProductionBatch 增加 `sourceMode` | 新 Batch 明确为 `catalog` 或 `uploaded_images`，历史记录回填 `catalog` | 无 |
| IMGVID-DATA-02 | 增加 Shared Prompt 与版本字段 | Batch 可保存非空共享 Prompt，修改时版本单调递增 | DATA-01 |
| IMGVID-DATA-03 | 为 BatchItem 增加 `inputAssetId` | Uploaded-images 项可关联当前 Workspace 图片 Asset | DATA-01 |
| IMGVID-DATA-04 | 为 BatchItem 增加稳定顺序 | 重载页面和重试后顺序不变化 | DATA-03 |
| IMGVID-DATA-05 | 增加 Prompt 继承模式 | 每项只能是 `inherit` 或 `override` | DATA-02 |
| IMGVID-DATA-06 | 增加 Prompt Override | 仅 override 项允许保存非空独立 Prompt | DATA-05 |
| IMGVID-DATA-07 | VideoJob 关联 BatchItem 与输入 Asset | Job 可从 BatchItem 追溯到输入图 | DATA-03 |
| IMGVID-DATA-08 | 放宽 SKU 专属 Job 外键并增加形状约束 | SKU Job 与图片 Job 各自满足唯一合法字段组合 | DATA-07 |
| IMGVID-DATA-09 | 回填现有 SKU Job 关联 | 现有 Job 行为、Recipe 与下载不变 | DATA-08 |
| IMGVID-DATA-10 | 增加必要唯一索引与 Workspace 复合外键 | 无跨 Workspace Asset / BatchItem / Job 关联 | DATA-03、07 |

### B. 百图上传

| ID | 原子任务 | 可验证完成结果 | 前置 |
|---|---|---|---|
| IMGVID-UP-01 | 新增 Image-to-Video Batch 创建入口 | 用户不经过 Catalog 即可创建空图片批次 | DATA-01 |
| IMGVID-UP-02 | 增加多文件选择和拖放区 | 一次选择 100 张合法图片后生成 100 个本地条目 | UP-01 |
| IMGVID-UP-03 | 选择时验证 MIME 与大小 | 非法文件在上传前显示文件级原因 | UP-02 |
| IMGVID-UP-04 | 为每项生成稳定 clientFileId | 同名图片保持独立且可恢复 | UP-02 |
| IMGVID-UP-05 | 批量申请 Workspace 绑定签名 URL | 每个合法文件获得受限对象键 | UP-03、04 |
| IMGVID-UP-06 | 实现四路浏览器直传调度器 | 100 张图片最多同时上传 4 张 | UP-05 |
| IMGVID-UP-07 | 显示文件级上传进度 | 每项显示等待、上传、归档、失败 | UP-06 |
| IMGVID-UP-08 | 完成上传后归档 Asset | 只有真实存在的 COS 对象产生 Asset | UP-06 |
| IMGVID-UP-09 | 上传成功后创建 BatchItem | Asset 与 BatchItem 一一绑定并保持选择顺序 | UP-08、DATA-03 |
| IMGVID-UP-10 | 实现失败项重试 | 重试不重复创建已归档 Asset | UP-07、08 |
| IMGVID-UP-11 | 实现页面恢复 | 刷新后服务端返回完整上传和归档状态 | UP-09 |
| IMGVID-UP-12 | 实现移除未提交图片 | 删除条目并安全清理无引用临时上传 | UP-09 |
| IMGVID-UP-13 | 增加 ZIP/文件夹上传的后续入口提示 | 首版能力边界清楚，不伪装已经支持目录同步 | UP-02 |

### C. Shared Prompt 与单项修改

| ID | 原子任务 | 可验证完成结果 | 前置 |
|---|---|---|---|
| IMGVID-PRM-01 | 增加 Shared Prompt 编辑器 | Batch 保存一个公共 Prompt | DATA-02 |
| IMGVID-PRM-02 | 新 Item 默认继承 Shared Prompt | 100 个新 Item 无需复制 Prompt | PRM-01、UP-09 |
| IMGVID-PRM-03 | 实现 Effective Prompt 解析函数 | 相同输入总是得到相同 Effective Prompt 与 hash | DATA-05、06 |
| IMGVID-PRM-04 | 增加 Item Prompt 模式切换 | 卡片可从 Shared 切换 Custom | PRM-03 |
| IMGVID-PRM-05 | 增加单项完整 Prompt 编辑器 | 保存后只有该 Item 使用独立 Prompt | PRM-04 |
| IMGVID-PRM-06 | 增加恢复 Shared Prompt 操作 | Override 被删除并重新继承当前版本 | PRM-05 |
| IMGVID-PRM-07 | 显示 Shared / Custom 标识 | 网格无需展开即可区分模式 | PRM-04 |
| IMGVID-PRM-08 | Shared Prompt 更新显示影响范围 | 确认框显示 inherited、custom、已有结果数量 | PRM-03 |
| IMGVID-PRM-09 | 标记 Prompt 配置已变化的旧结果 | 历史结果不覆盖，卡片显示 stale | PRM-08 |
| IMGVID-PRM-10 | 增加多选恢复 Shared | 选中项批量清除 Override | PRM-06 |
| IMGVID-PRM-11 | 增加提交前 Effective Prompt 预览 | 用户看到实际送往供应商的文本 | PRM-03 |

### D. 中立 Recipe 与供应商映射

| ID | 原子任务 | 可验证完成结果 | 前置 |
|---|---|---|---|
| IMGVID-RCP-01 | 定义 Uploaded-image Recipe 输入 | Recipe 包含输入 Asset、Effective Prompt、模型输出约束 | PRM-03、DATA-07 |
| IMGVID-RCP-02 | 冻结 Shared Prompt 版本和 Effective Prompt | Job 提交后修改 Batch 不改变 Recipe | RCP-01 |
| IMGVID-RCP-03 | 将 `firstFrameUrl` 重命名为 `referenceImageUrl` | 中立层与 UI 不再宣称首帧 | RCP-01 |
| IMGVID-RCP-04 | MiniMax 映射继续使用 `reference_image` | 请求无 last frame，图片 role 为 reference_image | RCP-03 |
| IMGVID-RCP-05 | 统一 SKU 与上传图的 Worker 输入 | Worker 只消费 Frozen Recipe 与签名素材 URL | RCP-02、04 |
| IMGVID-RCP-06 | Recipe hash 排除临时签名 URL | URL 轮换不改变可复现配方 | RCP-05 |
| IMGVID-RCP-07 | 重试复用原 Recipe | 普通重试不吸收后续 Prompt 修改 | RCP-02 |
| IMGVID-RCP-08 | 重新生成创建新 Recipe | 用户明确选择当前 Prompt 时生成新 Job | RCP-07 |

### E. 批量调度与成本

| ID | 原子任务 | 可验证完成结果 | 前置 |
|---|---|---|---|
| IMGVID-RUN-01 | 增加图片批次 Eligibility 预检 | 在排队前发现模型、时长、画幅和素材阻塞 | RCP-01 |
| IMGVID-RUN-02 | 建议三个代表性 Pilot | Pilot 覆盖不同图片复杂度 | RUN-01 |
| IMGVID-RUN-03 | 允许用户替换 Pilot | 用户可在预检后确认最终 Pilot | RUN-02 |
| IMGVID-RUN-04 | 估算 Pilot 与全批成本 | UI 分开显示小样成本和最大批次成本 | RUN-01 |
| IMGVID-RUN-05 | Pilot 提交前确认成本 | 未确认不能创建 Job | RUN-04 |
| IMGVID-RUN-06 | 批量创建 Pilot VideoJob | 每个 Pilot 冻结独立 Recipe | RUN-03、RCP-02 |
| IMGVID-RUN-07 | 复用 BullMQ 提交与轮询 | Pilot 进入真实 MiniMax 队列并回写状态 | RUN-06 |
| IMGVID-RUN-08 | Pilot Review Gate 控制放量 | 未达到 adopted 门槛不能运行全批 | RUN-07 |
| IMGVID-RUN-09 | 为其余 Ready 项分配 Wave | 100 项按 waveSize 稳定分组 | RUN-08 |
| IMGVID-RUN-10 | 调度遵守 Workspace 并发上限 | Run 100 不会同时调用 100 次供应商 | RUN-09 |
| IMGVID-RUN-11 | 增加 Pause / Resume scheduling | 暂停后不再取新项，运行中任务继续被观察 | RUN-10 |
| IMGVID-RUN-12 | 增加失败项批量重试 | 只为 failed 项创建重试 Job | RUN-10 |
| IMGVID-RUN-13 | 增加选中项按当前 Prompt 重生 | 新 Job 使用当前 Effective Prompt | RCP-08、RUN-10 |
| IMGVID-RUN-14 | 复用 Stop-loss | 错误率、成本漂移和集中失败可自动暂停 | RUN-10 |
| IMGVID-RUN-15 | 全部终态后收敛 Batch | adopted/rejected/excluded 完成后进入 completed | RUN-12、14 |

### F. Review、下载与可观察性

| ID | 原子任务 | 可验证完成结果 | 前置 |
|---|---|---|---|
| IMGVID-REV-01 | 增加图片/视频并列媒体卡 | 一张卡同时显示输入图与最新视频 | RUN-07 |
| IMGVID-REV-02 | 增加 adopted / rejected | Review 保存人、时间和原因 | REV-01 |
| IMGVID-REV-03 | 增加多选 adopted | 用户可一次采用多个已通过结果 | REV-02 |
| IMGVID-REV-04 | 失败卡直接显示真实原因 | 不进入 Job 详情也能判断重试方式 | RUN-07 |
| IMGVID-REV-05 | 增加 Retry failed 快捷操作 | 一次重试当前筛选中的失败项 | RUN-12、REV-04 |
| IMGVID-REV-06 | 增加采用视频批量下载 | 只打包当前 Workspace adopted 输出 | REV-02 |
| IMGVID-REV-07 | 导出 manifest | 每行含 sequence、input、promptMode、recipeHash、job、output、review | REV-02 |
| IMGVID-REV-08 | 增加批次实时统计 | 统计与数据库状态一致 | RUN-10 |
| IMGVID-REV-09 | 增加活动日志 | 上传完成、Prompt 变更、提交、暂停、重试、Review、导出可审计 | REV-02 |
| IMGVID-REV-10 | 增加高级诊断折叠区 | 内部 ID 只在诊断区展示 | REV-08 |

### G. 权限、安全与清理

| ID | 原子任务 | 可验证完成结果 | 前置 |
|---|---|---|---|
| IMGVID-SEC-01 | 所有图片批次查询绑定 teamId | 跨 Workspace Batch 返回 404 | DATA-10 |
| IMGVID-SEC-02 | 所有 Asset 绑定校验 teamId | 不能引用其他 Workspace 图片 | DATA-10 |
| IMGVID-SEC-03 | Prompt 更新校验 Batch 所有权 | Member 只能在当前 Workspace 操作 | PRM-01 |
| IMGVID-SEC-04 | 下载只签名授权对象键 | manifest 不包含长期公开 URL | REV-06、07 |
| IMGVID-SEC-05 | 上传失败清理临时记录 | 无对象的 upload 不产生 Asset | UP-08 |
| IMGVID-SEC-06 | Batch 删除清理无引用临时 Asset | 已被其他实体引用的 Asset 不误删 | UP-12 |
| IMGVID-SEC-07 | Queue payload 不包含供应商密钥 | 浏览器和 Redis 均不出现 API Key | RUN-07 |
| IMGVID-SEC-08 | Prompt 与文件名安全输出 | CSV/manifest 防公式注入和路径穿越 | REV-07 |

## 5. 本阶段页面

```text
/dashboard/batches
  + Create image-to-video batch

/dashboard/batches/[batchId]
  Header: status / totals / cost / pause
  Shared Prompt bar
  Filters and bulk actions
  Media Grid
  Queue drawer
  Inspector
  Review / Delivery
```

SKU Single / Bulk 入口继续存在。创建任务第一步明确选择：

```text
SKU production
Image-to-video batch
```

不要用含糊的 `generic` 或 `custom` 命名。

## 6. 明确不做

```text
Narration 自动生成
Visual Beat 自动拆分
Voiceover
Thumbnail
完整时间线编辑器
视频自动拼接
Google Flow 浏览器自动化
在服务器中模拟点击 Google Flow
第二视频供应商
公开模板市场
自由节点工作流
每个 Item 自动生成三个视频候选
```

可以支持 ZAPI FLOW 的编号文件导入，但不得把插件 DOM 自动化作为平台核心依赖。

## 7. 验收标准

### ACPT-IMGVID-01：百图上传

- 在真实浏览器一次选择至少 100 张测试图片；
- 上传并发不超过配置；
- 所有成功项归档为 Workspace Asset；
- 页面刷新后数量、顺序和状态一致；
- 单个失败项重试不重复上传其余图片。

### ACPT-IMGVID-02：共享 Prompt

- 100 项默认使用一个 Shared Prompt；
- Recipe 中有效 Prompt 与 Shared Prompt 一致；
- UI 不要求复制 100 次文本。

### ACPT-IMGVID-03：单项 Prompt

- 第 17 项切换 Custom 并保存独立 Prompt；
- 第 17 项 Recipe 使用独立 Prompt；
- 其他 99 项继续继承 Shared Prompt；
- 恢复 Shared 后 Override 被删除。

### ACPT-IMGVID-04：无首尾帧语义

- MiniMax 请求只包含一张 `reference_image`；
- 不包含 last frame；
- UI、日志和错误文案不称其为 first frame。

### ACPT-IMGVID-05：Pilot 与批量放量

- 三个 Pilot 真实生成并完成 Review；
- 未通过时全批按钮不可用；
- 通过后其余项按 Wave 和并发上限运行。

### ACPT-IMGVID-06：失败恢复

- 人为制造一个可重试失败；
- Retry failed 只创建对应重试 Job；
- 已成功项不重复生成；
- 原 Recipe 与重试 Recipe 可追溯。

### ACPT-IMGVID-07：交付

- 批量采用多个输出；
- 下载包只包含 adopted 视频；
- manifest 可追溯 sequence、input Asset、Effective Prompt hash、Job 与 Review；
- 不泄漏裸 COS 长期 URL 或其他 Workspace 数据。

## 8. 完成定义

本阶段只有在以下客户路径真实通过后完成：

```text
上传 100+ 图片
→ 设置一次 Shared Prompt
→ 修改至少一个单项 Prompt
→ Pilot
→ 批量视频队列
→ 失败项重试
→ 批量 Review
→ adopted 下载与 manifest
```

TypeScript、生产构建和局部合同检查通过但客户路径未跑通，不算完成。
