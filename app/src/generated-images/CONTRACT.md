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
- `image-backend.js` 接收 DBGen 写词失败时，将 `error.context`、`diagnostic` 与 `diagnostics` 收拢至受控诊断：阶段、错误码、字段、原因、合法 `slotId`／角色或 Char 索引、HTTP 状态及可关联 `traceId`。本地 IGS 校验使用 `igs-prompt-input`／`igs-prompt-output` 区分；DBGen 原样阶段为 `prompt-input`／`prompt-parse`／`prompt-output`／`prompt-write`。写词接口异常、等待超时和空返回分别标记 `DBGEN_PROMPT_EXCEPTION`、`DBGEN_PROMPT_TIMEOUT`、`DBGEN_PROMPT_EMPTY`；超时仅停止等待，不证明上游停止。错误提示使用固定文案与受控诊断，不回显外部 message/hint、模型回复、DNA、token、衣装正文或 JSON。
- 人物新任务缺 recipe、未知／重复／跨角色／递归令牌均停止发送。只有显式普通 `cg` 在保存 DNA 或所需景别缺失时可消费有效当次身份；非法 DNA、未知版本及其他任务用途仍拒发。`captionMode: final` 与 recipe／任务／候选互斥，手改定稿不得再次套身份。
- 纯场景不要求 DNA、人物任务或 recipe。无人 DBGen CG 不构造空身份任务；CG 允许池中无 Char、无候选、无身份占位且无具名元数据的纯 Scene 可不带 recipe。无任务的空模板及明确 `generic/object` 模板仍校验版本、绑定数量、索引及正负占位；`named/reference` 和 DNA 候选仍要求显式任务。纯场景发送关闭 DBGen 角色关键字替换，不读取人物库；有空场景模板时保留该模板直至定稿准备，不因缺人物任务丢失它。人物预检失败仍保存原模板与绑定，补齐资料后仅重试失败图。
- 内置 NAI 与 DBGen 的定稿正文只允许画师前置一次；质量、UC、透明底文字等必须在写词阶段完成。DBGen 必须声明 `getPromptCapabilities().finalCaption === 1`，并以 `replaceCharacterKeywords: false`、`capturePrompt: true` 发送。通用生成、阅读器及局部重绘都遵守该边界，其他图像插件拒绝新协议且不兜底。
- 新模板图片返回 `promptRecipe`、`dnaSnapshot` 与 `sentPrompt`；发送快照从最终 prepared request 提取文本、坐标、model/action 和画师，不含凭据、图片或参数全量。历史记录缺这些字段时保持缺省，不从正文或图片反推来源。
- 旧四字段／中文 DNA 不自动拆分景别；显式立绘在同次写词中生成保留原身份的 `full_body`、`half_body`、`portrait` 三景别候选，经实际发送与权威图片回读后采用才补齐。缺任一必需景别均拒绝；历史 `partial` 可保留但不得新建，空历史视图不作为可用候选。旧字段、触发词、权重、身份来源及已有景别保持；普通 CG 缺景别按下述当次身份规则处理，衍生图及一致性重绘仍拒发，不转换、不自动补立绘。
- 新 DNA 的三个身份主语包含有依据且一致的年龄感、发色、发型、瞳色、脸型与五官、体型、身高／比例、肤色、稳定眼神及可见标志饰物；不编造未知岁数或数值。编辑面仅展示三景别身份与景别负面词、触发词及独立默认外观服装，隐藏旧公共身份／负面词及 `partial` 编辑项但兼容持久字段。`defaultAppearance` 是衣装兜底，剧情明确换装、当前 outfit 和持续衣装完全覆盖默认衣装，正文与衣装元数据一致；瞬时表情、视线和姿态不修改基础 DNA。
- 新候选写词逐项核对有来源的角、尾巴、翅膀、非人耳、身体标记及标志饰品，检查遗漏、互斥和 UC 误排除。全身身份不因输入立绘裁切而删除已知尾翼；头像保留头颈可见锚点，不描述画外尾巴或扩大构图。换装不自动移除身份饰品；程序不猜测、补词或自动改写存量 DNA。候选、权威采用资料与最终发送正文保持身份文本保真。
- 自管 NAI／DBGen 人物入口使用动态模板：默认立绘、换装和表情选 `half_body`，头像选 `portrait`；新立绘在同次写词产生完整景别候选，图片生成本身不登记身份。普通模板重画使用本次当前 DNA，不复用旧候选；手改 `final` 原样发送，历史旁路仅作追溯。
- 立绘采用必须回读权威图片与候选、任务、身份快照和发送快照，核验角色／作用域及任务期间资料变化。成功采用才登记候选；保存失败恢复设置，临时素材状态保存成功后才更新内存。设置保存与图片数据库不共有事务，失败恢复是顺序补偿，不是跨系统原子提交。
- 普通 CG 复用现有一次规划／写词调用，按显式角色键、token、captionIndex 与真实取景预检，不强制半身或齐全景别。每个 named 同次输出 `meta_identity` 完整英文身份主语（包括可见锚点）和 `meta_signature` 摘要；匹配保存景别优先，否则消费有效当次主语，不拼补正文、不登记永久 DNA、不增加写词或补立绘请求。两种来源都缺失时拒绝对应图；失败重画保留原图及对应正文与来源，不以旧图存在冒报成功。
- CG 一致性重绘经 DBGen infill 执行；独立选择器 `bridge.autoIllustration.consistencyModel` 只提供 `nai-diffusion-4-5-full-inpainting`（V4.5 Full）与 `nai-diffusion-5-full-inpainting`（V5 Full），缺键默认 V5，显式非法值保留读取但拒发。后端通用 infill 映射仍支持 V4／V4.5／V5 的既有范围，不跨模型回退。固定当前 CG、revision/token、DNA、衣装、写词要求、模型及强度快照；正式场景和各工作轮次按独立 slot 并发写词，全部校验成功后并发重绘。每个分支使用同一原 CG 基线，结果全部成功后按固定 `captionIndex` 顺序合成，重叠区域也保持该顺序；任一失败或取消不提供部分候选。不看图定位、不生成 DNA，不绕过 DBGen 按 credential 的请求池。身份仍经唯一准备入口展开。
- 独立模型要求 DBGen 声明 `infillModelNegotiation: 1`，能力探测 `describeInfill({ model })` 与实际请求 `params.model` 使用同一任务值；确认不支持、模型不匹配或旧插件缺能力时在写词前停止。选择只影响一致性重绘，不修改 DBGen 全局模型或普通生成；模型设置变化后停止未发送请求并拒绝接受旧候选，配置租约、取消及提交门禁保持。各工作轮次的实际模型仍从 `sentPrompt.model` 归档。
- 每个一致性写词请求绑定原 CG 所在楼层的 `messageId`，不默认读取最新 AI 楼；仅携带当前 slot 的任务、角色上下文及输出清单。本图 Char 的 `captionIndex` 从零连续编号，不能用原图角色序号、slotId 或 token 数字代替；同 `characterKey` 的 named 与 reference 使用独立 token 和索引。每项字段只写一次，reference 在自己的索引各写一次空 `meta_outfit_name`、`meta_outfit_description`，不复制 named 衣装或在结尾重复汇总。一致性失败日志保留已允许的写词配置／解析／上游错误码、字段、HTTP 状态和追踪编号，不直接回显上游错误正文。
- 重复字段继续 fail-closed，解析失败不发起绘图并保留原图。单数 `diagnostic` 与复数 `diagnostics` 均收拢至受控诊断，记录允许的解析阶段、字段、issue、slotId 与 captionIndex，不记录模型回复、DNA、衣装正文或凭据。一致性只按保存 DNA 和原图可见依据核对角、尾翼、非人耳及标志饰品，不强补画外或被遮挡部位。
- 一致性工作轮次显式选择 `identityMode: 'appearance_correction'`；正式场景保持普通 DNA 模板。同次写词输出 `identity_mode`、每个 named/reference 的 `meta_correction_identity` 和可选 `meta_correction_uc`，双端解析到 `binding.correction`，仅由 `prepareCharacterCaption` 展开当次校正主语与负面片段。保存 DNA 仍是只读依据且所需景别必须存在；校正文聚焦发型发色、脸型五官、头部非人细节及有依据的可见身份饰品，保留原 CG 结构、衣装、表情、视线及接触关系。未知、空、重复、递归、错绑、非工作用途和 DNA 候选均拒收；普通模板缺省不增加这些字段。
- `bridge.autoIllustration.consistencyStrength` 默认 `0.75`，可执行范围 `[0.1,1]`。旧低值和非法值保留读取，执行前明确拒发，不静默抬高或改写设置。优化入口要求 DBGen 声明 `infillImg2imgStrength: 1` 与 `appearanceCorrection: 1`；缺能力在写词前停止。V5 infill 发送 `inpaintImg2ImgStrength`，低于 1 时另含 `img2img: { strength, color_correct: true }`，满强度省略嵌套对象；`noise: 0` 保持，普通 img2img 顶层 strength 不变。工作布局和全部动态正文由同次写词完成，发送端不拼补。上传蒙版与原图回贴范围独立，回贴采用有界窄带；社区请求格式及离线测试不证明真实上游兼容性或视觉效果。
- 阅读器生成前不确认、生成中不弹模态框；任务期间一致性工具栏按钮用于停止，关闭阅读器或切换目标取消任务。完成后展示本次原图与未保存候选，只有接受并通过提交门禁才替换原槽位；取消保留原图。
- 一致性保姿优先于身份相似度：不依据 DNA 重塑原 CG 身体轮廓、骨架、肢体长度或躯干比例，不移动头部、手脚或接触点。每个实际发送的工作轮次由写词阶段独立保留原依据已有的姿势、朝向、表情、视线、遮挡与互动，不依赖正式场景模板正文；未知细节不猜测。程序不拼补动态正文，语义约束不保证真实模型保姿。
- 一致性任务要求 `getPromptCapabilities()` 声明 `generationConfig: 1`、`generationConfigLease: 1`，并提供返回 `Result` 的 `getGenerationConfig()` 与同步布尔接口 `isGenerationConfigCurrent(token)`。`getEditConfig` 返回配置令牌、画师正文和仅留在任务内存的 `isCurrent` 守卫；能力缺失、异步守卫或读取失败均拒绝开始。各轮显式传 `expectedConfigToken`，DBGen 从核验的私有快照装配，在排队发送前复核同 ID 的接口实体及实际并行凭据池。
- 接受候选时，文件上传后由 `beforeCommit` 异步复核配置、原记录、DNA 与写词要求；实际存储事务只用同步 `shouldCommit` 检查租约、当前目标和身份，不在 IndexedDB 事务里等待读取。DBGen 同一 `docDb` 的配置／画师 Repository 共享提交通知，修改后再改回也使旧令牌失效；该通知不保证跨客户端或标签页同步。配置／画师／DNA／写词要求变化、取消及目标冲突保留原图。令牌与守卫不进入 wire 或持久化来源，旧调用缺省不追加租约字段。离线请求捕获不能代表真实 provider 接受性或模型效果。
- 衣装模板显式使用 `outfitMode: 'template'` 与扁平 `outfit_mode: template`；缺省字段的历史任务保持旧协议。named 正向 Char 恰有本人的 `<<outfit:token>>`，Scene、reference 和所有 UC 禁止衣装占位。reference 的两项 `meta_outfit_*` 在自己的索引各写一次空值，双端解析实际核验。
- 衣装只在 `prepareCharacterCaption()` 展开，保存独立 `outfitSnapshot`；已有说明按角色复用，不翻译、不改写，同名不同说明拒收。普通 CG 的剧情当前衣装优先，明确新衣装不回退默认；未换装时复用已保存说明。CG 同次写词的新衣装经权威图片回读暂存候选，不自动入库。默认立绘成功采用后将说明写入 `characterDna[name].defaultAppearance`，不自动创建 `characterOutfits` 或 `wardrobe` 条目。
- 衣柜与表情差分使用三层资料：保存角色 DNA 管固定外貌，`wardrobe[key].prompt` 保存独立服装 DNA，`characterOutfits[name][outfit].wardrobe` 绑定对应衣装分栏，`promptRecipe.caption` 保存角色／服装双占位符和当次表情动作。剧情入柜提取服装 DNA 后独立保存；手动新增衣装缺服装 DNA 时，同次写词输出 `meta_outfit_*` 与动态模板，经整批模板校验和 `onOutfitDna` 宿主保存成功后才发图。服装 DNA 保存失败零绘图；图片失败不撤销已保存 DNA。已有服装 DNA 保真复用，不重新设计，角色 DNA 不被换装覆盖。
- 有保存半身 DNA 的新表情／单槽生成不依赖旧立绘完整提示词。衣装分栏提供服装 DNA 查看／编辑；编辑建立本套的独立引用，不覆盖其他衣装共享资料，保存失败恢复草稿。显式模板重画和继续生图以当前角色 DNA、同名服装 DNA 展开原模板，不增加写词请求、不修改历史图片或发送快照；衣装名称错绑仍拒收。逐图手改定稿保持原样发送，旧协议读取兼容保持。实际展开的 caption、`dnaSnapshot`／`outfitSnapshot` 与 `sentPrompt` 独立归档，不替代可复用模板。

- 默认立绘写入 DNA 前仍须通过图片成功、权威回读、角色／作用域、冻结衣装基线、模板、实际发送正文／坐标及既有设置保存门禁。已有默认说明、`identityInitialized: true`（含主动清空）和内置裸体不被自动覆盖或补写；存量衣装不迁移、不删除。设置或素材状态保存失败按原路径恢复，保留同一候选供重试。
- 后续默认立绘、头像、表情和普通 CG 优先读取 DNA 默认服装；旧外部衣装的默认标记仅在 DNA 无默认说明时兼容读取。有名当次衣装及剧情明确换装优先，空名默认衣装使用空 `meta_outfit_name`／`meta_outfit_description` 保真复用 DNA，来源为 `saved`；默认说明改写仍拒收。普通 CG 重画读取当前身份但保留原图 `outfitSnapshot`，一致性只用原 CG 衣装快照。
- 立绘与服装差分采用通过 `readWardrobe` 读取当前有效共享衣柜来解析所属角色的衣装说明；返回补丁仍基于角色所属库，不复制共享衣柜，新增衣柜键避开共享键。衣装拒收保留 `OUTFIT_ADOPTION_CONFLICT`，提示和受控诊断区分资料变化、模板复核、快照、发送正文／坐标及证据缺失；诊断不含身份、衣装正文或凭据，失败保留已生成图片。
- `saved-outfits-changed` 的拒绝摘要仅返回冻结基线／当前读取条数、新增／移除／说明／默认标记差异、匿名归属及所属库／有效视图相等性；缺失历史列表标为未知，不据此断言历史为空。摘要不返回角色名、衣装名、图片或正文，不参与采用判定或补丁；三个 UI 采用入口保留具体错误码、摘要及保存前 `writeAttempted: false`。首次入库前不要求编辑不存在的衣装，空库合成回归通过不代表现场根因已确认。
- 普通 CG 写词前冻结作用域及角色归属，暂存候选前复核槽位 key、revision/token、当前目标及衣装资料；多人物候选全部核验后一次暂存。图片已经提交而候选暂存失败时保留图片并警告，不重复生图、不写入半成品。剧情衣装服务自动提取本楼独立衣装描述，候选绑定 scope／owner／chat-floor／message／正文哈希；楼末在写词尚未完成时即可选择仅入库衣柜，或入库并用保存 DNA 生成单张平和立绘。确认同步隐藏候选，后台复用在途写词，先入库衣装再尝试立绘；同候选在途采用去重。写词或衣装入库失败报错并恢复待确认；衣装成功入库后的 DNA、立绘写词、绘图、权威回读或立绘保存失败只报错，不回滚衣装、不重新确认。绘图失败的已完成提示词和恢复旁路写入所属库的衣装表情注记，并建立空的平和槽供设置页继续生图；恢复保存失败单独报错，不宣称已经持久化。已生成图片 ID 保留且显式重试复用同图。用户确认前不改衣柜或 DNA，稍后隐藏并在重开阅读器恢复；已入库失败候选重开不再弹框。采用按冻结角色归属写回，仅写对应衣装 moods 槽，不覆盖原默认立绘或基础 DNA；关闭阅读器、切卡、切楼或正文变化拒绝后续发送和迟到提交，不承诺跨阅读器继续完成。待确认图片纳入清理保护，候选读取失败保守保留图片。图片、候选与设置存储不共享事务。
- 一致性重绘沿原 CG 衣装快照展开，不以当前衣柜、默认外观或参考立绘服装替换；首次一致性基线保存实际存在的 `outfitSnapshot`。手改定稿不采用候选，最终发送仍拒绝未展开的衣装令牌。
- 校正来源仅归档于实际 infill 的 `consistencyPrompt.rounds`：recipe 保留 `identityMode` 与 `binding.correction`，DNA 快照保留原 profile、实际展开 subject/negative 及 `application: 'appearance_correction'`。归档核对绑定与应用值，并要求实际 infill 发送快照；正式场景 recipe 不带工作标记，合成 CG 不伪造整图 wire。旧轮次缺字段原形读取，文件备份和恢复保真保留合法字段。


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
