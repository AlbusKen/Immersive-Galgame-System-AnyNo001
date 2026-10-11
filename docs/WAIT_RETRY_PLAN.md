# 等待体验 + 素材重试 + 截断续写 方案（2026-10-11）

只读调查产物，未改源码。路径相对 `app/src/`，V = `visual/igs-ui/`。行号为快照，并行工作流在改演出文件，**以符号名为准**。

## 一、等待体验现状

### 1.1 AI 生成正文时的等待表现

| 问题 | 结论 | 证据 |
|---|---|---|
| 实现位置 | 全屏/网页全屏：输入栏换成 `#igs-send-status`（三点脉冲+“正在生成…”）；楼层内嵌：`.igs-embedded-loading`（三点+同文案） | `V/reader-host.js` `enterReplyWait`/`enterEmbeddedLoading`/`exitEmbeddedLoading`；`V/reader-dom-render.js:344-355`；CSS `V/original-reader-source.js:288-295,382` |
| 阶段数 | **1 段**，有/无；不按时长升级 | `awaitingReply` 布尔 + `streamPhase` |
| 触发 | 阅读器内发送（`reader-host.js` 约 1363）或 `#chat` 外部变更（`handleChatStreamActivity`） | `host/chat-stream-observer.js`：GENERATION_STARTED/ENDED/STOPPED + MutationObserver |
| 结束判定 | 800ms 稳定+生成事件；120s 硬超时；无事件时静默 10s（生成中 30s）兜底 | `chat-stream-observer.js` 常量、`hasGenerationSettled` |
| 随皮肤/世界观 | 部分：全屏状态条颜色跟 `--igs-bar-ink`；内嵌固定白字；文案不随世界观变 | `original-reader-source.js:336,343,382` |
| 流式显示 | **没有**。设计上流式期间不解析，稳定后一次换源 | `handleChatStreamStable` 注释 |
| 已写字数 | 没有，观察器只记活动时刻 | `chat-stream-observer.js` |
| 停止/重试入口 | **没有**。全屏等待时输入框和发送钮被隐藏（`original-reader-source.js:296`）；src 内无 stopGeneration 调用；仅设置页批量生图有“停止生成”（`V/settings-actions.js:467-497`） | grep |
| 网页全屏等待提示 | 有（v0.34.88-90）：`followsHostReply` 对 fullscreen/web 同走 `enterReplyWait`，无事件时靠静默窗口收起 | `reader-host.js` |

### 1.2 其他现状

| 问题 | 结论 | 证据 |
|---|---|---|
| 待机小动作 | 部分：有呼吸（主立绘 `igs-sd-breathe`；陪衬 `igs-cast-breathe` 按名字哈希错相位），low 画质关；**无眨眼、无视线**；由舞台调度开关控制，非等待专用 | `V/stage-direction-style.js:10,40,44`；`V/stage-cast-render.js:24,144,344`；`V/stage-direction-runtime.js:786` |
| 头顶小字 say | 有。`V/fx-daily.js` 的 `say(item, env)`，入参 `{who,text}`，落在角色头顶（沿用 Meta 气泡），不在台上放 22% 高度；寿命 2600ms×hold；直播手机盖住主播时不画。经 `renderDailyFx` 调度，**非独立函数**，需造 item 或抽小出口 | `fx-daily.js:551`、`DAILY_RESULT_LIFE_MS.say` |
| 细线 generation-strip | 有。`createGenerationStrip`：`activity(event)`、`floor(id,done)`、`manual(text)`、`notice(level,msg)`、`getDialogReady()`、`remount()`、`getState()`。颜色取对话框字色。**可用于等待提示**，但需新增 `wait(text)` 状态（`info` 在非 busy 时被丢弃） | `V/generation-strip.js`；实例 `reader-host.js:322`；转发 `imageNotice`/`writeGenerating` |
| 等待期间环境层/BGM | **继续**。舞台只在 offscreen/hidden/panel 时暂停；天气、时段、BGM 不因等待改变；页面不可见时音频静音 | `V/stage-pause.js`、`V/audio-bus.js:123-170` |

### 1.3 追加设计所需锚点

| 项 | 现状与锚点 |
|---|---|
| 标签登记 | `scene/directive-tags.js` `IGS_INLINE_DIRECTIVE_NAMES=['scene','char','thought','img','fx']` 唯一登记点，另有 `stripMarkerDirectives`、`canonicalizeIgsDirectives`（容错全角/大小写/漏横杠）。fx 子类型在 `scene/fx-directives.js` `parseFxDirective`（`-end` 区间约定）。**新增 fx 子类型 `[igs-fx:wait|角色|台词]` 免改登记点**；独立 `[igs-wait:]` 需改登记点并核对所有由它构造的正则 |
| 阅读器内隐藏 | 阅读器自己解析，fx 标签已从可见文本剥离（`stripMarkerDirectives`、`readerBodyText`） |
| 酒馆楼层隐藏 | `host/illustration-message-host.js` `ensureMarkerRegexes`：经 TavernHelper `getTavernRegexes/replaceTavernRegexes` 写两条全局正则（display 隐藏、prompt 隐藏），调用点 `generated-images/illustration/auto-illustration-service.js:237`。**可原样仿写** |
| 发回 AI 上下文 | 同文件 `attachPromptStrip` 监听 `CHAT_COMPLETION_PROMPT_READY`，原地改 `eventData.chat[*].content`（调用点 `auto-illustration-service.js:765`）。可在此剥旧楼 wait 标签；“最近一条”由 IGS 自己存，不依赖上下文保留 |
| Q 版头像 | 存储 `readerSettings._sceneAssets.statusAvatars[角色主名]='igs-gen:编号'`；取值 `resolveAvatar(name,snapshot,options)`（`V/fx-runtime.js:354`），`reader-host.js:3017 avatarFor`；生成 `asset-generation-service.js:1021`，设置入口 `settings-actions.js:2328-2356`。无头像降级参考 `fx-runtime.js:363 callFace` 首字圆章 |
| 姓名牌样式 | `#igs-speaker`（`reader-dom-render.js`）；皮肤差异在 `V/dialog-skin-frame.js`、`dialog-theme-skins.js`、`classic-dialog-skin.js`。**无统一取样式接口**，建议小过场读 `getComputedStyle(#igs-speaker)` 后 rotate(-4deg)，不改皮肤文件 |

## 二、素材生成与重试现状

### 2.1 后端流程

| 后端 | 位置 | 超时 | 重试 | 备注 |
|---|---|---|---|---|
| NAI | `generated-images/nai-official-client.js` `sendWithRetry` | 默认 120s | **有**：`RETRYABLE={408,429,500,502,503,504}`，3 次尝试，`Retry-After` 优先，429 基数 5s 其余 2s 指数，封顶 30s | 无全局降速 |
| 智绘姬 | `chatu8-client.js` 事件 request/response 配对 | 240s | 无；失败走 `naiFallback`（无 Key 则失败） | 插件自管 |
| 柏宝绘 | `baibai-client.js` `STBaiBaiImage.generate` | 240s | 无（并发闸门/退避由柏宝绘负责）；失败走 `naiFallback` | |
| 数据库生图 | `image-backend.js` `paintDbgenCaption` | 写词 5min/出图 3min（`withTimeout`） | 无 | |
| 通用图像 API | `image-api-client.js` | `fetchWithTimeout` | 无；异步任务轮询失败即抛 | |
| 编排 | `auto-illustration-service.js` `generateSlots` | — | 串行 for 循环，失败记 failed 继续；仅下次处理该楼时重试未成功槽（`markedSlots().retry`） | `locks`/`inflight` 只做去重 |

重试只存在于 NAI 的 HTTP 层，IGS 编排层没有；无队列、无全局限流（`generation-queue.js` 是未用的简易队列）。

### 2.2 失败分类

| 类别 | 能否区分 | 现状 |
|---|---|---|
| 超时 | 部分 | 各后端自写文案，无结构化字段 |
| 网络/CORS | 部分 | 仅 NAI 有专门文案 |
| 5xx/429 | 仅 NAI | `result.status` 只有 NAI 非 ok 时带 |
| 空图/坏图 | 部分 | 各后端不同字符串 |
| 审核拦截 | **否** | 无任何识别 |
| 鉴权/参数 | 仅 NAI | 401/402 文案；插件“未就绪/未检测到” |

### 2.3 重新生成入口与麻烦点

| 入口 | 位置 | 麻烦点 |
|---|---|---|
| 重画单张 CG | `reader-host.js` `rerollCurrentIllustration` → `service.rerollSlot` | 点按钮+确认弹窗；失败后再来一遍 |
| 绘制 CG | `reader-host.js` 约 2255 | 有挂载点时重写提示词重画全部，语义分叉 |
| 补全素材 | `runManualAssetGeneration` | `nothing-missing` 提示“不会重复生成”，易被当成坏了 |
| 丢图重生成 | `asset-generation-service.js` `run()` 两遍匹配（10-08 未提交） | 需用户手动点补全素材 |
| 立绘/表情/衣柜/Q 版头像 | `V/settings-actions.js`（约 1407/1455/1500/2328，进度 `startExpressionProgress`） | 要进设置页；整套先选档位、填注意事项；失败弹窗后回格子再点 |
| CG 自动失败 | `generateSlots` 记 failed | 无按钮，用户不知点哪 |

### 2.4 失败后 UI

占位 `V/reader-dom-utils.js` `ensureImageEmptyPlaceholder` 只显示灰字“图片未生成”，不可点；细线失败红线只展开原因不带动作；**无一键重试**（reroll 按钮在失败槽位仍可用，但要确认弹窗）。

### 2.5 文字截断

| 问题 | 结论 |
|---|---|
| 正文截断检测 | **没有**。src 内无 finish_reason/finishReason 检测 |
| 标签未闭合 | 解析层只容错不告警：漏 `]` 以行尾收口；聊天块缺 `[igs-chat-end]` 自动收口（`scene/chat-blocks.js`）；区间标签缺 `-end` 无“疑似截断”判定 |
| 半截句子 | 无 |
| 截断后处理 | 无，读者自己回酒馆处理 |
| 酒馆 continue | IGS 没调用过。现有通道仅 `host/tavern-helper-adapter.js` `typeAndSend` 与 `host/secondary-llm.js` `generateRaw`。continue 需 `context.Generate('continue')` 或点 `#option_continue`，**需真机确认** |
| 生图词截断 | `planner-parser.js` 输出被截时槽位被过滤，报“没有可用的插图字段”，无专门判定；`secondary-llm.js` `viaOpenAi` 不读 finish_reason；插件词 `floor-prompt-tags.js` 缺闭合的行为本次未深入读 |

## 三、方案

### A 等待动画分阶段

| 项 | 内容 |
|---|---|
| 现状 | 单阶段；无字数、无停止/重试；有呼吸无眨眼；无等待台词 |
| 阶段 | 0-2s 不显示；2-8s Q 版小过场；8-20s 头顶小字（轮播下一条台词）+环境继续；20s+ 输入栏位置显示“还在写……已写约 N 字”+【停止】【重试】 |
| 计时 | `enterReplyWait`/`enterEmbeddedLoading` 记起点，新模块 1s 定时器驱动；`exitEmbeddedLoading` 清理。省电：`data-igs-quality="low"` 只静态显示，`document.hidden`/`stage-pause` 暂停时停动画 |
| 已写字数 | 在 `onActivity`（已节流 150ms）里只读最新 AI 楼 `.mes_text` 的文本长度，不解析，不违背“流式不解析” |
| 停止/重试 | 停止调 `context.stopGeneration()` 或点酒馆停止钮（真机确认）；重试语义待拍板（问题 2） |
| 等待台词标签 | 推荐 `[igs-fx:wait|角色名|台词]`，每轮末尾写 1-2 条。世界书式提示词一两句：贴合当前剧情与人设、≤20 字、不剧透；走 `scene/prompt-entries.js` 机制可由用户改，**不建本地词库**。缺省中性文案（“……在想……”“稍等一下哦”） |
| 隐藏 | 仿 `ensureMarkerRegexes` 注册 display/prompt 两条正则；`attachPromptStrip` 同层剥旧楼 wait 标签；最近一条由 IGS 自存（内存+聊天级本地键） |
| Q 版小过场 | 斜置姓名牌（取 `#igs-speaker` 计算样式，rotate -4deg）+逐字浮出台词+Q 版头像弹跳/歪头/托腮，从屏幕一角滑入，正文开始稳定或生成结束时滑出；多条轮播；无台词只显头像小动作；无头像用首字圆章 |
| 改动锚点 | `V/reader-host.js`：`enterReplyWait`、`enterEmbeddedLoading`、`exitEmbeddedLoading`、`handleChatStreamActivity`；`V/reader-dom-render.js:344` 的 `#igs-send-status`（20s 阶段按钮）；`scene/fx-directives.js` `parseFxDirective`（加 wait，解析后分流，不进演出队列）；`V/generation-strip.js` 加 `wait(text)`；`V/fx-settings.js` 加开关/阈值 |
| 新文件 | `V/wait-phases.js`（纯函数阶段机）、`V/wait-cameo.js`（小过场）、`scene/wait-lines.js`（解析/存取）、`host/wait-regex.js`（正则登记） |
| 复用 | generation-strip、`say`、`resolveAvatar`、`stage-pause`、`render-quality`、`ensureMarkerRegexes` |
| 工作量 | **L**（可拆 A1 阶段+字数+停止 M；A2 标签+正则+剥离 M；A3 小过场 M） |
| 风险 | 内嵌模式读字数可能读到被隐藏节点；停止接口版本差异；wait 若被普通演出队列误播会闪；提示词增约 60 字需过 `tag-grammar.js` 预算；等待时 `#igs-input` 被隐藏，加按钮要避开 `comic-style.js:16` 规则；并行工作流改演出文件有合并冲突 |

### B 素材自动重试

| 项 | 内容 |
|---|---|
| 现状 | 仅 NAI HTTP 层 3 次；其余无；编排层不重试；占位不可点；无统一分类 |
| 改动锚点 | `generated-images/image-backend.js` 在 `generate`/`generateDbgenCaption` 外包 `withRetry`；`generation-activity.js` `failureText` 旁加 `kind`/`attempt`；`V/generation-strip.js` `activity()` 读 attempt，仅静默显示“重试中”；设置 `autoIllustration.retry={enabled:true,times:2}` 放生图高级折叠 |
| 新文件 | `generated-images/failure-classify.js`（`classifyImageFailure`）、`generated-images/retry-policy.js`（`withRetry`、全局降速闸） |
| 终态 | 占位 `ensureImageEmptyPlaceholder` 改可点“点一下重试”；细线红线保留 |
| 工作量 | **M** |
| 风险 | 外层叠加 NAI 内层 3 次会放大计费，需 `retriedInside` 标记跳过；插件超时可能仍在出图，重试会重复；串行 for 循环下整楼耗时变长，需总预算封顶 |

| 类别 | 判定 | 可重试 | 策略 |
|---|---|---|---|
| 超时 | AbortError/“超时/N 秒内没有返回” | NAI 是；插件类否 | 插件类提示“可能仍在出图” |
| 网络/CORS | “直连失败/无法连接” | 是 | 2s、6s 退避 |
| 5xx | status>=500 | 是 | 2s×2^n，封顶 30s |
| 429 | status 429/“过于频繁” | 是 | 遵 Retry-After，否则 5s×2^n；**触发全局降速**（60s 内请求间隔≥3s） |
| 空图/坏图 | “没有返回图片/解析失败” | 是 | **换种子**，无退避 |
| 审核拦截 | 无可靠信号，仅文案关键词（审核/违规/moderation/safety/blocked） | 否 | 不原词重试，提示改词 |
| 鉴权/参数 | 401/402/403/400、“请先填写/未就绪/请求无效/未检测到” | 否 | 直接红线 |

### C 文字截断自动续写

| 项 | 内容 |
|---|---|
| 现状 | 无检测、无续写 |
| 检测信号 | S1 finish_reason=length（能否取得待真机，取不到则放弃）；S2 区间标签有开无 `-end`（本就可跨楼，不能单独触发）；S3 末尾非句末符号且末行不是完整标签；S4 行尾 `[igs-` 无 `]`、未闭合 `<tag>`、奇数引号。至少两条同时成立才判定（S1 可单独） |
| 误判防护 | 仅对 IGS 发起的回复、收到 ENDED（非 STOPPED）后检测一次；空正文/过短不检；每楼只检一次；上限 1 次；续写无新增就放弃，不重试 |
| 续写 | 优先酒馆 continue（`Generate('continue')` 或点 `#option_continue`），同楼追加；不可用则只提示“可能没写完”+按钮，不自动重生成 |
| 续写后 | 观察器再次 stable → `handleChatStreamStable` 重新 `openViewerFromMessage`，标签自动重新解析 |
| 改动锚点 | `host/chat-stream-observer.js` `onGenerationFinished` 区分 ended/stopped 并回调；`V/reader-host.js` `handleChatStreamStable` 末尾检测；`host/tavern-helper-adapter.js` 新增 `continueGeneration()`；设置 `readerSettings.autoContinue={enabled,max:1}`，建议默认关 |
| 新文件 | `scene/truncation-detect.js`（纯函数 `detectTruncation`） |
| 生图词截断 | `secondary-llm.js` `viaOpenAi` 读 finish_reason，length 时规划器标记 truncated 并重试一次；并入 B 的分类（kind=`truncated-prompt`）。S-M |
| 工作量 | 检测 S；续写接入 M（真机依赖大）；合计 **M-L** |
| 风险 | continue 在 chat/text completion 行为不一，可能整条重写；误判多花 token；续写改变楼层文本，会触发自动出图 `stale` 重写词（`auto-illustration-service.js:315`），续写期间需暂缓出图 |

### D 一键重新生成简化

| 项 | 内容 |
|---|---|
| 现状 | 见 2.3：阅读器内点按钮+确认；设置页进多层弹窗；占位不可点 |
| 简化 | (1) 失败占位点击直接重画，不弹确认（有图的保留确认）；(2) 细线 `notice('error')` 增可选 `action`，红线展开带“重试”；(3) 补全素材遇 `nothing-missing` 先自检丢图，明确说“素材都正常”或“发现 N 张丢图已重画”；(4) 设置页失败格留“重试”，沿用原参数不再弹档位；(5) 重画默认新种子（已有 `randomSeed()`） |
| 改动锚点 | `V/reader-dom-utils.js` `ensureImageEmptyPlaceholder`+`reader-dom-render.js` 事件委托；`reader-host.js` `rerollCurrentIllustration` 加 skipConfirm；`generation-strip.js` `notice`；`settings-actions.js` `-expression-retry:` 路径（约 1500） |
| 新文件 | 无 |
| 工作量 | **S-M** |
| 风险 | 需区分“还在画”与“失败”（读槽位状态），否则可能重复出图（`illustrationPending` 已挡一层） |

### 建议顺序

B 分类+重试+D 可点占位 → A1 阶段/字数/停止 → A2 标签/正则 → A3 小过场 → C 先只提示，真机验证 continue 后再放开。

## 四、验收测试（`app/tests/`，名称 `gate:` 前缀，风格同 `chat-stream-settle.test.js`）

| 测试名 | 文件 | 断言 |
|---|---|---|
| `gate:wait-phases:thresholds-2-8-20` | `wait-phases.test.js` | 假时钟 1.9s 无；2s 小过场；8s 头顶小字；20s 出停止钮 |
| `gate:wait-phases:low-quality-and-hidden-static` | 同上 | low/不可见时无定时动画 |
| `gate:wait-phases:exits-cleanly-on-settle` | 同上 | settle/STOPPED 后计时器清零无残留 DOM |
| `gate:wait-lines:parse-hide-and-keep-latest` | `wait-lines.test.js` | 解析、不进演出队列、正文不可见、只留最近一条、>20 字截断 |
| `gate:wait-lines:prompt-strip-removes-old` | 同上 | PROMPT_READY 后旧楼标签被剥 |
| `gate:wait-regex:registers-display-and-prompt` | 同上 | 两条正则正确且重复注册幂等 |
| `gate:image-retry:classify-table` | `image-retry.test.js` | 7 类输入得正确 kind/retryable |
| `gate:image-retry:429-throttles-globally` | 同上 | 429 后间隔≥3s，60s 后恢复 |
| `gate:image-retry:empty-image-changes-seed` | 同上 | 空图重试换种子 |
| `gate:image-retry:no-retry-on-auth-or-moderation` | 同上 | 只调用一次 |
| `gate:image-retry:nai-not-double-retried` | 同上 | NAI 内层已重试不叠加 |
| `gate:image-retry:plugin-timeout-not-retried` | 同上 | 插件超时只调用一次 |
| `gate:image-retry:disabled-by-setting` | 同上 | 关闭时同现状 |
| `gate:image-retry:silent-then-final-failure-strip` | 扩 `generation-strip.test.js` | 重试中不弹 toastr，终态红线+占位可点 |
| `gate:truncation:detect-signals-and-guards` | `truncation-detect.test.js` | 半截句/未闭合标签/缺 end；停止、空正文、跨楼区间不误报 |
| `gate:truncation:continue-once-and-reparse` | 同上 | 只调一次 continue，续写后重新解析 |
| `gate:truncation:continue-unavailable-falls-back-to-notice` | 同上 | 无接口只提示 |
| `gate:regen:failed-placeholder-click-no-confirm` | `reader-regen.test.js` | 失败占位直接重画，有图仍确认 |
| `gate:regen:nothing-missing-reports-lost-images` | 同上 | 丢图联动文案 |

注意：新函数写在 `reader-host.js` 的 `return host` 之前；`reader-host-hoisting` 在 HEAD 有既有失败；文件用 LF。

## 五、需要用户拍板的问题

1. 等待台词标签用 `[igs-fx:wait|角色名|台词]`（复用 fx 登记，改动小），还是独立 `[igs-wait:角色名|台词]`（要改标签登记点）？
2. 20 秒后的“重试”做什么：只停止；停止并重发上一条输入；还是停止并 swipe 重生成这一楼（会丢半截正文）？
3. 文字截断自动续写默认开还是关？建议首版默认关，只提示“可能没写完，点此续写”，真机验证后再默认开。
4. 智绘姬/柏宝绘/数据库生图遇到超时是否允许自动重试？插件可能仍在出图，重试会重复且费用叠加；建议只重试明确失败。
5. 自动重试默认 2 次、可关是否同意？NAI 自带 3 次，外层是否对 NAI 不再叠加（建议不叠加）？
6. 失败占位“点一下重试”是否不弹确认直接重画？
7. 审核拦截没有可靠信号，只能靠关键词猜，识别不到就按普通失败处理（可能浪费 1-2 次重试），是否接受？
8. 缺省等待文案固定为中性两三句，还是每个皮肤/世界观自带一套？
9. 角色没有 Q 版头像时：显示首字圆章，还是裁立绘头部，还是跳过小过场只显文字？
10. Q 版小过场首版覆盖全屏+网页全屏+楼层内嵌，还是只做全屏和网页全屏？
11. “已写约 N 字”要读酒馆楼层 DOM 文本长度（只读长度不解析），是否可接受？
12. 等待台词标签每轮多约 40-60 字输出和一条约 60 字的提示词，是否可接受？默认开启，还是跟随演出提示词总开关？

## 用户拍板结果（2026-10-11）

| # | 决定 |
|---|---|
| 等待/重试按钮 | 不按总等待时长，按“卡住”判定：首字 60 秒未出，或流式中 45 秒无新字，才出“停止 / 重试”；流式持续出字时不打扰。重试 = 停止并重生成这一楼 |
| 文字截断续写 | **删除 C 项**。续写正文不是 IGS 的功能。“截断素材”改为：检测“这楼本该出图却没发出请求”（正文中断/标签未写完），**只提示**“本楼有素材没生成，点此补发”，不自动补发 |
| 插件出图超时 | 不重试，只重试明确失败 |
| 自动重试 | 默认 2 次、可关；NAI 自带重试，外层不叠加 |
| 失败占位 | 点一下直接重画，不弹确认 |
| 审核拦截 | 关键词猜测，认不出按普通失败处理 |
| 等待台词标签 | `[igs-fx:wait\|角色\|台词]`，复用 fx 登记 |
| 台词开关 | 跟随演出提示词总开关 |
| 覆盖范围 | 全屏 + 网页全屏 + 楼层内嵌 |
| 默认文案 | 每个皮肤/世界观各一套 |
| 无 Q 版头像 | 跳过头像，只显示斜姓名牌 + 台词 |
| 已写字数 | 读楼层文本长度，可以 |

## 素材重试实施与验收记录
- 自动重试默认 2 次、可关：通过（retry-policy.js:8-16，auto-illustration-settings.js:66，次数限 0 到 5）。
- NAI 不叠加重试：通过（retry-policy.js withImageRetry 对 nai 令 max 为 0；image-backend.js:140 只套闸门）。
- 插件出图超时不重试：通过（failure-classify.js pluginTimeout 不在可重试集合；测试 plugin-timeout-not-retried）。
- 审核拦截、鉴权或参数错误不重试：通过（关键词猜测，认不出按普通失败，会多浪费 1 到 2 次重试）。
- 429 冷却：通过（createRateGate，60 秒内间隔不少于 3 秒；NAI 的 Retry-After 读不到，固定按 60 秒）。
- 重试期间静默走细线：通过（bootstrap.js:146 onRetry 转 showImageNotice，不弹 toastr）。
- 失败占位点一下直接重画、不弹确认：通过（reader-host.js:1708 retry-failed-cg 以 skipConfirm 调 rerollCurrentIllustration；工具栏按钮仍确认）。
- 漏发只提示不自动补发：通过（missed-assets.js；仅出图开关开且无生成在跑时出现；每楼版本只提示一次；点击才调手动补出图）。
- 误判防护：通过（旧楼、空正文、标签完整、生成中、出图关闭均不提示，测试 gate:missed-assets:*）。
- 接口对齐：不通过后已修。界面读 rerollSlot 结果的 failure.reason，但 auto-illustration-service.js 的 paintDbgenCaptions 与 generateSlots 汇总结果丢掉了 failure；已把第一个失败的 failure 带到汇总结果上。
- 代码质量：未发现原地改共享配置；重试上限 5 次且总等待封顶 60 秒，无无限重试；CRLF 全部为 0。
- 遗留：重试等待期间关闭出图开关不会中止当前这一张；generateForReader 写词阶段失败不带 failure；分类靠关键词；汇总失败仅带第一个失败原因；未新增 failure 透传的单测。
- 需真机：插件 5xx 后自动重试提示是否显示在细线；占位点击是否不误翻页；半截标签时提示按钮位置与补发是否成功。
