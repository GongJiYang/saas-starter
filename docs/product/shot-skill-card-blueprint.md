# Shot Skill Card：镜头技能卡完整功能蓝图

状态：后续完整功能设想蓝图。第一阶段只实现内部、代码托管、MiniMax H3 单供应商的最小运行时；不得提前建设公开 Skill 市场。

关联文档：

- `docs/product/market-validation-mvp.md`：单 SKU 广告、ShotPlan、ShotVersion 与 AdVersion 合同；
- `docs/product/bulk-sku-production-direction.md`：高 SKU、Pilot、Wave 和止损方向；
- `docs/product/bulk-sku-production-atomic-tasks.md`：第一阶段 `SKILL-01` 至 `SKILL-16` 原子任务；
- `docs/product/future-development.md`：垂直工作流 Skill 的长期边界。

灵感来源：

- SillyTavern Character Design：https://docs.sillytavern.app/usage/core-concepts/characterdesign/
- Character Card V2 Specification：https://github.com/malfoyslastname/character-card-spec-v2/blob/main/spec_v2.md
- SillyTavern World Info：https://docs.sillytavern.app/usage/core-concepts/worldinfo/

## 1. 产品判断

酒馆角色卡的价值不在“保存一段人物 Prompt”，而在于把稳定行为、场景、示例、条件知识、版本和元数据封装成可复用单元。

Shot Skill Card 借用同一思想，但服务于镜头生产：

> 将一个经过验证、可重复、可质检的镜头生产方法封装为版本化配方，并由编译器结合商品事实、品牌规则、创意角度和模型能力生成最终 GenerationRecipe。

Shot Skill Card 不是：

```text
Prompt 收藏夹
风格形容词下拉框
用户可以覆盖系统规则的角色卡
一个完整广告模板
一个模型参数预设
一条生成成功的视频
```

Shot Skill Card 是：

```text
业务镜头目标
+ 适用条件
+ 必需素材
+ 摄影和时间语法
+ 商品与品牌不变量
+ 禁止项
+ 示例
+ 供应商适配
+ 输出质量合同
+ 版本和采用证据
```

## 2. 与现有领域对象的关系

```text
ProductBriefSnapshot
+ BrandKitSnapshot
+ SelectedCreativeAngle
+ HookVariant / SharedBody role
+ ReferenceAnalysis（可选）
+ ShotSkillVersion
──────────────────────────────
→ ShotPlan
→ GenerationRecipe
→ ShotVersion
→ VideoJob
→ QualityAssessment
→ AdVersion
```

职责边界：

```text
CreativeAngle       决定为什么这样表达
HookVariant         决定前五秒测试什么
ShotSkillVersion    决定一个镜头如何执行
ShotPlan            冻结本次镜头目标与输入
GenerationRecipe    冻结给特定供应商的最终执行配方
ShotVersion         记录一次实际生成尝试
QualityAssessment   判断输出是否满足事实、Skill 和 ShotPlan
```

一个 ShotPlan 必须绑定一个明确的 `skillId + skillVersion + skillHash`。重试默认沿用同一版本，不允许在后台悄悄切换 Skill。

## 3. 角色卡概念映射

| Character Card | Shot Skill Card |
|---|---|
| name | Skill 名称和稳定 ID |
| description | 镜头业务目标和适用说明 |
| personality | 摄影机、构图、运动、光线的稳定行为 |
| scenario | 适用广告位置、商品类别和平台场景 |
| first_mes | 默认时间分镜和起始构图 |
| mes_example | 合格与不合格镜头示例 |
| system_prompt | 不允许由卡覆盖；改为平台固定 Prompt 编译优先级 |
| post_history_instructions | 输出 Schema 和最终自检要求 |
| character_book | 条件激活的 Rule Entries |
| tags | 检索、筛选和自动选择候选 |
| character_version | 不可变 Skill 版本 |
| creator / notes | 来源、作者、验证说明，不进入 Prompt |
| extensions | 命名空间隔离的供应商扩展 |

最重要的差异：Character Card V2 允许卡片替换全局 `system_prompt`；本产品禁止 Shot Skill Card 覆盖平台安全、商品事实、Brand Kit 禁止项和成本规则。

### 3.1 永久、临时和条件上下文分层

酒馆社区不会把所有设定塞进一个字段，而是区分：

```text
Description / Personality   永久核心
First Message               启动时的强条件
Example Messages            行为示例
Author's Note               靠近当前输出的强化规则
Lorebook                    满足条件才注入的知识
Creator Notes / Tags        只用于人和系统管理
```

Shot Skill Card 对应为：

```text
permanentCore       镜头目标、摄影语法、不变量和禁止项
startingCondition   第一帧、初始构图和第一个时间 Beat
plannerExamples     已采用的正面 ShotPlan 与带原因的负面案例
finalReinforcement  编译末端再次声明的关键商品不变量
conditionalRules    商品类别、平台、素材和 Shot role 条件规则
metadata            作者、来源、标签、版本和验证证据，不进入 Prompt
```

每个字段必须声明进入 M3 规划、H3 执行、QA 或仅供管理；不能让同一段自由文本同时承担四种职责。

### 3.2 用行为示例代替形容词堆积

Ali:Chat 的核心经验是用对话和动作体现角色，而不是只列性格形容词。镜头 Skill 同样不能依赖：

```text
cinematic
premium
beautiful
viral
high quality
```

规划模型应看到“什么输入产生什么 ShotPlan”的少量高质量示例：

```json
{
  "input": {
    "shotRole": "shared_body",
    "productCategory": "fragrance",
    "durationSeconds": 5,
    "assetRoles": ["primary_product_image", "product_detail_image"]
  },
  "expectedShotPlan": {
    "timeline": [
      "0-2s: reveal one authentic glass detail",
      "2-4s: slowly pull back without changing the product",
      "4-5s: finish on one complete recognizable bottle"
    ],
    "cameraMovement": "slow_pull_back",
    "productCount": 1,
    "mustPreserve": ["bottle shape", "cap geometry", "label placement"]
  }
}
```

负面示例必须带结构化失败原因：

```json
{
  "observed": [
    "introduced a second bottle",
    "changed the original cap",
    "generated unreadable packaging text"
  ],
  "rejectionCodes": [
    "additional_product",
    "product_shape_changed",
    "generated_packaging_text"
  ]
}
```

一个已采用的完整示例优于大量未经验证的 Prompt。MVP 每张卡最多加载一个相关正面示例和一个相关负面示例。

### 3.3 First Message 对应第一帧和启动 Beat

角色卡的 First Message 会建立初始场景、节奏和表达方式。视频中的近似物是：

```text
first_frame / reference_image
+ 0～1 秒启动动作
```

因此 `startingCondition` 是一等字段：

```json
{
  "sourceAssetRole": "primary_product_image",
  "productVisibility": "recognizable",
  "subjectCount": 1,
  "initialMotion": "none",
  "firstBeat": "hold product identity before camera movement"
}
```

第一 Beat 必须先稳定商品身份，再执行相机或场景变化。不能只依靠 Prompt 中一句“保持商品不变”。

### 3.4 Alternate Greetings 对应受控 Hook Variant

角色卡的多个开场可以映射为同一 Skill 的 `openingVariants`：

```text
visual_contrast
detail_curiosity
direct_reveal
```

它们只改变第一个时间段，不改变 Selected Angle、共享主体、批准卖点或 CTA。系统必须记录具体 Variant；不能随机抽取，也不能让重试切换 Variant。

### 3.5 Lorebook 对应确定性 Rule Entries

酒馆 World Info 根据上下文激活相关知识。本产品只借用“按需注入”的思想，不使用自由文本关键词猜测业务事实：

```text
category = fragrance
→ 单瓶、玻璃反射、瓶盖和标签几何规则

category = headphones
→ 左右耳罩、头梁和折叠结构规则

platform = TikTok
→ 前两秒商品可识别和移动端安全区规则

personRights = none
→ 禁止可识别人物、手部和声音
```

事实、安全和授权规则必须通过结构化字段确定性激活。概率触发、正则扫描和向量召回最多用于非阻塞风格建议。

### 3.6 Token 预算和相关性

角色卡实践强调永久上下文会挤占模型能力，示例质量高于数量。完整 Skill Card 不得整张发送给 H3：

```text
M3 规划层：核心规则 + 当前条件规则 + 1 个正例 + 1 个反例
确定性编译层：事实校验、优先级、Schema、资产和约束绑定
H3 执行层：目标 + 时间线 + 相机 + 商品事实 + 保持项 + 禁止项
QA 层：阻塞检查和警告检查
```

作者、版本历史、性能统计、无关行业规则和未激活示例永远不进入 H3 Prompt。

### 3.7 错误结果不能成为正面历史

酒馆 Prompt 指南建议不要让不期望的输出继续留在对话历史中强化错误模式。本产品对应规则：

```text
生成成功 ≠ 合格
QA 通过 ≠ 客户采用
客户采用后才可成为 positive example candidate
被拒绝结果只能成为带原因的 negative example candidate
一次拒绝不能自动修改 Skill 或 Brand Preference
```

正面示例必须同时保存 Product Brief、Skill 版本、ShotPlan、最终 Recipe、输入素材版本、QA 和采用理由，不能只保存 MP4。

### 3.8 可迁移边界

角色卡经验主要来自聊天 LLM，不能假设全部适用于视频模型：

```text
PList 特殊语法不保证适合 H3
Prompt 越靠后不保证对 H3 越强
对话示例不能直接控制视频
Lorebook 注入不保证输出遵守
Character Card system_prompt 不能覆盖平台 Prompt
```

因此完整角色卡语义主要服务 MiniMax-M3 规划层；H3 只接收精简执行指令。所有迁移结论必须通过同素材、同参数 A/B Benchmark，而不是依赖社区经验直接定案。

## 4. Prompt 编译优先级

发生冲突时使用固定优先级：

```text
1. 平台安全和授权规则
2. Product Brief 事实与证据
3. Brand Kit 必现、禁用和不可改变元素
4. 已批准 Creative Spec 与 ShotPlan
5. Shot Skill Card 不变量和执行语法
6. 已批准 Reference Analysis 结构属性
7. 供应商适配参数与 Prompt 片段
```

下层只能补充，不能取消上层约束。

编译器必须输出 `CompilationTrace`，逐项记录：

```text
最终字段
来源对象
来源版本
是否被覆盖
覆盖它的上层规则
未采用规则及原因
最终 Prompt 哈希
```

用户不需要查看原始 Prompt，但运营和故障排查必须能解释最终配方来自哪里。

Prompt 和 Recipe 哈希只使用规范化稳定输入：Asset ID、对象存储 key、Asset 版本、事实快照、Skill 内容和确定性排序。签名 URL、当前时间、外部 task_id、数据库自增执行 ID 和请求追踪字段不得进入哈希，否则相同输入无法复现。

## 5. 完整卡片 Schema

```ts
type ShotSkillCard = {
  spec: 'shot_skill_card';
  specVersion: '1.0';
  id: string;
  version: string;
  name: string;
  description: string;
  status: 'draft' | 'testing' | 'active' | 'deprecated' | 'retired';
  scope: 'official' | 'workspace_private';

  goal: string;
  shotRoles: Array<'hook' | 'shared_body' | 'proof' | 'hero' | 'transition'>;
  tags: string[];

  eligibleWhen: EligibilityRule;
  requiredInputs: RequiredInput[];
  optionalInputs: OptionalInput[];

  cameraGrammar: CameraGrammar;
  compositionGrammar: CompositionGrammar;
  lightingGrammar: LightingGrammar;
  motionGrammar: MotionGrammar;
  timeline: TimelineBeat[];

  invariants: Constraint[];
  forbidden: Constraint[];
  fallbacks: FallbackRule[];

  promptFragments: PromptFragment[];
  examples: SkillExample[];
  ruleEntries: ConditionalRuleEntry[];

  outputContract: OutputContract;
  qualityChecks: QualityCheck[];
  providerAdapters: Record<string, ProviderAdapter>;

  provenance: Provenance;
  validationEvidence: ValidationEvidence;
  extensions: Record<string, unknown>;
};
```

### 5.1 标识和版本

```text
id            永不改变的 slug，例如 product-macro-reveal
version       语义版本，例如 1.2.0
specVersion   卡片文件格式版本
skillHash     规范化卡片内容的 SHA-256
status        生命周期状态
scope         官方或 Workspace 私有
```

发布后的 `ShotSkillVersion` 不可原地修改。任何行为变化都创建新版本。

### 5.2 EligibilityRule

条件必须基于结构化字段，不扫描自由文本猜测：

```text
商品类别
Shot role
平台
比例和时长
图片数量和类型
是否有人物授权
是否有演示证据
是否有可读包装文字
Reference mode
模型能力
```

示例：

```json
{
  "all": [
    { "field": "shotRole", "in": ["hook", "shared_body"] },
    { "field": "detailImageCount", "gte": 1 },
    { "field": "durationSeconds", "in": [4, 5] }
  ],
  "none": [
    { "field": "productCategory", "in": ["service", "software"] }
  ]
}
```

不满足 Eligibility 的卡片不能被用户强制入队，只能先补齐资料或改用其他 Skill。

### 5.3 RequiredInput

每个输入声明：

```text
输入类型
最少和最多数量
授权要求
分辨率和 MIME
在 Prompt、参考图或 QA 中的用途
缺失时是否阻塞
```

例如 `product-macro-reveal` 至少需要一个主图和一个细节图；只有主图时应降级到 `product-hero`，不能假装存在材质细节。

### 5.4 摄影和时间语法

卡片必须结构化表达：

```text
景别
构图
相机运动
焦点对象
景深
光线方向和强度
背景复杂度
主体占画面比例
每个时间段的动作
结束帧要求
```

禁止仅保存：

```text
cinematic
premium
beautiful
viral
high quality
```

这类形容词可以作为辅助片段，但不能替代可执行语法。

### 5.5 不变量、禁止项与 Fallback

不变量示例：

```text
只出现一个商品
商品形态、包装颜色和 Logo 位置不变
商品在移动端始终可辨认
不让模型生成需要可读的字幕
```

禁止项示例：

```text
额外商品
无授权人物和手部
包装文字重绘
爆炸、融化或形变效果
遮挡商品主体的粒子
```

Fallback 必须显式：

```text
缺细节图 → 改用 product-hero
人物授权缺失 → 改用无人物使用暗示
参考视频解析失败 → 忽略参考结构并要求重新审批
模型不支持结束帧 → 使用静态英雄帧做程序转场
```

Fallback 不能悄悄改变 Creative Angle 或批准卖点。

### 5.6 PromptFragment

Prompt 片段带有明确位置和用途：

```ts
type PromptFragment = {
  id: string;
  purpose: 'goal' | 'camera' | 'timeline' | 'constraint' | 'output';
  order: number;
  text: string;
  includeWhen?: EligibilityRule;
  maxTokens?: number;
};
```

片段必须经变量白名单渲染；不允许 `eval`、任意模板执行或从用户字段生成系统角色消息。

### 5.7 Examples

示例分为：

```text
positive  合格执行样例
negative  常见失败及拒绝原因
boundary  接近适用边界的样例
```

示例元数据必须记录商品类别、输入条件和结果，不直接携带未授权商品素材。运行时只选择最相关的少量示例，避免永久占用 Prompt Token。

### 5.8 ConditionalRuleEntry

借鉴 Lorebook，但使用确定性条件：

```ts
type ConditionalRuleEntry = {
  id: string;
  enabled: boolean;
  priority: number;
  activateWhen: EligibilityRule;
  content: {
    invariants?: Constraint[];
    forbidden?: Constraint[];
    promptFragments?: PromptFragment[];
    qualityChecks?: QualityCheck[];
  };
};
```

示例：

```text
category = fragrance
→ 单瓶、玻璃反射、瓶盖和标签几何规则

category = headphones
→ 左右耳罩、头梁、折叠结构和佩戴方向规则

platform = TikTok
→ 前两秒商品可识别和移动端字幕安全区规则
```

V1 不实现递归触发、概率触发、正则扫描和向量召回。未来即使支持，也不能用于事实和安全约束。

## 6. 运行时

```text
1. 接收 approved ShotPlan
2. 根据结构化条件寻找 eligible Skill
3. 选择明确版本
4. 校验 RequiredInput
5. 合并 Product Brief、BrandKit、Creative Spec、Skill 与 Reference
6. 解决优先级冲突
7. 编译 provider-neutral Recipe
8. 通过 Provider Adapter 生成 MiniMax H3 请求
9. 冻结 skillId、version、hash、CompilationTrace 和最终 Prompt
10. 执行 VideoJob
11. 按 Skill qualityChecks 评估
12. 记录采用、拒绝、成本和重试
```

同一 ShotVersion 只能对应一个 Skill 版本。新 Skill 版本必须创建新的 ShotVersion 或新 ShotPlan 版本。

### 6.1 规划模型与执行模型分工

完整卡片由 MiniMax-M3 规划器读取：

```text
业务目标
Eligibility 结果
当前激活 Rule Entries
一个相关正面示例
一个相关负面示例
Product Brief
Brand Kit
Creative Spec
```

M3 只返回结构化 ShotPlan，不直接决定事实和资产：

```json
{
  "shotRole": "shared_body",
  "skillId": "product-macro-detail",
  "skillVersion": "1.0.0",
  "timeline": [],
  "camera": {},
  "invariants": [],
  "forbidden": [],
  "approvedClaimIds": [],
  "assetIds": [],
  "riskNotes": []
}
```

确定性编译器随后验证批准卖点、Asset ID、授权、上层约束和 Skill 版本。验证失败不得调用 H3。

### 6.2 H3 最终执行 Prompt

H3 Prompt 只保留可执行内容，并使用固定段落顺序：

```text
Goal
Timeline
Camera
Approved product facts
Preserve exactly
Never show
Output contract
```

示例：

```text
Create one 5-second 9:16 product shot.

Goal:
Reveal one authentic product detail, then resolve to a recognizable full product.

Timeline:
0-2s: Hold a macro view of the supplied bottle edge.
2-4s: Slowly pull back without changing the product.
4-5s: Finish on one complete, centered bottle.

Camera:
Controlled studio macro, slow pull-back, no rapid movement.

Approved product facts:
Use only the supplied product.

Preserve exactly:
Bottle geometry, cap, glass color, label placement.

Never show:
Additional bottle, generic packaging, readable generated text, floating objects.

Output:
One continuous shot, product clearly recognizable at the end.
```

### 6.3 推荐代码边界

```text
lib/shot-skills/
├── schema.ts
├── registry.ts
├── eligibility.ts
├── compiler.ts
├── compilation-trace.ts
├── cards/
│   ├── product-hero.ts
│   ├── product-macro-detail.ts
│   └── product-use-case.ts
└── providers/
    └── minimax-h3.ts
```

推荐入口：

```ts
compileShotRecipe({
  productBrief,
  brandKit,
  creativeSpec,
  shotPlan,
  skill,
  referenceAnalysis,
})
```

返回：

```text
skill id / version / hash
provider-neutral recipe
MiniMax H3 request
quality checks
CompilationTrace
recipe hash
```

## 7. 首批官方卡片

完整蓝图允许扩展，但第一阶段只做三个内部卡片。

### 7.1 product-hero

目标：稳定呈现一个完整商品，建立品牌和商品识别。

```text
适用：Hook 或共享主体
需要：主图
运动：静态、慢推进或小幅环绕
核心 QA：单商品、完整轮廓、Logo 和颜色
```

### 7.2 product-macro-detail

目标：用真实细节和材质建立品质感。

```text
适用：有细节图的实物商品
需要：主图 + 至少一张细节图
运动：微距到中近景、受控焦点转移
核心 QA：细节来自输入素材、无虚构结构、无额外商品
```

### 7.3 product-use-case

目标：展示商品在批准场景中的使用价值。

```text
适用：有合法使用场景且不依赖未经批准功效证明
需要：主图、场景说明；人物出现时需要授权
运动：场景建立后回到商品主体
核心 QA：场景不改变商品、不发明效果、不加入未授权人物
```

CTA 尾卡继续程序确定性合成，不建立生成式 Skill。

## 8. 示例卡片

```json
{
  "spec": "shot_skill_card",
  "specVersion": "1.0",
  "id": "product-macro-detail",
  "version": "1.0.0",
  "name": "商品微距细节",
  "description": "通过真实材质细节建立品质感",
  "status": "testing",
  "scope": "official",
  "goal": "Reveal one authentic product detail before resolving to a recognizable product frame.",
  "shotRoles": ["hook", "shared_body"],
  "tags": ["macro", "detail", "physical-product"],
  "eligibleWhen": {
    "all": [
      { "field": "detailImageCount", "gte": 1 },
      { "field": "durationSeconds", "in": [4, 5] }
    ]
  },
  "requiredInputs": [
    { "type": "primary_product_image", "min": 1, "max": 1, "blocking": true },
    { "type": "product_detail_image", "min": 1, "max": 3, "blocking": true }
  ],
  "optionalInputs": [],
  "cameraGrammar": {
    "shotSize": ["macro", "medium_close_up"],
    "movement": ["slow_push_in"],
    "focus": "approved_product_detail"
  },
  "compositionGrammar": {
    "subjectCount": 1,
    "productLegibility": "required_at_end"
  },
  "lightingGrammar": {
    "style": "controlled_studio",
    "preserveProductColor": true
  },
  "motionGrammar": {
    "speed": "slow",
    "noObjectTransformation": true
  },
  "timeline": [
    { "from": 0, "to": 2, "action": "show one authentic detail" },
    { "from": 2, "to": 4, "action": "reveal the unchanged product form" },
    { "from": 4, "to": 5, "action": "finish on a recognizable hero frame" }
  ],
  "invariants": [
    { "code": "single_product", "value": true },
    { "code": "preserve_shape", "value": true },
    { "code": "preserve_label", "value": true }
  ],
  "forbidden": [
    { "code": "additional_product", "value": true },
    { "code": "generated_text_overlay", "value": true }
  ],
  "fallbacks": [
    { "when": "detail_image_missing", "useSkill": "product-hero" }
  ],
  "promptFragments": [],
  "examples": [],
  "ruleEntries": [],
  "outputContract": {
    "durationSeconds": [4, 5],
    "ratios": ["9:16"],
    "productVisibleAtEnd": true
  },
  "qualityChecks": [
    { "code": "single_product", "severity": "blocking" },
    { "code": "product_shape_preserved", "severity": "blocking" },
    { "code": "skill_timeline_followed", "severity": "warning" }
  ],
  "providerAdapters": {
    "minimax-h3": {
      "resolution": "768P",
      "promptTemplateVersion": "1"
    }
  },
  "provenance": {
    "creator": "internal",
    "source": "validated_workflow"
  },
  "validationEvidence": {
    "benchmarkRuns": 0,
    "adoptedOutputs": 0
  },
  "extensions": {}
}
```

示例仅表达完整蓝图，第一阶段 Schema 应删除未使用字段，不为未来兼容提前实现空抽象。

## 9. 数据模型完整设想

后续需要持久化时使用：

```text
ShotSkill
├── stable id
├── ownerTeamId nullable（官方卡为空）
└── currentActiveVersionId

ShotSkillVersion
├── immutable normalized definition
├── semantic version
├── hash
├── status
├── author and provenance
└── publishedAt

ShotSkillBinding
├── ShotPlan
├── ShotSkillVersion
├── selection reason
└── CompilationTrace

ShotSkillBenchmarkRun
├── fixtures
├── model and provider
├── baseline recipe
├── skill recipe
├── cost and latency
└── QA / review result

ShotSkillPerformanceStat
├── skill version
├── product category
├── attempts
├── QA pass rate
├── adoption rate
├── retry rate
└── usable output cost
```

第一阶段不建这些表；使用代码托管卡片，并在现有 ShotPlan / GenerationRecipe 快照中保存 ID、版本、hash 和编译结果即可。

## 10. 生命周期

```text
draft
→ testing
→ active
→ deprecated
→ retired
```

晋升规则：

```text
draft → testing        Schema 和静态规则通过
testing → active       真实基准和人工审批达到门槛
active → deprecated    有明确后继版本或质量下降
deprecated → retired   无运行中的 Campaign 依赖且保留只读审计
```

禁止删除已被 GenerationRecipe 引用的版本。

## 11. 作者与分发

未来支持：

```text
官方 Skill
Workspace 私有 Skill
从已采用镜头创建私有草稿
从自有参考视频创建私有草稿
JSON 导入和导出
团队内复制与版本分叉
```

暂不支持：

```text
匿名公开上传
跨团队公开市场
自动执行第三方脚本
卡片覆盖系统 Prompt
卡片携带远程依赖
未经审核自动成为 active
```

导入文件视为不可信数据，必须进行 Schema、大小、字段、变量、URL、版权声明和命名空间校验。未知 `extensions` 可保留，但不得进入 Prompt 或执行路径。

## 12. 从参考视频生成卡片

```text
用户上传有权使用的视频
→ Reference Analysis 提取镜头边界、节奏、构图和字幕区
→ 生成 Workspace 私有 draft Skill
→ 显示借用与排除内容
→ 用户审批
→ 用真实 SKU Benchmark
→ 达标后进入 testing 或 active
```

不得提取或复制：

```text
第三方 Logo
人物身份和声音
原脚本
原音乐
水印
标志性角色和布景
```

Reference Analysis 生成的是结构草稿，不是成功保证。

## 13. 与批量 SKU 的集成

Shot Skill Card 在批量流程中提供稳定执行单元：

```text
CatalogItem readiness
→ Creative Spec 选择镜头角色
→ 系统为每个 ShotPlan 选择 eligible Skill
→ Pilot 冻结 Skill 版本
→ 后续 Wave 沿用同版本
→ QA 汇总 Skill 级失败率
→ 达到止损阈值暂停 Batch
```

同一 Production Batch 默认锁定 Skill 版本，避免 Pilot 和正式 Wave 使用不同镜头行为。切换 Skill 版本必须使成本确认和相关 Creative Spec 审批失效。

## 14. 反馈与优化

每个结果记录：

```text
Skill ID / version / hash
商品类别
镜头角色
模型和参数
输入素材完整度
QA 结论
结构化拒绝原因
是否进入 AdVersion
是否被采用
重试次数
成本和耗时
```

优化原则：

- 不因一次拒绝自动修改 Skill；
- 技术失败不等于 Skill 失败；
- 商品事实错误优先修数据或 QA；
- 多个客户重复出现同一镜头问题才创建后继版本；
- 新版本先走 Benchmark 和 Pilot，不直接替换运行中版本；
- 采用率必须结合商品类别和素材完整度，不能只看全局平均。

## 15. 安全边界

Shot Skill Card 永远不能：

```text
覆盖商品事实
放宽授权要求
删除禁止表达
禁用商品一致性检查
提高重试或成本上限
改变账务规则
访问任意 URL
执行脚本
生成额外系统角色消息
读取其他 Workspace 资产
```

Prompt 注入防护：

```text
用户文本只进入声明过的变量槽
变量按纯文本编码
模板字段白名单
最终 Prompt 长度上限
系统和用户来源分离
卡片内容无工具调用能力
CompilationTrace 保留来源
```

## 16. 完整功能 UI 设想

### Skill Library

```text
名称和版本
官方 / 私有
适用类别和 Shot role
需要素材
状态
QA 通过率
采用率
平均可用镜头成本
最后验证时间
```

### Skill Detail

```text
业务目标
摄影和时间语法
必需素材
不变量和禁止项
Fallback
示例
Provider Adapter
版本历史
Benchmark
采用和拒绝原因
```

### Skill Builder

不直接展示一个巨大 Prompt 文本框。编辑器按结构化区域组织，并提供：

```text
Schema 校验
条件预览
Prompt 编译预览
冲突解释
Fixture 运行
版本差异
发布审批
```

### Campaign / Batch

用户看到 Skill 名称、版本和选择理由；普通用户不需要编辑 Prompt。运营人员可以查看 CompilationTrace 和 QA 结果。

## 17. 第一阶段 MVP

目标：证明“结构化镜头卡 + 编译器”比当前字符串拼接 Prompt 更稳定，不建设通用平台。

只实现：

```text
三个内部卡片：product-hero、product-macro-detail、product-use-case
代码仓库内的精简 JSON / TypeScript 定义
Zod Schema
确定性 Eligibility
固定 Prompt 优先级
MiniMax H3 单供应商编译器
ShotPlan 绑定 skillId / version / hash
GenerationRecipe 冻结编译结果
基础 Skill QA checks
同 SKU、同素材、同参数 A/B Benchmark
```

明确不做：

```text
数据库 Skill 表
用户创建或编辑 Skill
Skill Library UI
JSON 导入导出
公开市场
Workspace 私有 Skill
动态 Lorebook
向量召回
递归和概率触发
多供应商 Adapter
自动从参考视频发布 Skill
自动根据拒绝修改 Skill
```

MVP 验收：

```text
三个卡片均通过 Schema
不合格输入无法选择对应 Skill
相同输入编译得到相同 Prompt 和 hash
上层商品 / BrandKit 规则无法被 Skill 覆盖
ShotPlan 和 GenerationRecipe 可追溯 Skill 版本
重试不切换 Skill
同一组真实 SKU 完成 baseline vs Skill A/B
至少一个核心指标改善，且其他阻塞指标不退化
```

核心指标：

```text
商品一致性通过率
镜头结构符合率
首次可用率
平均重试次数
单位可用镜头成本
Prompt Token 或字符数
```

如果 Skill 方案只让 Prompt 更复杂，却没有提高可用率、稳定性或可解释性，则停止扩展，不建设完整 Skill 系统。

## 18. 后续路线

```text
阶段 1  内部三个卡片与 H3 编译器
阶段 2  不可变数据库版本、Benchmark 和运营内部 Library
阶段 3  Workspace 私有卡片、从已采用镜头或参考视频创建草稿
阶段 4  条件 Rule Entries、更多行业卡片和受控 Provider Adapter
阶段 5  团队内导入导出与版本分叉
阶段 6  只有真实采用和治理能力成熟后评估公开市场
```

每一阶段都必须由采用率、QA 通过率、重试率和单位可用成本证明，不按卡片数量衡量进度。
