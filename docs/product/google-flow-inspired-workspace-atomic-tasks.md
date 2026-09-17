# Google Flow 启发的创作工作区 UI/UX 原子任务计划

状态：设计与实施计划。目标是吸收 Google Flow 的媒体优先、上下文连续和生成循环逻辑，不做像素级仿制，不复制其品牌资产。

关联文档：

- `docs/product/bulk-image-to-video-current-phase-plan.md`：当前百图批量转视频业务合同；
- `docs/product/skill-driven-media-production-vision.md`：长期 Skill 驱动媒体生产愿景；
- `docs/product/customer-workflow-optimization-atomic-tasks.md`：现有引导式 Batch 工作台和状态机基线。

## 0. 核心体验目标

> 用户进入一个 Production Batch 后，图片和视频是主角；Shared Prompt、单项修改、批量队列、失败恢复和 Review 在同一个连续工作区完成，不需要在 Batch、Campaign、Spec、Job、Review 页面之间往返。

本阶段必须支持：

```text
100+ 图片媒体网格
+ 一个持久 Shared Prompt
+ 单项 Prompt Inspector
+ 多选批量操作
+ 实时 Queue 状态
+ 图片/视频并列 Review
+ adopted 批量导出
```

## 1. 第一性原理

### 1.1 UI 的任务是降低生产状态的不确定性

用户在批量生成时反复问五个问题：

1. 我现在处于哪一步？
2. 哪些 Item 可以运行，哪些被阻塞？
3. 系统实际会使用什么 Prompt 和素材？
4. 哪些任务正在运行、失败或完成？
5. 我现在最应该做什么？

每个主要界面必须能回答这些问题。不能依赖用户理解内部状态机、数据库 ID 或后台日志。

### 1.2 媒体对象优先于数据库对象

普通用户首先看到：

- 输入图片；
- 生成视频；
- Prompt 来源；
- 任务状态；
- Review 决策。

以下内容默认隐藏在 Advanced Diagnostics：

- Batch ID；
- Campaign ID；
- Spec Version ID；
- Job ID；
- Asset ID；
- Recipe hash；
- BullMQ job name。

### 1.3 批量操作是一等交互，不是重复单项操作

100 个 Item 不能要求 100 次相同点击。任何高频单项操作都必须审视是否需要：

- 全选；
- 当前筛选全选；
- 多选；
- 批量执行；
- 批量撤销；
- 批量确认影响范围。

### 1.4 Shared 与 Override 必须肉眼可辨

用户不应该打开 100 个 Prompt 编辑器确认差异。

每张卡始终显示：

```text
Shared
Custom
Stale
```

Inspector 始终显示 Effective Prompt，而不只显示数据库中的 override 字段。

### 1.5 等待必须转化为可离开的后台状态

点击 Run 后：

- 立即显示已接受数量；
- Item 进入 queued；
- 用户可以离开页面；
- 返回后从服务端恢复；
- 不使用只存在于 React 内存中的假进度；
- 不用全屏 Spinner 阻塞其他操作。

### 1.6 当前阶段只突出一个主行动

页面可以有很多状态，但主 CTA 只能有一个：

```text
Upload images
Set shared prompt
Run pilot
Review pilot
Run batch
Review results
Export adopted
```

其他动作属于次级工具栏或 Item Inspector。

### 1.7 风险在执行前可见

在提交昂贵批量任务前，用户必须看到：

- Ready / blocked 数量；
- Shared / Custom 数量；
- Pilot 状态；
- 预计最大成本；
- 当前 Workspace 并发；
- 供应商与输出参数；
- 此操作会创建多少 Job。

## 2. 不做什么

```text
不复制 Google 商标、图标或专有视觉资产
不追求像素级复刻
不把整个 SaaS 管理后台改成深色
不做无限画布
不做节点工作流编辑器
不做完整时间线剪辑器
不为视觉效果隐藏关键队列状态
不在 Canvas 中暴露数据库 ID
不依赖 hover 才能完成核心操作
```

## 3. 双壳信息架构

### 3.1 管理壳保持现有结构

继续使用当前明亮 SaaS Dashboard：

```text
Dashboard
SKU Catalog
Brand Kits
References
Skills
Workspace Settings
Security
Activity Logs
Billing
```

### 3.2 创作壳只用于生产任务

进入 Production Batch 后切换为沉浸式 Workspace：

```text
┌──────────────────────────────────────────────────────────────┐
│ Project Header: Name / Stage / Progress / Cost / Run         │
├──────────┬──────────────────────────────────┬────────────────┤
│ Stage    │ Media Canvas                     │ Inspector      │
│ Rail     │                                  │                │
│          │ Input / Video cards              │ Prompt         │
│ Upload   │ Grid / Review / Queue filters    │ Model          │
│ Prompt   │                                  │ History        │
│ Pilot    │                                  │ Actions        │
│ Generate │                                  │                │
│ Review   │                                  │                │
│ Export   │                                  │                │
├──────────┴──────────────────────────────────┴────────────────┤
│ Shared Prompt / Selection / Queue Action Bar                │
└──────────────────────────────────────────────────────────────┘
```

### 3.3 URL 与恢复

```text
/dashboard/batches/[batchId]?view=media
/dashboard/batches/[batchId]?view=queue
/dashboard/batches/[batchId]?view=review
/dashboard/batches/[batchId]?view=delivery
```

选中 Item 使用 URL 可恢复参数：

```text
&item=<stableItemKey>
```

不把裸数据库 ID 要求用户手工输入；URL 参数只是恢复上下文。

## 4. 视觉方向

### 4.1 色彩

创作壳建议：

- 主背景：近黑或深石墨；
- Canvas 卡片：比背景略亮一层；
- 文本：高对比中性色；
- 品牌动作色：保留现有橙色；
- adopted / completed：绿色；
- blocked / warning：琥珀；
- failed：红色；
- selected：清楚的橙色描边，不只依赖颜色填充。

### 4.2 密度

媒体网格优先展示画面。文字只保留：

```text
sequence
file name / SKU
Shared or Custom
status
latest result
```

成本、尝试次数、Recipe、错误详情进入 Inspector 或展开区。

### 4.3 动效

动效只表达状态：

- 队列进入；
- 上传进度；
- 卡片状态变更；
- Inspector 打开；
- 批量操作完成。

不使用持续发光、背景粒子或无意义循环动画。遵守 `prefers-reduced-motion`。

## 5. 关键组件合同

### 5.1 Project Header

显示：

- Batch 名称；
- sourceMode；
- 当前阶段；
- 已完成/总数；
- 运行中/失败；
- 预计或实际成本；
- 主 CTA；
- Pause / Resume；
- 返回 Production tasks。

Header 在滚动时保持可见，但不占据过多垂直空间。

### 5.2 Stage Rail

阶段：

```text
1 Upload
2 Prompt
3 Pilot
4 Generate
5 Review
6 Export
```

每阶段状态：

```text
locked
available
current
completed
needs_attention
```

点击已完成阶段可查看，不自动执行状态回退。点击 locked 阶段显示缺失条件。

### 5.3 Shared Prompt Bar

持续显示：

- Prompt 名称或首行摘要；
- 当前版本；
- inherited Item 数；
- custom Item 数；
- stale 结果数；
- Edit；
- Preview effective prompt；
- Run 当前合法动作。

编辑 Shared Prompt 时必须先显示影响范围，再保存。

### 5.4 Media Card

每张卡包含：

- 多选 checkbox；
- sequence；
- 输入图片；
- 最新视频或状态占位；
- Shared / Custom；
- queued / running / failed / succeeded / adopted；
- 快捷预览；
- 打开 Inspector。

失败卡必须直接显示一行可读原因和 Retry 入口。

### 5.5 Inspector

选中一项后显示：

```text
Input
Effective Prompt
Prompt mode
Custom Prompt editor
Model output
Latest Job
Attempts
Cost
QA
Review
History
Advanced diagnostics
```

切换 Item 时未保存 Prompt 必须提示，不能静默丢失。

### 5.6 Queue Drawer

显示：

- Active；
- Queued；
- Failed；
- 最近完成；
- Workspace concurrency；
- Pause / Resume scheduling；
- Retry failed；
- 每项可读错误。

Queue Drawer 只映射服务端真实状态，不自己发明任务生命周期。

### 5.7 Review Mode

Review 不是另一个全站页面跳转，而是同一 Canvas 的模式：

- 输入图与视频并列；
- 视频可静音自动循环预览；
- adopted / rejected / needs changes；
- 结构化拒绝原因；
- 多选 adopted；
- 过滤未审、已采用、已拒绝；
- Prompt 和 QA 在 Inspector 中可见。

### 5.8 Delivery Mode

显示：

- adopted 数量；
- 缺少 Review 的数量；
- 批量下载；
- manifest；
- 文件命名规则；
- 输出参数；
- 导出活动记录。

## 6. 原子任务规则

- 一个任务只改变一个可观察行为；
- 视觉 Token、组件、业务绑定和浏览器验收不混在同一任务；
- 先保证信息层级和交互合同，再做视觉润色；
- 所有状态来自服务端合同；
- 所有批量动作显示目标数量；
- destructive 操作显示影响范围；
- 键盘、焦点、屏幕阅读器和缩放不是最后补丁；
- 不以静态截图通过代替真实浏览器交互。

## 7. 原子任务计划

### A. 研究与信息架构

| ID | 原子任务 | 可验证完成结果 | 前置 |
|---|---|---|---|
| FLOWUX-IA-01 | 列出批量生产五个用户问题 | 页面需求逐项映射状态、阻塞、Prompt、队列和下一动作 | 无 |
| FLOWUX-IA-02 | 绘制现有跨页面客户路径 | 标出 Batch、Spec、Jobs、Reviews 间所有跳转 | IA-01 |
| FLOWUX-IA-03 | 定义创作壳与管理壳边界 | 只有 Batch 详情进入沉浸式创作壳 | IA-02 |
| FLOWUX-IA-04 | 定义六阶段 Stage Rail | Upload 至 Export 的解锁条件明确 | IA-03 |
| FLOWUX-IA-05 | 定义 Media / Queue / Review / Delivery 视图 | 每个视图只有一个主要用户目标 | IA-03 |
| FLOWUX-IA-06 | 定义 Item 选择与 URL 恢复合同 | 刷新后恢复 view 和选中 Item | IA-05 |
| FLOWUX-IA-07 | 定义高级诊断边界 | 普通 Canvas 无裸业务 ID | IA-03 |

### B. 设计 Token 与创作壳

| ID | 原子任务 | 可验证完成结果 | 前置 |
|---|---|---|---|
| FLOWUX-SHELL-01 | 增加创作壳颜色 Token | 不在组件内散落硬编码深色值 | IA-03 |
| FLOWUX-SHELL-02 | 增加媒体卡和状态 Token | selected、failed、adopted 在主题中唯一 | SHELL-01 |
| FLOWUX-SHELL-03 | 建立沉浸式 Batch Layout | Batch 详情不受普通 Dashboard 窄内容宽度限制 | IA-03、SHELL-01 |
| FLOWUX-SHELL-04 | 保留返回管理壳入口 | 用户一键回到 Production tasks | SHELL-03 |
| FLOWUX-SHELL-05 | 实现响应式三栏骨架 | 宽屏为 Rail/Canvas/Inspector | SHELL-03 |
| FLOWUX-SHELL-06 | 实现中屏 Inspector Drawer | 中屏不压缩 Canvas 到不可用宽度 | SHELL-05 |
| FLOWUX-SHELL-07 | 实现小屏单列降级 | 小屏可完成 Review 和 Retry，不承诺百图高密编辑 | SHELL-05 |
| FLOWUX-SHELL-08 | 增加 reduced-motion 合同 | 系统减少动效时无持续动画 | SHELL-01 |

### C. Project Header 与 Stage Rail

| ID | 原子任务 | 可验证完成结果 | 前置 |
|---|---|---|---|
| FLOWUX-NAV-01 | 实现紧凑 Project Header | 名称、阶段、进度、成本同屏 | SHELL-03 |
| FLOWUX-NAV-02 | 绑定真实批次统计 | 刷新后 Header 与服务端一致 | NAV-01 |
| FLOWUX-NAV-03 | 计算唯一主 CTA | 每个合法状态只突出一个下一动作 | IA-04、NAV-01 |
| FLOWUX-NAV-04 | 实现 Header Pause / Resume | 文案说明暂停仅停止新调度 | NAV-01 |
| FLOWUX-NAV-05 | 实现 Stage Rail | 六阶段均有可访问名称和状态 | IA-04、SHELL-03 |
| FLOWUX-NAV-06 | 绑定阶段解锁条件 | locked 阶段不能绕过业务 Gate | NAV-05 |
| FLOWUX-NAV-07 | 点击 locked 显示阻塞原因 | 用户知道如何解锁，不只看到 disabled | NAV-06 |
| FLOWUX-NAV-08 | 点击已完成阶段只切换视图 | 不修改生产状态 | NAV-06 |

### D. 上传体验

| ID | 原子任务 | 可验证完成结果 | 前置 |
|---|---|---|---|
| FLOWUX-UP-01 | 实现大面积 Dropzone | 拖入文件时有明确视觉反馈 | SHELL-03 |
| FLOWUX-UP-02 | 显示支持格式和限制 | 用户选择前知道 MIME 与大小合同 | UP-01 |
| FLOWUX-UP-03 | 选择 100 张后立即建立本地网格 | 不等待全部上传才显示条目 | UP-01 |
| FLOWUX-UP-04 | 每项显示上传状态 | waiting/uploading/archiving/ready/failed 可见 | UP-03 |
| FLOWUX-UP-05 | 显示整体上传统计 | 完成、运行、失败数量实时更新 | UP-04 |
| FLOWUX-UP-06 | 实现失败项重试 | 不重新上传成功项 | UP-04 |
| FLOWUX-UP-07 | 实现移除未提交项 | 操作前说明是否清理已上传 Asset | UP-04 |
| FLOWUX-UP-08 | 页面恢复服务端上传状态 | 刷新后不回到空 Dropzone | UP-04 |
| FLOWUX-UP-09 | 为同名文件显示稳定顺序 | 同名图片不会在 UI 合并 | UP-03 |

### E. Media Canvas 与选择模型

| ID | 原子任务 | 可验证完成结果 | 前置 |
|---|---|---|---|
| FLOWUX-CAN-01 | 实现虚拟化媒体网格 | 300 个 Item 滚动仍可交互 | UP-03 |
| FLOWUX-CAN-02 | 实现统一 Media Card 骨架 | 输入、结果、Prompt 模式和状态位置稳定 | CAN-01 |
| FLOWUX-CAN-03 | 单击选中并打开 Inspector | 当前选择有明确描边与焦点 | CAN-02 |
| FLOWUX-CAN-04 | 实现 checkbox 多选 | 多选不与打开 Inspector 冲突 | CAN-02 |
| FLOWUX-CAN-05 | 实现 Shift 范围选择 | 连续 Item 可快速选择 | CAN-04 |
| FLOWUX-CAN-06 | 实现当前筛选全选 | 明确显示选择数量 | CAN-04 |
| FLOWUX-CAN-07 | 增加状态过滤 | Ready/Running/Failed/Succeeded/Adopted | CAN-02 |
| FLOWUX-CAN-08 | 增加 Shared/Custom 过滤 | 快速定位单项差异 | CAN-02 |
| FLOWUX-CAN-09 | 增加序号与文件名搜索 | 搜索不改变后端顺序 | CAN-02 |
| FLOWUX-CAN-10 | 空结果显示清除过滤入口 | 用户不会误认为数据丢失 | CAN-07、08、09 |
| FLOWUX-CAN-11 | 视频卡支持轻量预览 | 预览不同时自动播放全部 100 个视频 | CAN-02 |
| FLOWUX-CAN-12 | 卡片失败态显示一行原因 | 无需进入 Job 页面判断失败 | CAN-02 |

### F. Shared Prompt Bar

| ID | 原子任务 | 可验证完成结果 | 前置 |
|---|---|---|---|
| FLOWUX-PRM-01 | 实现持久 Shared Prompt Bar | Canvas 滚动时仍可看到公共 Prompt 状态 | SHELL-03 |
| FLOWUX-PRM-02 | 显示 Shared Prompt 摘要和版本 | 当前公共规则可识别 | PRM-01 |
| FLOWUX-PRM-03 | 显示 inherited/custom/stale 数量 | 修改影响范围无需手工统计 | PRM-02 |
| FLOWUX-PRM-04 | 打开 Shared Prompt Editor | 编辑器显示完整文本而非单行输入 | PRM-01 |
| FLOWUX-PRM-05 | 保存前显示影响确认 | 明确多少未提交项和旧结果受影响 | PRM-04 |
| FLOWUX-PRM-06 | 保存后更新版本与卡片标识 | inherited Item 使用新版本 | PRM-05 |
| FLOWUX-PRM-07 | 增加 Effective Prompt 预览 | 用户看到供应商实际文本 | PRM-02 |
| FLOWUX-PRM-08 | Shared Prompt 为空时阻止生成 | 主 CTA 指向 Set shared prompt | PRM-01 |

### G. Item Inspector 与单项 Prompt

| ID | 原子任务 | 可验证完成结果 | 前置 |
|---|---|---|---|
| FLOWUX-INS-01 | 实现 Inspector Drawer/Panel | 选中 Item 后不跳页 | CAN-03 |
| FLOWUX-INS-02 | 显示输入图片元数据 | 文件名、尺寸、类型和状态可见 | INS-01 |
| FLOWUX-INS-03 | 显示 Prompt 模式 | Shared 或 Custom 有明确控件 | INS-01、PRM-02 |
| FLOWUX-INS-04 | 切换 Custom 时复制当前 Effective Prompt | 用户从可理解文本开始修改 | INS-03 |
| FLOWUX-INS-05 | 保存完整 Custom Prompt | 只有当前 Item 变化 | INS-04 |
| FLOWUX-INS-06 | 恢复 Shared Prompt | 删除 Override 并更新卡片标识 | INS-05 |
| FLOWUX-INS-07 | 未保存切换 Item 时提示 | 编辑内容不静默丢失 | INS-05 |
| FLOWUX-INS-08 | 显示最新 Job 和尝试次数 | 不跳 Jobs 页面即可判断状态 | INS-01 |
| FLOWUX-INS-09 | 显示 QA 与 Review | 结果判断有证据 | INS-08 |
| FLOWUX-INS-10 | 折叠 Advanced Diagnostics | ID、hash、供应商 task ID 默认隐藏 | INS-08 |
| FLOWUX-INS-11 | 实现上一项/下一项键盘导航 | Review 时可连续处理 | INS-01 |

### H. 批量操作栏

| ID | 原子任务 | 可验证完成结果 | 前置 |
|---|---|---|---|
| FLOWUX-BULK-01 | 多选后显示 Contextual Action Bar | 操作栏显示选中数量 | CAN-04 |
| FLOWUX-BULK-02 | 增加恢复 Shared | 只影响选中 Custom 项 | BULK-01、INS-06 |
| FLOWUX-BULK-03 | 增加 Run selected | 只提交合法 Ready 项并显示排除数量 | BULK-01 |
| FLOWUX-BULK-04 | 增加 Retry failed | 只对选中 Failed 项有效 | BULK-01 |
| FLOWUX-BULK-05 | 增加 Regenerate with current prompt | 明确会创建新 Job 与预计成本 | BULK-01 |
| FLOWUX-BULK-06 | 增加 Exclude | destructive 确认显示目标数量 | BULK-01 |
| FLOWUX-BULK-07 | 增加批量 Adopt | 只接受成功且 QA 合法的 Item | BULK-01 |
| FLOWUX-BULK-08 | 操作后保留合理筛选上下文 | 不把用户强制送回网格顶部 | BULK-02 至 07 |

### I. Pilot、成本与运行确认

| ID | 原子任务 | 可验证完成结果 | 前置 |
|---|---|---|---|
| FLOWUX-RUN-01 | 显示系统建议 Pilot | 三项在 Canvas 中有 Pilot 标记 | CAN-02 |
| FLOWUX-RUN-02 | 允许替换 Pilot | 最终选择数量和复杂度提示明确 | RUN-01 |
| FLOWUX-RUN-03 | 实现运行前检查 Sheet | Ready、blocked、Shared、Custom 数量可见 | PRM-03、RUN-02 |
| FLOWUX-RUN-04 | 显示 Pilot 与全批成本 | 两个数字不混淆 | RUN-03 |
| FLOWUX-RUN-05 | 显示模型、reference image 和输出参数 | 明确不是首尾帧 | RUN-03 |
| FLOWUX-RUN-06 | 确认后提交 Pilot | UI 立即返回 accepted Job 数量 | RUN-04、05 |
| FLOWUX-RUN-07 | Pilot 未通过时主 CTA 变为修复 | 不显示可误点的 Run all | RUN-06 |
| FLOWUX-RUN-08 | Pilot 通过后解锁 Run batch | 解锁原因和剩余数量可见 | RUN-07 |
| FLOWUX-RUN-09 | Run batch 确认显示 Wave 和并发 | 用户知道不是同时请求全部 Item | RUN-08 |

### J. Queue Drawer

| ID | 原子任务 | 可验证完成结果 | 前置 |
|---|---|---|---|
| FLOWUX-QUE-01 | 实现可展开 Queue Drawer | 不离开 Canvas 查看队列 | SHELL-03 |
| FLOWUX-QUE-02 | 显示真实 Active / Queued / Failed | 数量来自服务端 | QUE-01 |
| FLOWUX-QUE-03 | 显示 Workspace 并发 | Active 数与上限同屏 | QUE-02 |
| FLOWUX-QUE-04 | 显示每个运行项的阶段 | submitting/polling/downloading/archiving 可区分 | QUE-02 |
| FLOWUX-QUE-05 | 显示供应商真实失败原因 | 错误不被统一成 Request failed | QUE-02 |
| FLOWUX-QUE-06 | 实现 Pause scheduling | 文案说明运行中任务不会取消 | QUE-02 |
| FLOWUX-QUE-07 | 实现 Resume scheduling | 恢复后只调度 Ready 项 | QUE-06 |
| FLOWUX-QUE-08 | 实现 Retry failed | 操作显示目标数量和预计成本 | QUE-05 |
| FLOWUX-QUE-09 | 页面重载恢复 Queue Drawer | 不依赖前端内存 | QUE-02 |
| FLOWUX-QUE-10 | 新状态变化使用非阻塞通知 | 不弹窗打断用户 Review | QUE-02 |

### K. Review Mode

| ID | 原子任务 | 可验证完成结果 | 前置 |
|---|---|---|---|
| FLOWUX-REV-01 | 实现同 Workspace Review 视图 | 不跳转全站 Reviews 页面 | CAN-02 |
| FLOWUX-REV-02 | 输入图和视频并列 | 用户可以判断参考图保持情况 | REV-01 |
| FLOWUX-REV-03 | 单个视频按需播放 | 未进入视口的视频不消耗播放资源 | REV-02 |
| FLOWUX-REV-04 | 实现 Adopt / Reject / Needs changes | 决策写回服务端 | REV-02 |
| FLOWUX-REV-05 | Reject 要求结构化原因 | 不能只保存空拒绝 | REV-04 |
| FLOWUX-REV-06 | Needs changes 可打开 Prompt Inspector | 返工与当前 Item 上下文连续 | REV-04、INS-01 |
| FLOWUX-REV-07 | 增加 Review 状态过滤 | 未审、adopted、rejected 可筛选 | REV-04 |
| FLOWUX-REV-08 | 增加批量 Adopt | 目标数量和合法性明确 | REV-04、BULK-07 |
| FLOWUX-REV-09 | 卡片显示 QA 摘要 | 技术失败与创意拒绝不混淆 | REV-02 |
| FLOWUX-REV-10 | 键盘完成连续 Review | 上一项、下一项、采用、拒绝可访问 | INS-11、REV-04 |

### L. Delivery Mode

| ID | 原子任务 | 可验证完成结果 | 前置 |
|---|---|---|---|
| FLOWUX-DEL-01 | 显示 adopted 交付摘要 | adopted、未审、失败数量可见 | REV-04 |
| FLOWUX-DEL-02 | 未审 Item 阻止误称全部完成 | 页面明确剩余 Review | DEL-01 |
| FLOWUX-DEL-03 | 增加 adopted 批量下载 | 只包含采用输出 | DEL-01 |
| FLOWUX-DEL-04 | 增加 manifest 下载 | 文件与输入、Prompt、Job、Review 可追溯 | DEL-01 |
| FLOWUX-DEL-05 | 显示文件命名规则 | 下载前知道 sequence 和文件名 | DEL-03 |
| FLOWUX-DEL-06 | 导出完成写活动日志 | 团队可追踪交付人和时间 | DEL-03、04 |

### M. 空、加载、失败与恢复状态

| ID | 原子任务 | 可验证完成结果 | 前置 |
|---|---|---|---|
| FLOWUX-STATE-01 | 为每个视图定义 Skeleton | 加载时布局不大幅跳动 | IA-05 |
| FLOWUX-STATE-02 | 定义空 Batch 状态 | 主 CTA 是 Upload images | UP-01 |
| FLOWUX-STATE-03 | 定义无 Shared Prompt 状态 | 主 CTA 是 Set shared prompt | PRM-08 |
| FLOWUX-STATE-04 | 定义无筛选结果状态 | 提供清除过滤 | CAN-10 |
| FLOWUX-STATE-05 | 定义请求失败状态 | 保留现有内容并提供 Retry | SHELL-03 |
| FLOWUX-STATE-06 | 定义权限失败状态 | 403/404 不泄漏其他 Workspace 信息 | SHELL-03 |
| FLOWUX-STATE-07 | 定义上传 CORS/签名/网络错误文案 | 不统一显示 Failed to fetch | UP-04 |
| FLOWUX-STATE-08 | 定义 stale 配置状态 | stale 与 failed 视觉和语义分开 | PRM-06 |
| FLOWUX-STATE-09 | 定义 Stop-loss 状态 | 原因、影响、成本和修复动作同屏 | QUE-06 |

### N. Accessibility 与键盘

| ID | 原子任务 | 可验证完成结果 | 前置 |
|---|---|---|---|
| FLOWUX-A11Y-01 | 为媒体卡建立可访问名称 | 读出 sequence、文件、Prompt 模式和状态 | CAN-02 |
| FLOWUX-A11Y-02 | selected 不只依赖颜色 | 描边、图标和 aria-selected 同步 | CAN-03 |
| FLOWUX-A11Y-03 | 实现可见焦点 | Header、Rail、Card、Inspector、Drawer 均可见 | SHELL-03 |
| FLOWUX-A11Y-04 | Inspector 打开后管理焦点 | 关闭后回到原卡片 | INS-01 |
| FLOWUX-A11Y-05 | 批量操作宣告目标数量 | 屏幕阅读器知道影响多少项 | BULK-01 |
| FLOWUX-A11Y-06 | 上传和队列变化使用 live region | 重要完成/失败可被感知但不刷屏 | UP-04、QUE-02 |
| FLOWUX-A11Y-07 | 视频提供播放和静音控制 | 不依赖 hover | REV-03 |
| FLOWUX-A11Y-08 | 200% 缩放仍可操作 | 无关键控件被遮挡 | SHELL-05 |
| FLOWUX-A11Y-09 | reduced-motion 浏览器验收 | 无必要状态丢失 | SHELL-08 |

### O. 性能与资源纪律

| ID | 原子任务 | 可验证完成结果 | 前置 |
|---|---|---|---|
| FLOWUX-PERF-01 | 网格只渲染可见范围 | 300 项 DOM 数量受控 | CAN-01 |
| FLOWUX-PERF-02 | 缩略图使用合适尺寸 | 不为网格下载原始大图 | CAN-02 |
| FLOWUX-PERF-03 | 视频仅在明确预览时加载 | 100 张卡不同时加载视频 | CAN-11 |
| FLOWUX-PERF-04 | 状态刷新按页面可见性调节 | 后台标签降低无意义请求 | QUE-02 |
| FLOWUX-PERF-05 | Item 状态增量更新 | 单项变化不重取全部大 payload | QUE-02 |
| FLOWUX-PERF-06 | 搜索与过滤不复制大媒体对象 | 交互无明显阻塞 | CAN-07 至 09 |

### P. 浏览器验收

| ID | 原子任务 | 可验证完成结果 | 前置 |
|---|---|---|---|
| FLOWUX-ACPT-01 | 验收双壳切换 | 管理页保持原壳，Batch 详情进入创作壳 | SHELL-03 |
| FLOWUX-ACPT-02 | 验收 100 图片网格 | 上传、滚动、筛选和选择可用 | UP-08、CAN-01 |
| FLOWUX-ACPT-03 | 验收 Shared Prompt | 100 项默认继承且影响数量正确 | PRM-06 |
| FLOWUX-ACPT-04 | 验收单项 Custom Prompt | 一个 Item 修改不影响其他项 | INS-05 |
| FLOWUX-ACPT-05 | 验收页面恢复 | view、selected Item、上传和 Queue 状态恢复 | IA-06、UP-08、QUE-09 |
| FLOWUX-ACPT-06 | 验收 Pilot Gate | 未通过不能 Run batch，通过后解锁 | RUN-08 |
| FLOWUX-ACPT-07 | 验收 Queue Pause / Resume | 无重复 Job，运行中状态持续可见 | QUE-07 |
| FLOWUX-ACPT-08 | 验收失败项重试 | 只重试目标项，成功项不重生 | QUE-08 |
| FLOWUX-ACPT-09 | 验收 Review 连续性 | 不离开 Workspace 完成采用与返工 | REV-06 |
| FLOWUX-ACPT-10 | 验收 Delivery | adopted 下载和 manifest 一致 | DEL-04 |
| FLOWUX-ACPT-11 | 验收键盘和焦点 | 无鼠标可完成选择、Inspector、Review | A11Y-03 至 07 |
| FLOWUX-ACPT-12 | 验收宽屏、中屏、小屏 | 核心操作无阻塞，降级边界清楚 | SHELL-05 至 07 |
| FLOWUX-ACPT-13 | 验收 200% 缩放和 reduced motion | 可访问合同成立 | A11Y-08、09 |
| FLOWUX-ACPT-14 | 验收真实 MiniMax 批量路径 | 媒体状态与真实 Job、QA、Review 一致 | 全部核心任务 |

## 8. 推荐实施顺序

```text
IA
→ Shell
→ Header / Stage Rail
→ Upload
→ Media Canvas
→ Shared Prompt
→ Inspector
→ Pilot / Run confirmation
→ Queue Drawer
→ Review
→ Delivery
→ Accessibility / Performance
→ Browser acceptance
→ Visual refinement
```

视觉润色必须在完整路径可操作之后进行。不要先制作漂亮的空壳，再把状态机硬塞进去。

## 9. 完成定义

UI/UX 只有在真实用户视角完成以下路径后才算完成：

```text
进入创作壳
→ 上传 100+ 图片
→ 编辑一次 Shared Prompt
→ 为一个图片设置 Custom Prompt
→ 运行 Pilot
→ 放量批次
→ 离开并返回页面
→ 只重试失败项
→ 连续 Review
→ adopted 批量导出
```

静态截图相似、组件库齐全或深色主题完成，都不能单独证明 Google Flow 式体验已经成立。

## 10. 产品参考

- [Google 官方：Veo 3.1 与 Flow 的 Ingredients、Frames、Extend 和编辑能力](https://blog.google/innovation-and-ai/products/veo-updates-flow/)；
- [Chrome Web Store：ZAPI FLOW 批量 Prompt、状态和自动下载能力](https://chromewebstore.google.com/detail/zapi-flow/debadkiomlbdambamdpdlgdkgnedcjil)。
