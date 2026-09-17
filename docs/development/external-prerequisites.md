# 外部条件与本地试用清单

本文档是项目所有外部依赖、凭据与托管条件的唯一维护入口。新增模型、队列、存储、支付或部署依赖时，必须在对应章节追加：用途、必需配置、平台侧配置、验证方式与未配置时的行为。

## 当前可用的本地基础

| 能力 | 当前状态 | 配置 / 启动方式 |
|---|---|---|
| PostgreSQL 16 | 已配置并运行 | `compose.yaml` 中的 `postgres` 服务；仅绑定 `127.0.0.1:54329` |
| 数据库 Schema | 已迁移 | `pnpm db:migrate` |
| 认证 | 已配置 | `.env` 中的 `AUTH_SECRET` |
| Web 开发服务 | 按需启动 | `pnpm dev` |

本地 `.env` 不进入版本控制；其中的连接串、密码与密钥不得复制到文档、客户端或提交记录中。

## 现在可以试用的页面

开发服务启动后：

```text
http://localhost:3000/sign-up
http://localhost:3000/sign-in
http://localhost:3000/dashboard
http://localhost:3000/dashboard/brand-kits
http://localhost:3000/dashboard/campaigns
```

已可试用：

- 注册、登录与自动创建企业 Workspace；
- Workspace 总览、响应式侧栏与团队设置；
- Brand Kit 创建和编辑；
- Campaign 列表、详情、三张固定 Shot Card 的选择和切换。

Campaign 的**真实图片上传**需要完成下一节的 COS 配置。未配置时，上传接口会返回明确的 `503 Object storage is not configured.`，不会伪造成功。

## 腾讯 COS：真实素材上传

### 必需环境变量

```text
COS_SECRET_ID
COS_SECRET_KEY
COS_BUCKET          # 完整名称：bucketname-appid
COS_REGION          # 例如 ap-guangzhou
```

### 平台侧配置

- Bucket 保持私有；应用仅签发 15 分钟的 PUT/GET URL。
- 为 Web 开发和生产域名配置 CORS：
  - Allowed methods: `PUT`, `GET`, `HEAD`；
  - Allowed headers: `Content-Type`；
  - Expose headers: 按 COS 上传响应需要配置；
  - Allowed origins: 本地开发使用 `http://localhost:3000`，生产仅列出正式域名。
- 访问密钥仅授予该 bucket 所需对象读写权限；禁止使用账户级全量权限。

### 验证

1. 登录后前往 `/dashboard/campaigns/new`。
2. 上传 JPEG、PNG 或 WebP（最大 20 MB）。
3. 页面应显示可用于 Campaign 的 Product image；数据库 `assets` 产生对应记录。

## Redis / Valkey：视频任务队列

### 必需环境变量

```text
REDIS_URL=redis://...  # 或 rediss://...
```

本项目本地开发已配置 `compose.yaml` 中的 Redis 7 服务，默认地址为 `redis://127.0.0.1:56379`。

### 平台侧配置

- BullMQ 队列使用 Redis/Valkey；Postgres 仍保存业务事实、审批与账本。
- Redis 的 `maxmemory-policy` 设为 `noeviction`，避免队列 key 被淘汰。
- Web Producer 需要快速失败；Worker 使用持续重连。

### 验证

```bash
pnpm worker
```

Worker 会消费 `video-submit` 与 `video-poll` 队列：提交任务后延迟 10 秒轮询 MiniMax 状态。

## MiniMax H3：真实视频生成

### 必需环境变量

```text
MINIMAX_API_KEY
MINIMAX_API_BASE_URL=https://api.minimaxi.com
```

### 平台侧配置

- 使用项目已获授权的 H3 V2 API 账户与模型能力。
- 密钥只在 Worker 环境中保存，绝不发送到浏览器。
- 明确账户额度、并发限制、超时和 API 回调/轮询策略。

### 当前 API 契约

- `POST /v2/video_generation`：使用 `model=MiniMax-H3` 创建异步任务，返回 `task_id`。
- `GET /v2/query/video_generation/{task_id}`：查询 `queued`、`running`、`succeeded`、`failed` 或 `cancelled`；成功时从 `task.content.url` 取得成片。
- 当前实现使用商品图作为 `first_frame`、`ratio=adaptive`、`resolution=768P`。
- H3 时长必须为 4～15 秒；Campaign 表单和服务端校验已同步限制。
- 产物下载地址有时效；Worker 成功后立即流式归档到 COS。

### 验证

创建 VideoJob 后，Worker 保存外部 `task_id`，每 10 秒轮询。成功时归档到 COS；网络错误按队列退避重试；最终失败会保留失败码与原因并将 Campaign 返回 `ready`。缺少 COS 或 MiniMax 配置时，任务会明确失败，不会伪造成成功。

## FFmpeg：三十秒样片拼接

MiniMax-H3 单次生成时长上限为 15 秒。`pnpm sample:30 -- --campaign-id <id>` 会生成两个 15 秒 H3 段落，并用 FFmpeg 重新编码拼接为 30 秒 MP4。

### 必需本地工具

```bash
ffmpeg -version
```

macOS 可通过：

```bash
brew install ffmpeg
```

### 验证

```bash
pnpm sample:30 -- --campaign-id <id>
```

成功后在桌面生成：

```text
/Users/gjy/Desktop/H3-30s-Product-Launch-Sample.mp4
```

未安装 FFmpeg 时，样片脚本会在拼接阶段失败；两个 H3 段落仍会消耗 MiniMax 用量。

## MiniMax M3：动态创意规划（文字 AI）

### 必需环境变量

```text
MINIMAX_API_KEY
MINIMAX_TEXT_API_BASE_URL=https://api.minimaxi.com/v1
MINIMAX_TEXT_MODEL=MiniMax-M3
```

`MINIMAX_API_KEY` 与 H3 共用，但只在服务端调用。文字规划器不读取商品图片；它只接收结构化 SKU Product Brief 和 Brand Kit 快照。

### 当前 API 契约

- 使用 OpenAI 兼容的 `POST /v1/chat/completions`。
- 请求模型固定为 `MiniMax-M3`。
- 文字输出必须是恰好三条结构化假设：`pain`、`benefit`、`scene`。
- 程序必须校验 JSON Schema、批准卖点引用和禁用宣传语后，才能保存假设或编译 H3 Recipe。
- 服务端超时、限流、认证失败和结构化输出失败必须分类显示；未配置时应阻止创意编译，不得生成空卡或通用兜底卡。

### 验证

```text
使用真实 `MINIMAX_API_KEY` 发起最小 Chat Completions 请求；
确认返回模型为 `MiniMax-M3`，并能解析合法 JSON；
不得在日志或浏览器响应中输出 API Key。
```

官方文档：https://platform.minimaxi.com/docs/api-reference/text-chat-openai
## 微信支付 Native：国内 CampaignOrder 主支付渠道

当前市场验证首发对象为中国大陆品牌与电商团队，主渠道暂定微信支付 Native 扫码。支付宝和 Stripe 不进入首发实现。

### 商户侧前置

- 已认证的服务号、政府/媒体公众号、小程序或移动应用 APPID；
- 微信支付商户号，并开通 Native 支付权限；
- 商户号与 APPID 完成授权绑定；
- 商户 API 证书与私钥；
- API v3 密钥；
- 微信支付公钥及公钥 ID，或平台证书。新商户优先使用微信支付公钥模式；
- 可公网访问的 HTTPS 支付通知地址。

### 计划环境变量

```text
WECHAT_PAY_MCH_ID
WECHAT_PAY_APP_ID
WECHAT_PAY_MERCHANT_SERIAL_NO
WECHAT_PAY_MERCHANT_PRIVATE_KEY
WECHAT_PAY_API_V3_KEY
WECHAT_PAY_PUBLIC_KEY_ID
WECHAT_PAY_PUBLIC_KEY
WECHAT_PAY_NOTIFY_URL
```

私钥、API v3 密钥和证书不得进入 Git、客户端或日志。未配置时，系统必须阻止创建付费 CampaignOrder，并明确显示“微信支付尚未开放”；不得回退到旧 Stripe 订阅 Checkout。

### Phase 0 验证

1. 三位中国大陆目标客户确认可接受微信扫码支付；
2. 商户号、APPID 和 Native 支付权限真实可用；
3. 沙箱或一分钱订单完成：下单、二维码、支付回调验签、订单幂等、退款和对账；
4. 记录微信支付 Request-ID，方便支付问题追踪。

官方接入准备：https://pay.weixin.qq.com/doc/v3/merchant/4015614538  
官方证书与密钥：https://pay.weixin.qq.com/doc/v3/merchant/4024350132

## Stripe：旧订阅骨架（首发禁用）

仓库仍保留 starter 的 Stripe 订阅代码，但当前价格页不再读取 Stripe 产品，也不开放旧订阅 Checkout。中国大陆市场验证使用微信支付 Native CampaignOrder；普通注册、Workspace、Brand Kit、Campaign 和创意实验不依赖 Stripe。

```text
STRIPE_SECRET_KEY
STRIPE_WEBHOOK_SECRET
```

当前不需要配置。若未来进入国际市场，必须作为独立的一次性 CampaignOrder 支付适配器重新评估，不能直接恢复旧的按用户订阅页面。

## 日常命令

```bash
# 启动本地数据库与 Redis（首次或服务停止后）
docker compose up -d postgres redis

# 应用 schema 迁移
pnpm db:migrate

# 启动 Web
pnpm dev

# 启动 Worker（Redis 配置完成后）
pnpm worker
```

## 变更记录规则

新增外部条件时，在本文档追加以下内容：

1. 依赖名称与产品功能；
2. 环境变量名称，不记录真实值；
3. 云平台、网络、CORS、IAM 或 webhook 配置；
4. 本地和生产验证步骤；
5. 未配置时的准确降级或错误行为。
