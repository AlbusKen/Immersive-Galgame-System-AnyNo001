# 生图配置与架构

## 0.36.88 本地迁入草稿

本节是 PR #8 功能迁入后的当前行为；下文保留的早期流程描述在冲突时以本节和模块 CONTRACT 为准。三方审核、冲突决定和验证边界见 [迁入记录](PR8_PORT_REVIEW_20261016.md)。此版本未提交或发布。

- 内置 NAI 按活动提示词预设、任务与输出格式装配写词。图像来源页提供提示词管理；画师库位于「生图与AI → 画师与模型」，独立于当前图像来源管理。提示词草稿与预览不参与生成，保存和明确激活后才生效。默认框架版本 31，新增身份与衣装使用英文 TAG 及核心权重规则，升级保护自定义内容和已有资料；预览不扫描世界书，provided 任务也不扫描。
- 画师库负责新建、编辑、删除和导入；内置生图直接从原生下拉框选择全局或各分类的画师，无需跳页或再次点击应用。选择分类条目会开启分区画师，选择「使用全局画师」清除该分类覆盖；保存后供新任务使用，在途任务保留原配置。库管理及持久数据继续沿用现有端口，不新增存储或生图服务。旧通用负面词仅归档停用，任务负向与明确选用的画师负向仍有效。
- 已有旧 DNA 保留。角色 DNA 区「启用内置三景别 DNA」明确确认后为该角色登记 version 2，保留旧文字和图片；后续内置立绘可补齐景别。外部来源把已有资料按用途转成文字设定要求。旧原装图自动接入命名衣装，基础图与表情分别保留，默认映射继续显示原图。
- 衣装说明、图片和默认选择分别保存。剧情 CG 可生成当次衣装候选，用户采用后才登记；采用失败复用已有图片，不自动再发。普通 CG、表情及衣装任务的资料边界见 [身份与衣装协议](OUTFIT_DNA_PROMPTS.md)。
- 内置 NAI 请求排队并校验 PNG/ZIP；仅 429 自动重试，最多三次发送。408、5xx、网络异常和空/坏返回不自动补发。其它图源保留当前重试策略；本地取消等待不代表上游已经停止。
- 三景别、占位符与定稿模板是内置 NAI 私有协议。DBGen 始终通过已有公开 API 使用自己的预设、上下文、召回、LLM 和出图配置；IGS 的 DNA/衣装经 description 附带纯文本设定及明确用途，不要求新接口，不改写插件返回的完整 caption。未开启可选 DNA 建档时，缺少景别不阻断外部任务。柏宝绘和智绘姬保留各自来源行为，内置 CG 一致性模板重绘只属于内置 NAI。
- CG 库增加一致性重绘的进度、候选和明确接受，失败/取消保留原图。它沿用中央媒体缓存、WAL、文件卸载、原子 revision 和引用回收，见 [一致性与存储边界](IGS_WARDROBE_CONSISTENCY.md)。
- 副 LLM 仍经过当前酒馆同源后端、CSRF 与凭据隔离；不恢复浏览器直连后备。选择 DBGen 不由 IGS 副 LLM 接管写词。真实酒馆、手机、实际模型输出和实际加载的外部插件未联调，不以本地构建或 fake provider 结果替代。

## 外部立绘的可选 DNA 建档

「生图与AI → 图像来源」的「外部生图前补齐角色 DNA（使用备用模型）」默认关闭，配置为 `bridge.imageApi.externalSpriteDna`。关闭时不增加副 API 请求；开启时，自动缺图先经 IGS「备用模型」与内置 DNA 资料任务建立缺失的三景别身份和独立性格，独立保存后才继续外部写词/出图。资料任务中附带的衣装候选不作为本次衣装设计保存或强加给外部。

游戏进行中的本轮缺 DNA 角色合并为一次副 API 请求，共享同一份正文与设定；不会每人发一次，也不按外部立绘的出图批次拆分 DNA。已有 DNA 不进入模型输入，主名/别名合并；整批回复核对全部角色及槽号、保留已有资料后才开始保存。不同楼层重叠的角色共享在途建档，其余新角色立即合并请求；不因等待共享角色而串行排队。

配置页手动生成立绘、衣装/表情或头像，缺 DNA 时明确询问是否补齐并继续，取消后可在「素材 → 角色立绘 → 角色设定」手动填写。旧格式 DNA 继续复用；已有景别、性格空值和主动清空的身份不覆盖。DNA/配置保存或副 API 请求失败不继续出图，切卡、编辑角色及切换开关使旧任务失效。同一角色并发补档只请求一次；DNA 成功而图片失败时，后续补图复用资料。保存按原库归属，已打开的设置草稿同步单角色 DNA，关面板不把资料覆盖回旧值。

这个开关提供稳定角色参考，不替代 DBGen 的上下文、召回、预设、LLM 或最终提示词，也不要求外部插件支持内置占位符。开关只约束立绘相关入口，普通 CG 保留外部原链路。

外部写词收到的是分角色的普通文字。新 DNA 的请求由程序选定本次景别、性格及当前衣装；旧 `identity`、`defaultAppearance`、`triggerWords`、`negative` 留在本地，当前衣装缺省时也按这条规则处理。文案直接描述要画出的取景、姿态、表情和穿着，以及资料进入哪个提示词部分。实际发送内容没有新旧优先级、JSON 或内置占位符协议说明。

正向文案逐项写明目标：半身的上下画面边界与完整发顶/肩/躯干、头肩躯干一起正对镜头、稳定站姿与双手轻微动作、双手按所列动作安排/物件位于身体两侧及躯干/衣装清晰可见、轮廓外透明区域；显式全身/头像景别继续按指定范围取景。头像主体由完整头、颈和双肩组成，下缘落肩线。角色资料按姓名逐人绑定，每图选取一份匹配取景的外貌，外貌和该图衣装在情绪变化中保持一致，交付为当前来源约定字段的完整绘图提示词。这些是写词请求中明确交付的目标，定向检查核对实际请求内容，真实模型遵循程度仍未验证。

| 资料 | 写词要求 |
| --- | --- |
| 景别外貌 `subject` | 写入本人正向，按本图取景描写可见特征；英文标签和权重保留，中文准确转为绘图标签。 |
| 景别 `negative` | 写入本人负向；使用整图负向格式的来源统一写入整图负向。 |
| `personality` | 结合指定情绪设计表情、眼神与动作。 |
| 当前 `outfit` | 名称与说明用于本次穿着；自动素材请求使用本次触发的衣装。 |

立绘/表情取半身 DNA，头像取头像 DNA；目标景别缺省时在现有新视图内取可用资料并说明本次可见范围，保持原来的出图职责和建档开关。CG 按每图取景选用。原有格式的独立生成入口仍读取自身资料，发送时用普通字段标题说明用途。智绘姬/柏宝绘由 IGS 副 API 消费同一文字资料，资料只出现一份；其出图接口继续接收成品提示词。真实模型输出与实际外部插件联调尚未运行。

本轮 R3、产物同步 R4：外部请求/建档定向 38 项、描述调用方 8 项、其它来源写词与旧新 DNA 兼容 5 项，涵盖新视图与旧字段并存、衣装缺省、按景别采用、完整权重、正向目标进入请求及外部成品保留。沿用既有模块和接口，版本保留 0.36.88 本地未提交状态；真实模型/插件遵循程度留到实际使用阶段核对。本机证据目录为 `/tmp/igs-positive-meaning-20261017-9mvmnr07/`。

## 分层

```text
prompts
├── prompt context          # 通用场景变量
├── prompt preset           # 用户可切换的提示词意图
└── prompt adapter          # 选择对应 request builder

generated-images
├── request builder         # 转成模型专属请求
├── provider                # 发请求、轮询、解析返回
└── generation queue        # 管理生成任务状态
```

## 边界

- Provider 负责网络请求、轮询和返回解析。
- Request Builder 负责模型专属请求结构。
- Prompt Preset 负责用户想表达的风格、变量和模板。
- Provider Preset 负责 endpoint、模型、工作流、轮询参数和 provider 专属配置。

## 预留 provider 类型

- `nai`
- `comfyui`
- `gpt-image`
- `banana`
- `custom`

## 预设类型

- `prompt-preset`
- `image-provider-preset`
- `image-request-builder-preset`
- `workflow-preset`

ComfyUI 这类工作流型 provider 应使用 `workflow-preset` 或 provider 专属 preset 保存工作流配置。

## 自动插图（本地草稿，尚未经真实酒馆验收）

独立于既有 `bridge.imageApi`。图像设置中的 NSFW 与过场开关默认均关闭，全部关闭时服务在读取消息、规划、写回和联网之前返回 `disabled`。仅处理当前聊天最新 AI 楼层：有 `[igs-scene:...|NSFW]` 时只走 NSFW 分支，开启后按 `nsfwCount` 精确规划；关闭时不借过场概率生成。非 NSFW 楼层仅在过场开关开启且 `random()*100 < interludeProbability` 时，规划 1～`interludeMaxCount` 张。

流程：监听 AI 楼层渲染事件 → 以聊天、楼层及 swipe 身份去重并记录决策 → 从正文编号段落，读取最多 `llm.contextFloors` 个先前 AI 楼层作为参考 → 副 LLM 返回每张图的 `slot`、`at` 与 `scene/scene_uc/char/char_uc` tags → 校验数量和位置 → 仅在原文仍一致时插入 `[igs-img:1]`、`[igs-img:2]` 等定位标记 → 串行向 NovelAI 官方接口生图 → 记录 tag、状态及图片并通知阅读器刷新。插图图片覆盖当前段落背景并隐藏立绘；NSFW 图片未就绪或失败时维持黑幕，遇新场景标签终止此前插图。显示正文、发给主模型的上下文剥离标记，原始消息仍保留供定位；不要求主模型输出该标记。

存储为 IndexedDB `igs-illustrations`（版本 1），`floors` 和 `slots` 两个 store；楼层键 `${chatId}|${messageId}|${swipeId}`，图片键 `${floorKey}|${slot}`。`pending/done/failed` 记录使刷新后可异步恢复图片；当前无容量清理与手动失败重试。开关启用后副 LLM 或 NovelAI 的真实请求会消耗各自额度，请勿把 API Key 放入日志或聊天文本。

| 设置路径（前缀 `bridge.autoIllustration.`） | 默认值 | 作用 |
| --- | --- | --- |
| `nsfwEnabled` / `nsfwCount` | `false` / `1` | NSFW 场景开关与每层张数（1～16） |
| `interludeEnabled` / `interludeProbability` / `interludeMaxCount` | `false` / `30` / `1` | 过场开关、百分比（0～100）、最多张数（1～16） |
| `llm.source` / `llm.endpoint` / `llm.apiKey` / `llm.model` | `tavern` / 空 / 空 / 空 | `tavern` 使用当前酒馆 API；`openai` 使用独立兼容接口及凭据 |
| `llm.contextFloors` / `llm.timeoutMs` | `1` / `90000` | 参考 AI 楼层数（0～3）与规划超时毫秒 |
| `nai.transport` / `nai.apiKey` | `direct` / 空 | 浏览器直连或 `st-proxy`（酒馆需开启 `enableCorsProxy`）；未填 Key 不请求 |
| `nai.model` / `nai.size` | `nai-diffusion-4-5-full` / `832x1216` | 官方模型与尺寸 |
| `nai.steps` / `nai.scale` | `28` / `5` | 步数（1～50）与 CFG（0～10，可小数） |
| `nai.sampler` / `nai.noiseSchedule` | `k_euler_ancestral` / `karras` | 采样器和固定噪声调度（后者暂不在面板编辑） |
| `nai.artistPrefix` / `nai.negativePrompt` | 空 / 内置负面提示词 | 正向前缀及可编辑负面提示词 |
| `nai.timeoutMs` | `120000` | 图片请求超时毫秒（暂不在面板编辑） |

验证边界：本地 fake host、fake provider 和模拟阅读器只检查契约；实际 TavernHelper `generateRaw` / 正则 API、NAI 直连及代理 CORS、真实 IndexedDB、刷新后的宿主聊天 DOM、swipe 切换和手机大图性能须在酒馆中验证，不以本地测试替代。


## 素材补全（无名角色立绘 / 缺失场景背景）

自动素材补全独立于既有用户上传素材区。当前实现支持在阅读器解析到缺失场景背景或无名角色立绘时，根据设置规划生成任务；所有相关开关默认关闭，关闭时服务在规划、写回和网络请求前返回 `disabled`，不会向副 LLM 或 NovelAI 发请求。

素材解析优先级为：用户上传区 → 生成区素材库 → 本聊天临时素材 → 占位。普通匹配允许弱模糊结果；开启 `bridge.autoIllustration.assets.strictMatch` 后，弱模糊结果按未命中处理，但生成期间仍保留弱命中或默认占位，避免阅读器出现空白。场景名、别名和强模糊命中可以直接使用，不重复生成。

生成素材分为本聊天临时记录和生成区素材库：楼层完成后，阅读器可以显示审核卡片；用户可确认入库、改名、删除或丢弃。入库条目写入 `bridge.sceneAssets.generated`，与手动上传的 `bridge.sceneAssets` 素材分开保存；设置页的「场景 → 生成素材」子标签管理生成区条目和本聊天未入库条目。

立绘透明底策略为：provider 返回原生透明图时直接保留 alpha；非透明图使用本地浅灰底连通区域抠图兜底。该抠图策略只移除与画面边缘连通的浅灰区域，不保证对浅灰或银色角色服饰、头发在真实模型输出下完全无误，需在真实酒馆中复验。

生成图不把二进制数据写入设置。IndexedDB 使用数据库 `igs-generated-assets`、版本 `1`，store 为 `images`、`assets`、`floors`；阅读器和设置页使用 `igs-gen:<id>` 形式的图片地址，再由生成素材服务解析为本地对象 URL。楼层身份同时包含 `chatId`、`messageId` 和 `swipeId`，格式为 `${chatId}|${messageId}|${swipeId}`。

为降低请求被拦截的概率，生成流程使用温和模式，并在本地组合 `nsfwExtra`；背景生成失败时可以回退到内置场景词典，避免因单次请求失败清空阅读器背景。API Key 只用于实际请求，不应进入日志、异常文本、快照或聊天输出。

相关设置路径为：

| 设置路径 | 作用 |
| --- | --- |
| `bridge.autoIllustration.assets.spriteEnabled` | 开启无名角色透明/抠图立绘补全 |
| `bridge.autoIllustration.assets.backgroundEnabled` | 开启缺失场景背景补全 |
| `bridge.autoIllustration.assets.strictMatch` | 将弱模糊场景命中视为未命中并允许生成 |
| `bridge.autoIllustration.assets.maxPerFloor` | 单个楼层最多生成的立绘数量（1～16，默认 2）。背景按本楼尚未生成的场景各出一张，不受这个上限限制 |
| `bridge.autoIllustration.assets.spriteSize` / `backgroundSize` | 立绘和背景生成尺寸 |
| `bridge.autoIllustration.assets.templates.background` / `templates.sprite` | 背景和立绘提示词模板 |

### 手动补全与失败重试

阅读器工具栏新增「生图」（手动生图）按钮，仅补全当前聊天最新 AI 楼层缺失的背景和立绘。先在设置中开启场景素材、自动背景或自动立绘，并配置自动插图区的 NovelAI Key；保存设置后打开最新 AI 楼层、展开工具栏即可点击，不必等待下一条 AI 回复。

按钮复用 `generatedAssets.processMessage(messageId, { manual: true })`，仍使用 `bridge.autoIllustration` 的副 LLM、NAI 和素材存储；不走旧 `bridge.imageApi`，也不重试自动 CG 插图。手动操作仅绕过楼层 `done` 去重，不绕过功能开关、楼层身份和素材匹配；已有素材不重复生成。

生成失败的楼层保存为 `failed` 并返回失败结果，后续可重新处理，不再因误标 `done` 永久跳过。按钮开始、完成、失败及跳过原因会显示在阅读器提示和现有生图日志中；聊天或 swipe 已切换时提示重新打开最新楼层。

升号前素材测试 15/15、手动入口模拟 3/3、完整 `npm test` 390/390、`npm run simulate` 135/135、`npm run build` 和 `npm run perf` 均通过（退出码 0）。合并魔法棒改动并升至 `v0.29.3` 后，重新构建 bundle、版本化自动更新 loader，完整 `npm run gate` 通过（退出码 0，含魔法棒独立回归，模拟 135/135）。真实 TavernHelper 事件、NovelAI Key/额度、直连或代理 CORS、IndexedDB 与酒馆视觉均未验收，不打 tag；下一步在目标酒馆点击最新 AI 楼层的「生图」，结合日志与网络面板确认请求及结果。

此前版本的本地 `npm test`、`npm run simulate`、`npm run structure`、`npm run static` 与 `npm run perf` 通过记录不代表本轮验证；本轮结果以上述记录为准。真实 TavernHelper、NovelAI/provider、真实酒馆 DOM、IndexedDB 迁移、跨设备 `igs-gen:` 失效回退和真实视觉质量仍需在目标环境中验证。


## 角色 DNA 与抠图修复（本地内测候选，尚未经真实酒馆验收）

### 角色 DNA

`bridge.sceneAssets.characterDna = { 主角色名: { identity, defaultAppearance, negative, triggerWords } }`，与情绪槽映射 `characters` 并列。键为主名，查询先经既有别名归约；空字段不注入；旧配置缺该字段时规范化为 `{}`。唯一编辑入口在「场景 → 素材 → 角色立绘」：角色卡内折叠编辑器、「仅有 DNA 的角色」列表（可先录资料后补立绘）、审核卡「加入素材库并编辑 DNA」（`tags` 仅作候选，点「采用」才写入 `defaultAppearance` 且不覆盖已填内容）；生图页「管理角色 DNA」只跳转。角色改名保序迁移、删除清理；场景预设保存 / 应用 / 导入 / 导出携带 DNA，旧预设缺字段时保留当前 DNA。

合并顺序：

- 立绘补全：`triggerWords → identity → defaultAppearance → 副 LLM tag → 立绘模板`；负向为 `模板负面词 → DNA negative → NSFW 防护词 → 素材 uc`。
- 剧情 CG：`triggerWords → identity → 规划得到的当前外观 / 动作`；`defaultAppearance` 只交给 planner 作默认资料，剧情换装时不强行追加；负向 `DNA negative → char_uc`。planner 输出 `char: 角色名 | x,y | tags`，旧格式 `char: x,y | tags` 仍兼容；无名角色仅在「本张单人且上下文唯一角色」时绑定，多人无法判定时不注入并写 warning 日志。
- 数据库生图：合并结果照旧经 `meta.userPrompts` 传给插件，插件是否采纳不作保证。智绘姬链路不变。

### 非破坏抠图记录

新生成立绘写 schema v2：`originalDataUrl`（provider 原图，不可变）、`workingDataUrl`（最近接受的 AI 重建原图）、`dataUrl`（当前透明结果，旧消费者继续读取）、`alphaMaskDataUrl`、`matteCrop`（自动抠图裁边偏移）、`revision`。同一 IndexedDB `images` store 懒兼容，不升库版本。旧记录只有 `dataUrl`，按 legacy 只读，界面提示「无原图，不能恢复已丢失像素」，不伪造原图。写完整记录遇存储额度错误时只保存透明结果，素材记录标 `sourceUnavailable: 'quota'`。新立绘额外保存原图与 Alpha 遮罩，单张占用明显高于旧版（原图 + 透明结果 + 遮罩，接受 AI 修复后另存工作原图）；实际增幅取决于图片尺寸与内容，尚未实测。

### 本地遮罩修复编辑器

生成区立绘行的「修复抠图」打开编辑器（首版只编辑 `igs-gen:` 立绘）：保留 / 删除 / 软边发丝画笔、画笔大小、撤销重做（会话内最多 20 步）、恢复自动抠图、保存 / 取消；Pointer Events 同时支持鼠标与触控，坐标始终映射回原像素。保存经 `saveMatteEdit` 按 `revision` 原子更新，另一会话已修改时拒绝并保留编辑内容；取消、关闭不写任何字段。

### AI 局部重绘

只能由用户在编辑器中圈出「AI 选区」后点击触发。`image-backend.describeEdit()` 协商能力：仅内置 NAI、所选模型存在 inpainting 版本（V4 / V4.5，action `infill`）时可用；数据库生图、智绘姬与 V5 模型返回 `image-edit-unsupported`，按钮置灰并说明原因，绝不退化为整张重画。候选只在内存中预览；点「接受」才写 `workingDataUrl`、重新自动抠图并原子更新；取消、失败、超时、过期不写入；恢复首次原图清除 `workingDataUrl`。提示词自动附带该角色 DNA 与「保持发色 / 发型 / 脸 / 视角 / 光照」项。AI 结果是生成式重建，不代表恢复被抠掉的原始像素。API Key、原图 base64 与请求体不进入日志、错误与测试输出。

### 验证边界

本地只用 fake provider / fake store / 假 DOM 验证契约与请求结构。NAI inpaint 的真实请求字段与返回、直连及代理 CORS、IndexedDB 配额、大图内存、触屏画笔手感与实际发丝质量均需在真实酒馆中验证；验证前不打 tag。
