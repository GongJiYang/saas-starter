# 品牌可控 AI 广告生产工作台

[English](./README.md) | **简体中文**

> 把一份 SKU Brief 变成三条可比较的 30 秒广告。

<sub>首页实际标题（英文）：*Turn one SKU brief into three comparable 30-second advertisements.*</sub>

本仓库是 [Next.js SaaS Starter](https://github.com/nextjs/saas-starter) 的深度扩展，正在被改造成一个**面向国内电商品牌团队的、品牌可控的 AI 视频广告生产工作台**。

它不是一个 AI 视频生成网站，也不是 MiniMax H3 的图形界面。它解决的不是「视频怎么生成」，而是「**应该生成什么、哪些商品与品牌信息不能错、团队如何批准、下一次该继续测试什么**」。

---

## 目录

- [产品定位](#产品定位)
- [核心工作流](#核心工作流)
- [领域概念](#领域概念)
- [已实现功能](#已实现功能)
- [技术架构](#技术架构)
- [目录结构](#目录结构)
- [快速开始](#快速开始)
- [环境变量](#环境变量)
- [常用命令](#常用命令)
- [数据模型](#数据模型)
- [质量门与实现阶段](#质量门与实现阶段)
- [边界与非目标](#边界与非目标)
- [许可证](#许可证)

---

## 产品定位

### 一句话结论

> 面向国内电商品牌团队的品牌可控创意生产工作台：把商品资料和品牌要求编译成三条可比较的广告创意，完成生成、质检、审批、交付，并沉淀品牌自己的创意经验。

### 与模型供应商的分工

MiniMax H3 是**原材料供应商**，不是需要正面击败的对手。

| 环节 | 模型平台（如海螺） | 本产品 |
|---|---|---|
| 输入起点 | 图片和 Prompt | 商品事实、品牌规则和 Campaign 目标 |
| 创意决策 | 用户自己想 | 生成三个可解释的创意假设 |
| 视频生成 | 核心能力 | 调用 H3 等供应商完成 |
| 约束 | 通用安全规则 | 每个品牌和 SKU 的具体约束 |
| 多版本 | 多次重新生成 | 受控变量的版本实验 |
| 团队协作 | 个人创作为主 | Workspace、审批、活动记录 |
| 输出终点 | 预览和下载 | 品牌审批与平台交付包 |
| 经验沉淀 | 通用模板和社区 | 当前品牌的私有采用与拒绝记忆 |

### 五个核心差异化

1. **创意假设，而不是普通镜头模板** —— 每张卡回答「目标人群是谁、开头用什么 Hook、主推哪个卖点、为什么可能有效、与另外两张唯一不同的变量是什么」。
2. **商品事实层** —— Brand Kit 只能约束品牌调性，无法保证商品内容正确。系统额外记录 SKU、规格、已批准卖点及其依据、禁止宣称、必现元素、不可改变区域。
3. **受控变量批量实验** —— 一批版本只改变一个关键变量，因此结果可比较、可复现、可复用。
4. **品牌创意记忆** —— 拒绝原因是**结构化分类**（商品问题 / 品牌问题 / 创意问题 / 生成问题），不是自由文本，用于积累品牌私有的生产经验。
5. **国内电商交付包** —— 交付终点不是一个下载按钮，而是包含多平台画幅、封面、发布文案、商品事实与审批记录的标准包。

### 三阶段发展方向

```text
当前：软件辅助视频生产服务
  ↓ 积累商品规则、品牌偏好和拒绝原因
中期：品牌私有创意工作流
  ↓ 获得真实发布和投放结果
长期：由人批准的创意实验 Agent
```

必须明确区分：**审批采用率 ≠ 投放效果**。采用只表示品牌愿不愿意发布；在没有真实投放数据前，系统不宣称能自动优化广告效果。

---

## 核心工作流

### 单 SKU：30 秒广告包（当前产品合同）

产品销售单位是一个 `SKU Ad Pack`，不是 H3 秒数、VideoJob 次数或 5 秒视频。

```text
SKU Product Brief
→ 完整性、证据和合规检查
→ 排序三个适用 Creative Angle
→ 用户选择一个主角度
→ 为该角度生成三个 5 秒 Hook 变体
→ 生成共享的 20 秒产品主体
→ 生成确定性的 5 秒品牌 CTA 尾卡
→ 自动组装三条完整广告
→ 商品一致性、字幕、音频和文件质检
→ 比较、审批、下载
```

交付结果：

```text
Ad A：Hook Variant A 5s + 共享主体 20s + CTA 5s = 30s
Ad B：Hook Variant B 5s + 共享主体 20s + CTA 5s = 30s
Ad C：Hook Variant C 5s + 共享主体 20s + CTA 5s = 30s
```

三条广告**只改变前 5 秒 Hook**，商品、卖点、人群、调性、主体镜头、字幕样式、音乐和 CTA 完全一致。客户比较的是同一商品的三个开场策略，而不是三条随机视频。

| 时间 | 内容 | 生成方式 |
|---|---|---|
| 0–5s | 同一 Angle 下的 Hook Variant A / B / C | 三个独立 H3 镜头 |
| 5–10s | 商品完整揭示 | 共享 H3 镜头 |
| 10–15s | 批准卖点 1 | 共享 H3 镜头 |
| 15–20s | 批准卖点 2 / 使用证明 | 共享 H3 镜头 |
| 20–25s | 品牌生活方式或英雄镜头 | 共享 H3 镜头 |
| 25–30s | Logo、批准文案和 CTA 尾卡 | 程序确定性合成，**不让视频模型生成文字** |

唯一 H3 生成量为 35 秒（3 个 Hook × 5s + 4 个共享主体镜头 × 5s），三条广告复用共享主体，无需生成 90 秒独立素材。

**成本模型**：MiniMax-H3 768P 官方价格 ¥0.50 / 生成秒，基础素材成本 ¥17.50，含最多两个失败镜头重试的模型成本准备金 ¥22.50。

### 批量多 SKU：Pilot + Wave

批量能力会放大单 SKU 的每个错误，因此实施顺序被强制约束为：

```text
单 SKU 30 秒完整广告垂直切片通过
→ 真实客户确认 Creative Spec 可理解
→ 三个真实 SKU Pilot 通过
→ 再实现 CSV Catalog 和 Production Batch
```

四道生成前风险控制：

1. **SKU Readiness Gate** —— 可解释的规则清单，缺失资料的行保持 `needs_input`，不得创建 Campaign 或 VideoJob。
2. **Creative Spec Gate** —— 在产生昂贵视频任务前，先生成低成本、可审批的创意计划。**未经审批的 Spec 不得入队。**
3. **Pilot Gate** —— 系统按商品类别、素材风险和视觉难度选择最多 3 个代表 SKU 先跑通，至少 2 个 Pilot SKU 各有 1 条广告被采用后才释放剩余 SKU。
4. **Wave Stop-Loss** —— Pilot 通过后默认每波 10 个 SKU，出现批次级失败信号时自动暂停**未调度**任务（已提交的任务继续归档，避免状态和账目失真）。

失败分类必须结构化，禁止使用「再生成一次看看」作为默认补救：

| 类型 | 系统处理 | 商业处理 |
|---|---|---|
| 技术失败 | 自动重试失败镜头 | 不计为客户改稿 |
| 商品一致性失败 | 禁止交付，修正配方后重生成对应镜头 | 不计为客户改稿 |
| 已批准规格偏离 | 生成新的 `CreativeSpecVersion` 并做校正版本 | 包含一次校正 |
| 主观偏好变化 | 保存新偏好，创建新版本 | 作为范围变更 |
| Brief 变化 | 创建新 Brief / Spec 版本 | 新生产范围 |

---

## 领域概念

| 概念 | 定义 |
|---|---|
| **Workspace / Team** | 团队上下文边界。所有查询与写入必须强制 `teamId` 归属。 |
| **Brand Kit** | 品牌调性、Logo、色彩、字体、CTA 等品牌约束，带版本快照。 |
| **Catalog Item** | 持久保存的可复用商品资料（SKU、图片、批准卖点、参考视频、可生产状态）。 |
| **Campaign** | 一次创意实验的容器，是产品的**核心对象**（而非 VideoJob）。 |
| **Creative Angle** | 根据 SKU 证据排序出的低成本策略建议。 |
| **Hook Variant** | 只改变前 5 秒的三个受控测试变量。 |
| **Creative Spec / Version** | 可审批的创意计划：选定 Angle、Hook 文案、共享主体 Shot List、卖点证据绑定、预算与成本上限。 |
| **Shot Skill Card** | 结构化镜头技能卡：验证卡片、计算适用性、编译供应商中立配方、适配 H3、保留技能/版本/哈希快照。 |
| **ShotPlan / GenerationRecipe** | 单个镜头的**冻结配方**。对重试必须不可变，不得静默切换技能版本。 |
| **ShotVersion** | 镜头的 V1 / V2 版本。 |
| **VideoJob** | H3 队列执行记录。 |
| **AdPlan** | 一个共享广告计划，编译为 3 个 HookShotPlan + 4 个 SharedBodyShotPlan + 1 个 EndCardPlan。 |
| **AdVersion** | 组装后的完整 30 秒广告。**审批对象必须是 AdVersion**，不是原始片段。 |
| **QualityAssessment** | 商品一致性、字幕、音频、编码等质检结论。 |
| **Review** | 品牌负责人对完整广告的采用 / 拒绝与结构化原因。 |
| **Production Batch** | 一次批量生产的执行状态（Pilot、Wave、暂停、成本汇总）。 |
| **Pilot / Wave** | 先小样验证，再分波放量的生产节奏。 |

---

## 已实现功能

### 团队与账户

- 邮箱 / 密码注册登录，基于 `jose` 的 JWT 存储于 Cookie
- 注册时自动创建企业 Workspace
- 全局中间件保护登录路由，本地中间件校验 Server Action 与 Zod schema
- Owner / Member 基础 RBAC
- 团队邀请、成员管理、活动日志（`activity_logs`）

### 品牌与商品资料

- Brand Kit 创建、编辑与偏好版本（`brand_kit_preference_versions`）
- SKU Catalog：单条创建、编辑、复制、批量操作、服务端分页
- 商品图片上传：预检 → 签发私有 COS 直传 URL → 完成登记 → 兜底路径 → 过期清理
- CSV 导入：模板下载、上传、逐行校验、错误定位到行列、修复、重新校验、幂等提交

### 创意规划与技能卡

- Shot Skill Card 运行时（`lib/shot-skills/`）：schema 校验、注册表、生命周期、适用性计算、库管理、预览、导入导出、质量检查
- 官方内置技能卡：`product-hero`、`product-macro-detail`、`product-use-case`
- 技能版本与发布验证记录（`shot_skill_versions`、`shot_skill_release_validations`）
- 卡片定义哈希回填与持久化
- **H3 适配器**（`lib/shot-skills/providers/minimax-h3.ts`）：把供应商中立配方编译为 H3 参数

### 生成执行

- BullMQ 异步队列（`video-submit` / `video-poll`），延迟 10 秒轮询 MiniMax 状态
- 视频任务状态机与合法转移（`lib/video-jobs/state.ts`）
- 提交 → 轮询 → 成功后立即流式归档到 COS → 保留失败码与原因
- Worker 处理 SIGINT / SIGTERM 优雅退出并关闭连接
- 可插拔视频供应商：`minimax`（官方 API）与 `autodl-h3`（自托管）

### 质检、审批与交付

- 质量门（`lib/quality/gates.ts`）与**阻断级商品一致性失败**处理
- 结构化整改流程（`lib/quality/remediation.ts`、`lib/reviews/remediation.ts`）
- Review 决策与 AdVersion 审批
- 批次详情、图片清单、图生视频配方、提示词、导出、已采用结果导出、反馈回传

### 参考视频

- Creative Reference 上传与权利声明（`owned` / `licensed` / `inspiration_only`）
- Reference Analysis Worker：提取时长、镜头边界、节奏、构图、字幕安全区、CTA 位置等**结构属性**
- 默认排除第三方 Logo、可识别人物与声音、原脚本、原音乐、水印
- 参考基准启用开关（`reference_benchmarks`），需实测优于结构提取才进入生产路径

### 基础设施

- 错误分类体系（`lib/errors/`）：领域错误、HTTP 映射、客户端展示
- 限流（`lib/ops/rate-limit.ts`）与过期对象清理（`lib/ops/cleanup.ts`）
- CSV 外部 URL 安全校验：HTTPS 强制、私网地址拦截、MIME、大小、重定向次数与授权
- Stripe 订阅骨架**保留但首发禁用**（见[边界与非目标](#边界与非目标)）

### 验证脚本

`scripts/` 下共 **37 个** 脚本，覆盖技能卡、批量合同、CSV、参考、Creative Spec、生产批次、质量门、安全清理、实现阶段等契约检查。项目**没有**配置 Jest / Vitest / Playwright，验证是脚本式的。

---

## 技术架构

### 数据流

```text
Next.js App Router UI
  → server actions / route handlers
  → team-scoped Drizzle queries
  → Postgres
  → BullMQ producer → Redis → workers/index.ts
  → MiniMax H3 submit / delayed poll
  → COS archive and signed download
  → Review and Activity Log
```

### 关键边界

- `requireWorkspace()` 建立已认证的团队上下文；Server Action 用 Zod 校验输入。
- 每个商品查询与变更必须强制 `teamId` 归属。
- `lib/minimax/video.ts` 是供应商边界 —— **不得从 UI 代码直接调用 MiniMax**。
- `lib/storage/cos.ts` 独占私有对象键与签名 URL。
- `lib/video-jobs/worker.ts` 独占任务提交、轮询、归档与状态转移。
- `ShotPlan` / `GenerationRecipe` 对重试必须不可变。
- 旧 `ShotCard` 行在迁移期仍是当前持久化方式，但新行为**不得**把旧卡当作最终客户交付物。

### 技术栈

| 层 | 选型 |
|---|---|
| 框架 | Next.js `15.6.0-canary.59`（App Router、Turbopack） |
| UI | React `19.1.0`、Tailwind CSS `4.1.7`、Radix UI、lucide-react、SWR |
| 语言 | TypeScript `5.8.3`（strict、`noEmit`、`@/*` 别名） |
| 数据库 | PostgreSQL 16 + Drizzle ORM `0.43.1`（`postgres` 驱动） |
| 队列 | Redis 7 / Valkey + BullMQ `6.0.5` + ioredis `6.0.0` |
| 视频模型 | MiniMax H3 V2（异步任务 + 轮询） |
| 文字模型 | MiniMax M3（OpenAI 兼容 `/v1/chat/completions`） |
| 对象存储 | 腾讯云 COS（私有桶 + 15 分钟签名 URL） |
| 校验 | Zod `3.24.4` |
| 认证 | jose `6.0.11` + bcryptjs |
| 支付 | 微信支付 Native（计划中）/ Stripe（旧骨架，禁用） |
| 运行时 | Node.js + `tsx`、`pnpm`（`pnpm-lock.yaml` 为准） |

---

## 目录结构

```text
app/                                  Next.js App Router
├── (dashboard)/                      营销首页与 Pricing
├── (login)/                          注册 / 登录
├── (dashboard)/dashboard/            已认证工作区
│   ├── campaigns/                    Campaign 列表与详情
│   ├── catalog/                      SKU Catalog 表格与详情
│   ├── brand-kits/                   Brand Kit 管理
│   ├── skills/                       Shot Skill Card 管理、版本、导入
│   ├── batches/                      Production Batch 与图生视频
│   ├── specs/                        Creative Spec 审批
│   ├── references/                   参考视频与结构分析
│   ├── jobs/                         VideoJob 追踪
│   ├── reviews/                      审批
│   ├── activity/                     活动日志
│   ├── settings/security/general/    团队与账户设置
│   └── page.tsx                      工作区总览
└── api/                              Route Handlers
    ├── assets/                       上传预检、签名、完成、清理
    ├── bulk/                         CSV 导入、参考分析
    ├── catalog/                      SKU Catalog CRUD
    ├── creative-specs/               Spec 生成与批量审批
    ├── production-batches/           Pilot / Wave / 导出 / 整改
    ├── quality/                      质检结果
    ├── skills/                       技能卡适用性与版本导出
    └── stripe/                       旧订阅骨架（禁用）

lib/
├── auth/                             会话与中间件
├── workspace/                        成员与访问检查
├── db/                               Drizzle schema、迁移、team-scoped 查询、seed
├── queue/                            Redis / BullMQ 连接与生产者
├── video-jobs/                       任务状态机与 worker 操作
├── video-providers/                  供应商适配（minimax / autodl-h3）
├── minimax/                          MiniMax API 适配（server-only）
├── storage/                          腾讯 COS 集成
├── shot-skills/                      Shot Skill Card 运行时与供应商编译
├── campaigns/                        执行计划
├── catalog/                          商品资料服务与合同
├── creative-spec/                    创意计划编译与 action
├── production-batches/               Pilot / Wave / 配方 / 状态
├── references/                       参考视频探测、分析与 worker
├── quality/                          质量门与整改
├── reviews/                          审批决策与整改
├── bulk/                             CSV、就绪度、URL 安全、工作流合同
├── assets/                           资产合同与服务
├── payments/                         支付适配
├── errors/                           领域错误分类
├── config/                           环境变量解析
├── ops/                              限流与清理
└── implementation/                   实现阶段定义

workers/index.ts                      独立 BullMQ worker 进程
scripts/                              37 个契约检查与实验脚本
docs/product/                         产品合同与原子任务清单
docs/development/                     外部依赖与运维设置
```

---

## 快速开始

### 前置条件

- Node.js 与 `pnpm`
- Docker（本地 Postgres 与 Redis）
- 可选：FFmpeg（三十秒样片拼接）

```bash
pnpm install
```

### 启动本地基础设施

```bash
docker compose up -d postgres redis
```

- PostgreSQL 16 → `127.0.0.1:54329`
- Redis 7 → `127.0.0.1:56379`（`maxmemory-policy noeviction`）

两者均只绑定回环地址。

### 配置环境变量

```bash
pnpm db:setup
```

该脚本会创建 `.env`。参考 [`.env.example`](./.env.example)。`.env` 已被 `.gitignore` 忽略，**不得提交**。

### 迁移与种子数据

```bash
pnpm db:migrate
pnpm db:seed
```

种子数据创建默认账号：

```text
User:     test@test.com
Password: admin123
```

### 启动

```bash
pnpm dev       # Web → http://localhost:3000
pnpm worker    # 需 Redis 配置完成后启动
```

可试用路径：

```text
http://localhost:3000/sign-up
http://localhost:3000/sign-in
http://localhost:3000/dashboard
http://localhost:3000/dashboard/brand-kits
http://localhost:3000/dashboard/campaigns
```

### 降级行为

系统**不会伪造成成功**：

- 未配置 COS 时，图片上传返回明确的 `503 Object storage is not configured.`
- 缺少 COS 或 MiniMax 配置时，VideoJob 明确失败，不伪装成功
- 未配置微信支付时，阻止创建付费 `CampaignOrder` 并显示「微信支付尚未开放」，**不回退到旧 Stripe Checkout**

---

## 环境变量

| 变量 | 用途 |
|---|---|
| `POSTGRES_URL` | Postgres 连接串 |
| `BASE_URL` | 应用基础 URL |
| `AUTH_SECRET` | 会话签名密钥（`openssl rand -base64 32`） |
| `REDIS_URL` | BullMQ 队列（`redis://` 或 `rediss://`） |
| `COS_SECRET_ID` / `COS_SECRET_KEY` | 腾讯 COS 凭据 |
| `COS_BUCKET` | 完整桶名（`bucketname-appid`） |
| `COS_REGION` | 例如 `ap-guangzhou` |
| `MINIMAX_API_KEY` | H3 与 M3 共用（仅服务端） |
| `MINIMAX_API_BASE_URL` | 默认 `https://api.minimaxi.com` |
| `MINIMAX_TEXT_API_BASE_URL` | 默认 `https://api.minimaxi.com/v1` |
| `MINIMAX_TEXT_MODEL` | 默认 `MiniMax-M3` |
| `VIDEO_PROVIDER` | `minimax` 或 `autodl-h3` |
| `AUTODL_H3_API_BASE_URL` / `AUTODL_H3_API_KEY` | 自托管 H3 供应商 |
| `AUTODL_H3_API_KEY_FILE` / `AUTODL_H3_PRESET` | 自托管 H3 配置 |
| `STRIPE_SECRET_KEY` / `STRIPE_WEBHOOK_SECRET` | 旧骨架，当前不需要 |
| `WECHAT_PAY_*` | 微信支付 Native（计划中） |

**安全约束**：MiniMax、COS、Redis、Postgres 的密钥与私钥**仅在服务端保存**，绝不发送到浏览器、不写入日志、不进入 Git。

---

## 常用命令

```bash
# 开发
pnpm dev
pnpm build
pnpm start
pnpm worker

# 数据库
pnpm db:setup          # 创建 .env
pnpm db:generate       # 生成迁移
pnpm db:migrate        # 应用迁移 + 技能哈希回填
pnpm db:seed           # 种子数据
pnpm db:studio         # Drizzle Studio
pnpm db:backfill-skill-hashes

# 契约检查（确定性、无网络）
pnpm bulk:contract-check
pnpm workflow:contract-check
pnpm workflow:model-check
pnpm creative-spec:check
pnpm creative-spec:automation-check
pnpm production-batch:check
pnpm quality:check
pnpm catalog:check
pnpm catalog:single-check
pnpm assets:check
pnpm references:check
pnpm review:delivery-check
pnpm security:check
pnpm cutover:check

# Shot Skill Card
pnpm a1:check
pnpm skills:eligibility-check
pnpm skills:persistence-check
pnpm skills:library-check
pnpm skills:cutover-check
pnpm skills:phases-check
pnpm skills:json-check
pnpm skills:p5-e2e
pnpm skills:seed-official

# 实现阶段
pnpm implementation:check
pnpm implementation:verify

# 网络实验（消耗真实额度）
pnpm phase0:creative-test
pnpm sample:30 -- --campaign-id <id>   # 需 FFmpeg
pnpm acceptance:real-wave
pnpm acceptance:real-p5-complete
```

### 类型检查

```bash
pnpm exec tsc --noEmit
```

涉及 Next 编译或路由行为的改动还需运行 `pnpm build`。

---

## 数据模型

Postgres 共 **27 张领域表**，分五组：

**团队与账户**

```text
users · teams · team_members · invitations · activity_logs
```

**品牌与资产**

```text
brand_kits · brand_kit_preference_versions · assets · asset_uploads
```

**创意与技能卡**

```text
campaigns · shot_cards · shot_skills · shot_skill_versions
shot_skill_release_validations · shot_skill_validation_evidence
```

**执行与审批**

```text
video_jobs · reviews
```

**批量与商品资料**

```text
catalog_items · catalog_item_assets · import_batches · import_rows
creative_references · reference_analyses · reference_benchmarks
production_batches · production_batch_items · creative_spec_versions
```

### 建议的对象关系

```text
ImportBatch → ImportRow → CatalogItem
ProductionBatch → ProductionBatchItem → CatalogItem
ProductionBatchItem → Campaign
Campaign → CreativeSpecVersion → AdPlan
CreativeReference → ReferenceAnalysis → CreativeSpecVersion
AdPlan → ShotPlan → ShotVersion → VideoJob
Campaign → AdVersion → QualityAssessment → Review
```

批量层只负责选择、默认值、Pilot、Wave、暂停和汇总。**每个 SKU 仍拥有独立 Campaign、配方、任务、质检和审批记录**，避免一个失败污染整批事务。

### 状态边界

```text
ImportBatch:          uploaded → validating → needs_fix | ready → committed | failed
CatalogItem:          needs_input → ready | archived
CreativeSpecVersion:  draft → awaiting_approval → approved | rejected | superseded
ProductionBatch:      draft → calibrating → pilot_review → ready → producing
                              → paused → producing → reviewing → completed | cancelled
```

VideoJob、ShotVersion 和 Review 使用各自状态机，不塞入单一 Batch 枚举。

---

## 质量门与实现阶段

### ApprovedDeliverable 最低质量合同

```text
30 秒，允许极小编码误差
9:16 竖版 / H.264 视频 / AAC 音频
商品主体清晰
不出现额外商品或错误商品
不改变核心形态、颜色和 Logo
只使用批准卖点
字幕可读且不被模型生成
包含品牌尾卡和 CTA
包含已授权音乐或客户提供音乐
可在目标平台直接上传
```

**生成成功不等于质量通过。** 阻断级商品一致性失败必须阻止组装或交付。

### 关键验证门槛

- 三条都能直接播放和上传
- 三条只有 Hook 明显不同，共享主体完全一致
- 至少两条被评为可用于真实投放或品牌发布
- 没有虚假卖点、额外商品或品牌形态错误
- 从提交 Brief 到看到三条成片不超过 20 分钟

### 批量成功标准

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

`80%` 与 `20%` 是**待真实客户验证的首轮门槛**，不是已证明的市场基准。

### 市场验证标准

不能因为客户称赞 Demo 就宣布市场成立：

```text
5 家客户按公开价格预付
3 家客户按原价复购
1 家客户承诺持续月度采购
```

---

## 边界与非目标

### 产品明确不做

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

V1 不提供时间轴编辑器。字幕、Logo、CTA、音乐、转场、画布和编码由系统自动完成。

V1 不承诺 AI 配音；先使用批准卖点字幕和有授权的背景音乐。

首版只支持：CSV、一个对象存储、一个视频供应商、一个平台导出规格、一个可验证的批量闭环。

### 暂不面向的客户

- 只想尝试一次 AI 视频的个人用户
- 追求自由 Prompt 探索的专业 AI 创作者
- 需要时间轴、剪辑器或节点工作流的影视制作团队
- 只购买底层视频 API 的开发者

### 明确避免的定位表达

避免：最强 AI 视频生成器 / 一键生成任何视频 / 比海螺更好的 H3 / 全行业 AI 创意平台 / 全自动广告投放 Agent / Prompt 和模板市场。

推荐：品牌可控 / 商品事实约束 / 三个可比较创意方向 / 审批和交付闭环 / 减少返工 / 品牌私有创意记忆。

### 迁移期状态

旧 `ShotCard` 行在当前迁移期仍是持久化方式，但新行为不得把旧卡作为最终客户交付物。`ShotPlan` / `GenerationRecipe` 对重试必须不可变 —— 重试必须复用冻结配方，**不得静默切换技能版本**。

### 已知未完成

- 微信支付 Native 尚未实现，价格页不开放 Checkout
- Stripe 订阅代码保留但已从价格页与 Checkout 断开
- 批量能力受 Pilot Gate 约束，需先通过单 SKU 垂直切片
- 无 UI 测试套件，验证依赖脚本与人工观察

---

## 文档索引

| 文档 | 内容 |
|---|---|
| [`docs/product/product-positioning.md`](./docs/product/product-positioning.md) | 产品定位、差异化、客户定义 |
| [`docs/product/market-validation-mvp.md`](./docs/product/market-validation-mvp.md) | **当前单 SKU 产品合同与质量门** |
| [`docs/product/bulk-sku-production-direction.md`](./docs/product/bulk-sku-production-direction.md) | 批量方向、Pilot / Wave、CSV 与双表 |
| [`docs/product/bulk-sku-production-atomic-tasks.md`](./docs/product/bulk-sku-production-atomic-tasks.md) | 批量原子任务（SKILL-01 ~ SKILL-16） |
| [`docs/product/shot-skill-card-blueprint.md`](./docs/product/shot-skill-card-blueprint.md) | Shot Skill Card 完整设计与边界 |
| [`docs/product/phase-0-evidence.md`](./docs/product/phase-0-evidence.md) | Phase 0 实验证据 |
| [`docs/development/external-prerequisites.md`](./docs/development/external-prerequisites.md) | 外部依赖、凭据与托管条件唯一入口 |
| [`AGENTS.md`](./AGENTS.md) | 仓库约定与协作规范 |

---

## 许可证

本项目基于 [Next.js SaaS Starter](https://github.com/nextjs/saas-starter) 扩展。仓库内 [`LICENSE`](./LICENSE) 为继承自上游模板的 **MIT License**（Copyright © 2025 Vercel），本项目的扩展部分沿用同一许可证，除非另有说明。

> 注意：若计划将本项目用于商业闭源分发，需自行确认上游 MIT 条款的署名要求，并在仓库中补充本项目的版权声明。
