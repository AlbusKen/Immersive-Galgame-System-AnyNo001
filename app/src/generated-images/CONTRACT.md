# generated-images 模块契约

## 职责

- 管理生图 provider。
- 内置 provider 放在 `generated-images/providers/`。
- 模型专属请求构建器放在 `generated-images/request-builders/`。
- st-chatu8 必须作为可拆卸内置 provider，而不是写死在核心逻辑里。
- 兼容 Immersive Galgame System 既有的外部插图扩展适配能力。
- 支持内置生图 API、提示词预设、轮询和失败反馈。
- 生成图持久化和图片池统一交给 `media`。
- 检测到生图段时驱动 `visual` 切换到生图层；生图段消失时回到背景+立绘。
- 自动插图由 `illustration/` 负责段落编号、标记插入、规划提示词与解析、设置规范化和事件驱动服务；tag 与图片交由 `media/illustration-store.js` 保存。
- NovelAI 官方接口由 `request-builders/nai-v4-builder.js`（`providerType: nai-official`）构建请求、`nai-official-client.js` 发起请求，并复用 `image-api-client.js` 的响应解析；不得覆盖既有 `bridge.imageApi`。

- 生图提示词公共规则在 `illustration/prompt-kit.js`：虚构/成年人框架、CG 构图指南、拒答识别与「温和模式」重试（主提示词被拦截时只让 LLM 写构图，露骨 tag 由本地模板 `nsfwExtra` 补）、内置背景/立绘 NAI 模板与背景词典兜底。
- 生图排查日志（`image-job-log.js`）：自动插图与素材补全通过 `report(level, message)` 上报进度与失败原因，由 bootstrap 写入日志（localStorage `igs_image_job_log`，按 `bridge.imageJobLog.retainDays` / `maxEntries` 自动清理）并按 `bridge.showToasts` 弹 toast；只有 `done` 楼层算已处理，失败 / 过期楼层下次渲染重试。副 LLM 系统提示词可由 `bridge.autoIllustration.llm.prompts.*` 覆盖，留空用内置。
- 正文字数门槛（`illustration/floor-body-length.js`）：自动插图与素材补全自动触发时，先按 `bridge.sourceFilter`（和阅读器同一套正文保留 / 排除标签，`scene/message-source.js` 的 `readerBodyText`）取出正文；台词 / 心理只数台词本身，指令和空白不算。不足 `MIN_AUTO_IMAGE_BODY_CHARS`（50）字返回 `body-too-short`，日志写一行原因，不记成已处理（楼层「继续」写长后下次渲染照常处理）；手动生成不受限。
- 素材补全（`illustration/asset-generation-service.js`）：场景素材模式开启且对应开关打开时，最新 AI 楼层出现素材库匹配不上的场景或无名角色 → 副 LLM 写内容 tag（`asset-prompt.js`）→ NAI 生成（立绘 V5 走原生透明底，其余模型浅灰底 + `media/alpha-matte.js` 抠图）→ 存为本聊天临时素材，状态 `review`，等待楼层结束时由阅读器询问用户加入素材库 / 仅本聊天 / 丢弃。
- 物品图（`illustration/item-image-service.js`，设置 `bridge.itemImages`，默认关闭）：关闭时入口短路，不读表、不联网。候选 = 本楼 `[igs-fx:item]` 标签物品在前 + 物品表（`data/shujuku/item-catalog.js`）在后，按归一化名称合并；缺图者每层最多 `maxPerFloor`（默认 3）件，串行队列 + 按物品键在途锁，重复事件不重复计费。存入 `igs-generated-assets`，`type: 'item'`、状态 `ready`（不进入素材审核与临时素材列表），按聊天隔离；重画失败保留原图，`discarded` 不自动重补。手动「补全物品图」单次最多 10 件。提示词见 `illustration/item-prompt.js`（副 LLM 失败时仅纯英文名兜底，中文名记失败待重试）；透明底沿用立绘分支。

- 自管 NAI／DBGen 的人物生成遵守下文 DNA 模板契约；`sprite-prompt-composition.js` 仅服务未进入新协议的兼容调用。无模板存量图不猜测拆成身份模板，沿旧完整词路径复用；未知画师来源不推断去重，也不伪造发送快照。逐图手改词走定稿重画。裸体只改变当次衣装要求，不修改基础 DNA；其他图像插件保持原有流程。
- 普通 CG 的新模板通过显式角色键、token、captionIndex 和景别绑定读取已保存 DNA，衣装由当次写词决定。旧 planner 的 `char: 角色名 | x,y | tags` 与 `char: x,y | tags` 保持旧解析兼容；旧图缺绑定时不能凭顺序猜人物或进入一致性重绘。数据库生图 CG 不复用立绘组合模块。
- 素材服务新增 `getEditableImage(imageId)` 与 `saveMatteEdit(imageId, expectedRevision, patch)`，按 revision 原子更新并发出 `matte-edited` 事件。
- 局部重绘能力协商：`image-backend.js` 的 `describeEdit()` / `edit()` 与普通 `generate` 分离；只有内置 NAI、客户端提供 `edit` 且所选模型存在 inpainting 版本（`request-builders/nai-inpaint-builder.js`，action `infill`）时才支持，否则返回 `image-edit-unsupported`，禁止退化为整张重画。请求形状仅经 fixture 验证，真实接口兼容性需真机确认。
- AI 修复事务（`illustration/inpaint-transaction.js`）：必须用户显式触发；预览只在内存，接受时校验 revision → 写 `workingDataUrl` → 重新自动抠图 → 原子更新；取消 / 失败 / 过期不写任何资产字段；「恢复原图」清除 `workingDataUrl` 并从原图重抠。AI 结果是生成式重建，不代表恢复原始像素。错误与日志不得包含 API Key、原图 base64 或完整请求体。
- 智绘姬出图（`chatu8-client.js`）：图像来源为 `extension` 时，剧情 CG、素材与物品图经酒馆全局 `eventSource` 的 `generate-image-request` / `generate-image-response` 事件（按 `id` 配对）交给智绘姬出图，只发送合并后的场景与角色 tag，画师串、质量词与尺寸沿用智绘姬自身设置；智绘姬按其挂在主窗口的设置函数判定已安装。未检测到智绘姬、出图失败、超时或返回视频时，填了 NAI Key 就退回内置 NAI，否则按失败上报。走智绘姬时立绘一律按非透明底出图并抠图。阅读器重画仍代点楼层内智绘姬按钮。事件协议来自上游打包源码而非公开 API，上游改名即失效，需真机确认。
- 智绘姬读取层按上游原版 DOM（`dom-image-candidates.js`）：图片取 `.st-chatu8-image-container` / `.st-chatu8-image-span` / `span[data-request-id]` 内的 `img` 与 `video`，按钮取 `.image-tag-button` / `.st-chatu8-image-button`（均带 `data-request-id`）；图片与重画按钮优先按 `data-request-id` 精确配对，slotIndex / locationHash / imageId / buttonIndex 与 DOM 顺序兜底不变。原 `img.st-chatu8-image-tag-image` 选择器在上游已不存在，不得恢复。

- 柏宝绘出图（`baibai-client.js`）：图像来源为 `baibai` 时，剧情 CG、素材、物品图与阅读器重画经柏宝绘公开接口 `globalThis.STBaiBaiImage`（apiVersion 1）出图，`save: false` 不进柏宝绘图库；后端支持多角色时分角色传，否则拼成一段 prompt；未检测到或失败时有 NAI Key 就退回内置 NAI。不保证透明底，立绘按浅灰底出图再抠图。
- 副 LLM 写词（`illustration/caption-writer.js`）：图像来源不是数据库生图时，`writeDbgenPrompt` 改由副 LLM 按同一份描述写 NAI v4 caption，`generateDbgenCaption` 把 caption 拆回 slot 按当前来源出图；表情差分、头像、默认立绘与衣柜共用。副 LLM 选独立 API 却没填地址或模型时直接报「还没接副 LLM」，不发请求。副 LLM 设置单独在「生图 → 副 LLM」子页。

## DNA 模板与定稿发送

- 显式 `promptRecipe.mode: dna_template` 由 `character-caption.js` 唯一展开；正负令牌仅绑定自身 Char，Scene、动态正文、权重及坐标保真。不推断任务用途，候选与 reference 必须带显式 `promptTask`；保存 recipe 的普通重画只读取当前保存 DNA。
- `image-backend.js` 接收 DBGen 写词失败时，只向自动插图状态传递白名单 `diagnostic`：阶段、错误码、字段、原因、合法 `slotId`／角色或 Char 索引及可关联 `traceId`。本地 IGS 校验使用 `igs-prompt-input`／`igs-prompt-output` 区分；DBGen 原样阶段为 `prompt-input`／`prompt-parse`／`prompt-output`／`prompt-write`。错误文本不得拼入模型回复、DNA、token、衣装正文或 JSON。
- 人物新任务缺 recipe、未知／重复／跨角色／递归令牌均停止发送。只有显式普通 `cg` 在保存 DNA 或所需景别缺失时可消费有效当次身份；非法 DNA、未知版本及其他任务用途仍拒发。`captionMode: final` 与 recipe／任务／候选互斥，手改定稿不得再次套身份。
- 纯场景不要求 DNA、人物任务或 recipe。无人 DBGen CG 不构造空身份任务；CG 允许池中无 Char、无候选、无身份占位且无具名元数据的纯 Scene 可不带 recipe。无任务的空模板及明确 `generic/object` 模板仍校验版本、绑定数量、索引及正负占位；`named/reference` 和 DNA 候选仍要求显式任务。纯场景发送关闭 DBGen 角色关键字替换，不读取人物库；有空场景模板时保留该模板直至定稿准备，不因缺人物任务丢失它。人物预检失败仍保存原模板与绑定，补齐资料后仅重试失败图。
- 内置 NAI 与 DBGen 的定稿正文只允许画师前置一次；质量、UC、透明底文字等必须在写词阶段完成。DBGen 必须声明 `getPromptCapabilities().finalCaption === 1`，并以 `replaceCharacterKeywords: false`、`capturePrompt: true` 发送。通用生成、阅读器及局部重绘都遵守该边界，其他图像插件拒绝新协议且不兜底。
- 新模板图片返回 `promptRecipe`、`dnaSnapshot` 与 `sentPrompt`；发送快照从最终 prepared request 提取文本、坐标、model/action 和画师，不含凭据、图片或参数全量。历史记录缺这些字段时保持缺省，不从正文或图片反推来源。
- 旧四字段／中文 DNA 不自动拆分景别；显式立绘在同次写词中生成保留原身份的四景别候选，经实际发送与权威图片回读后采用才补齐。旧字段、触发词、权重、身份来源及已有景别保持；普通 CG 缺景别按下述当次身份规则处理，衍生图及一致性重绘仍拒发，不转换、不自动补立绘。
- 新 DNA 包含有依据的发色、发型、瞳色、脸型与五官、体型、身高／比例、肤色、稳定眼神及标志性发饰、首饰和装饰；不编造未知数值，不从裁切图补造画外特征。瞬时情绪、视线方向、闭眼／眯眼、衣装和姿态属于当次画面，不修改基础 DNA。
- 自管 NAI／DBGen 人物入口使用动态模板：默认立绘、换装和表情选 `half_body`，头像选 `portrait`；新立绘在同次写词产生完整景别候选，图片生成本身不登记身份。普通模板重画使用本次当前 DNA，不复用旧候选；手改 `final` 原样发送，历史旁路仅作追溯。
- 立绘采用必须回读权威图片与候选、任务、身份快照和发送快照，核验角色／作用域及任务期间资料变化。成功采用才登记候选；保存失败恢复设置，临时素材状态保存成功后才更新内存。设置保存与图片数据库不共有事务，失败恢复是顺序补偿，不是跨系统原子提交。
- 普通 CG 复用现有一次规划／写词调用，按显式角色键、token、captionIndex 与真实取景预检，不强制半身或齐全景别。每个 named 同次输出 `meta_identity` 完整英文身份主语（包括可见锚点）和 `meta_signature` 摘要；匹配保存景别优先，否则消费有效当次主语，不拼补正文、不登记永久 DNA、不增加写词或补立绘请求。两种来源都缺失时拒绝对应图；失败重画保留原图及对应正文与来源，不以旧图存在冒报成功。
- CG 一致性重绘只支持 DBGen V5 infill：固定当前 CG、revision/token、DNA、衣装及写词要求，恰好一次批量写出正式场景和全部工作轮次模板，按 slot/token 对账；不看图定位、不生成 DNA、不逐轮写词。程序只处理几何、蒙版与像素合成，身份仍经唯一准备入口展开。
- 一致性写词仅允许校正目标角色在保存 DNA 中明确强调且参照图支持的稳定身份锚点；原 CG 的衣装颜色、款式、动作、表情、视线、互动、动物、道具、背景、光影和画风保持。实际 Char 正文与原 CG 衣装快照一致，不能只照抄元数据却改绘图正文。工作布局不作为正向 Scene 内容，参考 Char 只写身份及简洁可见状态；新增相框、边框、分栏、拼贴和重复参考人物的排除项在同次写词的工作轮次 UC 中完成，发送端不拼补正文。该语义约束不等于粗区域内像素级身份分割或真实模型效果保证；一致性每轮显式使用 `strength: 0.35`、`noise: 0`，不修改 DBGen 全局缺省强度 `0.7` 或其他重绘流程。
- 一致性保姿优先于身份相似度：不依据 DNA 重塑原 CG 身体轮廓、骨架、肢体长度或躯干比例，不移动头部、手脚或接触点。每个实际发送的工作轮次由写词阶段独立保留原依据已有的姿势、朝向、表情、视线、遮挡与互动，不依赖正式场景模板正文；未知细节不猜测。程序不拼补动态正文，语义约束不保证真实模型保姿。
- 一致性任务要求 `getPromptCapabilities()` 声明 `generationConfig: 1`、`generationConfigLease: 1`，并提供返回 `Result` 的 `getGenerationConfig()` 与同步布尔接口 `isGenerationConfigCurrent(token)`。`getEditConfig` 返回配置令牌、画师正文和仅留在任务内存的 `isCurrent` 守卫；能力缺失、异步守卫或读取失败均拒绝开始。各轮显式传 `expectedConfigToken`，DBGen 从核验的私有快照装配，在排队发送前复核同 ID 的接口实体及实际并行凭据池。
- 接受候选时，文件上传后由 `beforeCommit` 异步复核配置、原记录、DNA 与写词要求；实际存储事务只用同步 `shouldCommit` 检查租约、当前目标和身份，不在 IndexedDB 事务里等待读取。DBGen 同一 `docDb` 的配置／画师 Repository 共享提交通知，修改后再改回也使旧令牌失效；该通知不保证跨客户端或标签页同步。配置／画师／DNA／写词要求变化、取消及目标冲突保留原图。令牌与守卫不进入 wire 或持久化来源，旧调用缺省不追加租约字段。离线请求捕获不能代表真实 provider 接受性或模型效果。

## Provider 契约

- `detect(context)`
- `generate(request)`
- `poll(task)`
- `extractImages(messageContext)`

## Request Builder 契约

- `providerType`
- `schemaVersion`
- `buildRequest(promptContext, promptPreset, providerPreset)`
- `validateRequest(request)`

Provider 负责发请求和解析返回；Request Builder 负责把通用场景变量、提示词预设和 provider 配置转成模型专属请求。NAI、ComfyUI、GPT 图像、banana 等模型必须各自拥有独立 builder。

## 导入位置

只在生图插件页导入、导出和管理 provider，不设置全局 Mod 管理页。

## 禁止

- 禁止把本地文件缓存逻辑写进 provider。
- 禁止 provider 直接操作视觉 DOM。
- 禁止把模型专属提示词框架写死进通用 `prompts`。
- 禁止默认联网，必须由用户启用 provider 后才发起请求。
- 禁止在 provider 禁用后继续扫描对应 DOM。
