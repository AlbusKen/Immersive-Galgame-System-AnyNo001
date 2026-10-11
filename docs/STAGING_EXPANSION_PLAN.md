# 演出扩展最小锚点实施方案

> 状态：方案稿，未实施。只改内测版（AnyNo001），发布版不动。V = `app/src/visual/igs-ui/`，S = `app/src/scene/`，T = `app/tests/`。
> 行号核对于 2026-10-11，实施前以符号名为准。标签名是建议，统一沿用 `[igs-fx:类型|字段...]` 日常语法。

## 0. 铁律（每项都遵守）

| 规则 | 落实方式 |
|---|---|
| 正文驱动，提示词世界书式开放描述，不堆本地词库 | 提示词只写在 `DAILY_PROMPT_LINES`（V fx-daily-prompt.js:13）或题材包自己的 prompt 块里，一类一两句描述；`DAILY_TRIGGER_WORDS`（S prompt-triggers.js:13）每类 2-4 个词，仅为测试门禁。信息素气味/颜色一律取自正文或角色设定，不建本地气味表 |
| 全部 opt-in | 新 kind 必加入 `DAILY_FX_OPT_IN`（V fx-daily-model.js:26）；题材包 kind 由包自己的 `*_FX_KINDS` 并入该集合（照 `CAMPUS_FX_KINDS`） |
| 省电 | 常驻层只放 CSS 静态/慢动画；`data-igs-quality="low"` 降级（样式写法参照 V comic-style.js:68）；每个 builder 有 `env.reduced` 静态兜底；life 乘 `env.hold` |
| 缓存只读 | 新代码不原地改共享配置/缓存，写时浅拷；读立绘只读 DOM 不改 |
| 不改基础打字机 | 喘息节奏等做成附加层，挂 V typewriter-runtime.js 可选钩子，默认关 |
| 画框原则 | 对话框保持画框；皮肤类装饰用实色，不用半透明 |
| 跟随服装表情 | 变形层/特写/贴片一律读当前立绘的 DOM 背景（积木 B1），不自己缓存图 URL |
| 同页上限 | 沿用 `DAILY_FX_PAGE_MAX=2`；"卡"类共用，常驻层不计（是否放宽见 Q7） |

## 1. 积木层（先做，后面全部挂在上面）

| # | 积木 | 现状（锚点） | 最小改动 | 新文件 | 被谁用 |
|---|---|---|---|---|---|
| B1 | **stage-snapshot 共享读立绘** | V fx-daily.js 私有：`readStageBackground`:109、`layerStyle`:130、`spriteElOf`:228、`spritePosX`:267 | 原样剪切到新模块并 export，fx-daily.js 改为 import（零行为变化，靠现有 fx-daily*.test.js 兜底）。补 `cloneSpriteLayer(root, who, {crop, flip, filter})`：按当前背景/翻转/transform-origin 复刻立绘 DOM（思路同 photo:298 的 DOM 复刻，不用 canvas、不用 mask-image:url） | V `stage-snapshot.js` | 变形层、特写框、贴片、揭晓定格、腺体特写 |
| B2 | **面板组件 panel-kit** | 各 builder 用 `make/spawn/chars/charSpans`（fx-daily.js:59-95，私有）+ 私有 CSS | 抽 `make/spawn/chars/charSpans` 到 V `fx-daily-kit.js`（先搬后用）；新增 `buildPanel({title, rows, tone, skin})`，按 `env.worldview/ancient` 出皮肤（科技蓝/羊皮纸/古籍/血字/综艺粉）；可选取 `getBattleTheme(skin)`（V fx-battle-themes.js:309）变量跟 13 套皮肤，默认不跟 | V `fx-panel-kit.js` | 系统公告、规则怪谈、位份榜、心动榜、线索簿、赏赐清单、介绍卡、检测报告 |
| B3 | **数字滚动 ticker** | V fx-result.js:55 `playResultFx` + fx-result-model.js `rollingFrames`:108、`RESULT_FX_ROLL_MS`:5 | 抽 `rollNumber(node, from, to, ms, {reduced})`（rAF，reduced 直接落终值），`playResultFx` 改调它；加 `rollBars(node, rows)`：条形榜动态排序（transform 位移，不触发 layout 动画） | V `fx-ticker.js` | 到账/竞价/倒计时/票数/心动榜/恩宠/SAN/HP/匹配度 |
| B4 | **连线 link-lines** | 无（V fx-symbols.js 只有漫画符号） | `ensureFxLayers(root).stage`（V fx-layer.js）上挂一层 SVG，`drawLinks(layer, [{from, to, tone, style, label}])`；`style` 含 `line` 与 `mist`（雾状：宽描边+blur 的 CSS filter，静态）；端点由 B1 `spritePosX` + `measureStage`（V fx-anchor.js:140）+ `resolveSpriteHead`:131 算；线用 stroke-dashoffset 一次性描出，常驻静态 | V `fx-links.js` | 红线/关系箭头/嫉妒视线/线索板/光丝/信息素交缠 |
| B5 | **持续滤镜区间 state-filter** | V fx-runtime.js:1018 `setFlag`，`RANGE_ATTRS`:56；S fx-directives.js:6-7 `FX_TAG_KINDS/FX_RANGE_KINDS`；滤镜须并入 V scene-grade.js 的 `--igs-grade-bg/--igs-grade-sprite` | 新区间属性 `data-igs-fx-state=<drunk/poison/hurt/insane/drug/haze/heat/...>`：①fx-directives.js 两数组加 `state` ②fx-runtime.js `RANGE_ATTRS` 加该属性 ③CSS 写 `#igs-stage-motion[data-igs-fx-state="x"]{filter: var(--igs-grade-bg) ...}`，把 grade 变量串进 filter 链而不是覆盖。一个标签 `[igs-fx:state|醉酒|剩余]...[igs-fx:state-end]` 覆盖全部 debuff；边缘脉动用实色径向渐变伪元素，low 画质静态 | V `fx-state-style.js` | 疯狂/中毒/醉酒/受伤/药效/不可名状/发情期/易感期/体温 |
| B6 | **异化滤镜 warp** | 立绘 WAAPI：V sprite-actions.js:22 `playSpriteSpec` | 对 B1 复刻节点或立绘元素叠 CSS filter（invert/hue-rotate/brightness）+ 2-3 帧 clip-path 错位，WAAPI add 叠加，结束还原 | 并入 `stage-snapshot.js` | 异化 NPC、故障、负片、黑眼、威压下的颤抖 |
| B7 | **常驻氛围层/环境音登记模板** | V fx-daily.js:860 `AMBIENCE_HTML`、:896 `resolveAmbience`、:903 `syncAmbience`（回落链 S place-ambience.js -> campus-fx.js -> date-ambience.js，`*_STILL_KINDS`）；V scene-audio.js `AMBIENT_KINDS`:10、`LAYER_ORDER`:132、`MAX_LAYERS=3`:97、`resolveAmbientPlan`:316 | 每包导出 `XXX_AMBIENCE_HTML / XXX_STILL_KINDS / resolveXxxAmbience`，在 syncAmbience:919 的 `||` 链加一项；环境音加进 `AMBIENT_KINDS/AMBIENT_LABELS/VOICES` 并插入 `LAYER_ORDER`（天气之后） | 每包一个 S `*-ambience.js` | 所有地点常驻层 |
| B8 | **题材包模板** | 范本：S campus-fx.js（`CAMPUS_FX_KINDS`、`campusFxOf`、`parseCampusFxBody`） | 每包 = S `<pack>-fx.js`（KINDS/parse/of/提示词块/触发词）+ V `fx-<pack>.js`（`BUILDERS` 片段，合并进 fx-daily.js:276）+ `fx-<pack>-sfx.js`（并入 fx-daily-sfx.js:151 `DEFS`）。接线 6 处：daily-fx-directives.js:9 / :75、fx-daily-model.js:4 / :26、prompt-triggers.js:13、fx-daily-prompt.js:13，再按需 fx-era.js | 每包 3 个 | 恋综、后宫、ABO、COC |
| B9 | **局部裁切 crop-frame** | V fx-runtime.js:45 `resolveCutinCrop(head, aspect, ratio)` 只裁脸 | 泛化 `resolveRegionCrop(sprite, region)`，region 取 face/hand/lip/neck/waist（按 `resolveSpriteHead`/`peekSpriteHead` 的头位置与 `spriteDrawRect`:74 做比例推算，不做像素扫描）；原 cutin 函数不变 | 并入 `stage-snapshot.js` | 局部特写、监控框、腺体特写、放大镜 |
| B10 | **数值条 gauge** | 无 | `.igs-gauge` + CSS 变量宽度，值变化用 B3 `rollNumber` | 并入 `fx-panel-kit.js` | SAN/HP、恩宠、体温、剩余时间 |
| B11 | **气雾 mist（新）** | 无；粒子参考 V fx-daily-particles.js `startPetals` | 单个 `mist` 节点：几层径向渐变（实色渐变+blur filter），颜色由 CSS 变量传入，慢飘用 transform 一次性 WAAPI；low 画质静态，同页最多 3 团 | 并入 `fx-panel-kit.js` 旁 V `fx-mist.js` | 信息素、水汽、香气 |

建议顺序：B1 -> B2 -> B3 -> B8 -> B4 -> B5 -> B6/B9/B10/B11 -> B7（随各包）。B1/B2 纯搬运，先单独提交，跑 `npm run gate` 证零回归。

## 2. 分批计划

量：S=半天内 / M=1-2 天 / L=3 天以上。世界观列：通=不分；现=加进 `FX_ERA_MODERN_ONLY`（S fx-era.js:9）；古=加进 `FX_ERA_ANCIENT_ONLY`（:24）；换皮=builder 内按 `env.ancient` / `.is-<worldview>` 切（S worldview.js:22 `worldSkinOf`）。

### 第一批：积木 + 最高价值（变形层、戏剧节拍、骰子、人生大事、恋综包、后宫包、ABO 包）

#### 1A 立绘变形层

| 演出 | 标签 | 依赖 | 改动锚点 | 新文件 | 世界观 | 量 |
|---|---|---|---|---|---|---|
| 镜中倒影 | `[igs-fx:mirror\|角色]` | B1 | fx-daily.js BUILDERS 加 `mirror`；与已有 `fitting`（镜内无人）互补：镜内放翻转复刻节点 | V fx-transform.js | 通 | M |
| 车窗/水面倒影 | `[igs-fx:reflect\|车窗/水面\|角色]` | B1 | 同上；水面垂直翻转+渐隐，波纹仅 normal 画质 | 同上 | 通 | S |
| 剪影/磨砂玻璃身影 | `[igs-fx:silhouette\|角色\|玻璃/逆光]` | B1 | 复刻节点 `filter:brightness(0)`；磨砂=blur+实色底。禁止 mask-image:url（V romance-style.js:2） | 同上 | 通 | S |
| 监控框/全息投影/回忆气泡框 | `[igs-fx:frame\|监控/全息/回忆\|角色]` | B1+B9+B2 | 三套框皮肤；监控加 REC 角标与静态扫描线 | 同上 | 监控现；全息科幻；回忆通 | M |
| 异化（故障/错位/黑眼/负片） | `[igs-fx:warp\|角色\|样式]` | B6 | 作用于真立绘元素；恐怖世界观加强 | stage-snapshot.js | 通 | M |
| 局部特写框 | `[igs-fx:zoom\|角色\|手/唇/眼/颈]` | B1+B9 | `resolveRegionCrop` 裁复刻节点，弹出小窗 | fx-transform.js | 通 | M |
| 立绘局部贴片 | `[igs-fx:mark\|角色\|部位\|样式]` | B1+B9 | **先评估**（Q1）。最小实现：绝对定位伪元素叠在头部锚点附近，不处理衣领遮挡 | fx-transform.js | 通 | L |

#### 1B 戏剧节拍

| 演出 | 标签 | 依赖 | 改动锚点 | 新文件 | 世界观 | 量 |
|---|---|---|---|---|---|---|
| 揭晓定格 | `[igs-fx:reveal\|大字\|副字]` | B1+B9 | 立绘暂停（fx-daily.js:182-226 邻近的 `FREEZE_SPEC`）+ 扫视 + `charSpans` 大字砸下 + `playCameraImpact`（V camera-impact.js:55） | V fx-beats.js | 换皮 | M |
| 系统/公告面板 | `[igs-fx:panel\|类型\|标题\|行1;行2]` | B2 | 类型：系统/副本公告/任务/结算/突破；皮肤按世界观 | fx-beats.js | 换皮 | M |
| 数字滚动卡 | `[igs-fx:count\|标签\|起\|止\|单位]` | B3 | 到账/竞价/比分/倒计时/存活/积分同一 builder | fx-beats.js | 通 | S |
| 证物/道具甩出卡 | `[igs-fx:evidence\|名称\|描述]` | 复用 `showItemCard`（V fx-item.js:446） | 只加"甩出"入场变体与证物皮肤 | 无 | 通 | S |
| 红线牵连线 | `[igs-fx:link\|A\|B\|红线/视线/光丝]` | B4 | 同页最多 3 条 | fx-links.js | 通 | M |
| 众人反应 | `[igs-fx:crowd\|转头/鞠躬/倒吸]` | V crowd-fx.js `buildCrowdSvg`:176 / `resolveCrowdReaction`:37 | 加 reaction 档位；同屏立绘一起行礼走 `castReact` | 无 | 通 | M |
| 壁咚/捏下巴/挡剑/坠落/落水 | 并入 `[igs-fx:cam\|镜头\|角色]` | S fx-directives.js:98 `FX_CAMERA_SHOTS` + V sprite-actions.js `playSpriteSpec` | 只往 `FX_CAMERA_SHOTS` 加镜头条目；落水接已有 splash/dive | 无 | 通 | S |
| 慢动作回眸重逢 | `[igs-fx:reunion\|角色]` | B1 | 立绘转身+光晕+短定格 | fx-beats.js | 通 | S |

#### 1C 骰子扩展

现状：V fx-result-model.js:52 `buildResultFxPlan` 已支持 `check`(1d100)、`contest`(对抗)、`fixed`；`reels` 已是数组可多骰；`RESULT_TIERS`（fx-result.js:12）已含 crit/extreme/hard/regular/fumble。结论：多骰池与暴击档不需要新机制，缺的是 d4-d20 骰面外观与骰池汇总。

| 演出 | 触发 | 改动锚点 | 新文件 | 量 |
|---|---|---|---|---|
| 多面骰 d4-d20 + 骰池 | `choices/dice-check.js` `parseDiceCommand`:56 / `resolveDiceCommand`:196 返回 `detail.kind='pool'` | fx-result-model.js `buildResultFxPlan` 加 `pool` 分支（复用 `reel()`）；fx-result.js 按面数换骰面 CSS | 无 | M |
| 大成功/大失败特效 | 已有 tier | 只补 CSS（白闪/裂纹）+ `playCameraImpact` | 无 | S |
| 对抗分屏 | `contest` 已有 | 左右各挂立绘头像（B9 face） | 无 | S |
| 先攻顺序条 | `[igs-fx:order\|A;B;C]` | B2 + Q 版头像 | fx-beats.js | M |

#### 1D 人生大事与节日

| 演出 | 标签 | 依赖 | 改动锚点 | 新文件 | 世界观 | 量 |
|---|---|---|---|---|---|---|
| 生日吹蜡烛 | `[igs-fx:birthday]` | 已有 `candle`（fx-daily.js） | candle 上加蛋糕变体；彩带粒子给 `PETAL_KINDS`（fx-daily-particles.js:673）加 `confetti` | V fx-festival.js | 现 | S |
| 新年倒数 | `[igs-fx:countdown\|N]` | B3 + `startFireworks` | 倒数到 0 放烟花；古代换爆竹春联 | fx-festival.js | 换皮 | S |
| 圣诞点灯 | `[igs-fx:xmas]` | 粒子 | 灯串 CSS + 复用 weather-fx-particles.js 雪 | 同上 | 现/西幻 | S |
| 红包/情人节礼物 | `[igs-fx:redpacket\|金额]` | B3 + `showItemCard` | 红包卡+金额滚动；礼物皮肤 | 同上 | 通 | S |
| 求婚戒指 | `[igs-fx:ring]` | showItemCard + 聚光 | 戒盒开合 + 闪光 | 同上 | 通 | S |
| 婚礼（西式/拜堂） | `[igs-fx:wedding\|西式/中式]` | B1 | 西式=花瓣+钟声；中式=红盖头（复刻立绘+红布）+合卺酒 | 同上 | 换皮 | M |
| 验孕 / 花灯河灯 | `[igs-fx:test]` / `[igs-fx:riverlamp]` | 验孕=panel；河灯复用 `startLanterns`（fx-daily-particles.js） | 河灯加水面横移变体 | 同上 | 通/古 | S |

#### 1E 恋综包（B8 模板，`FX_ERA_MODERN_ONLY`）

| 演出 | 标签 | 依赖 | 改动锚点 | 新文件 | 量 |
|---|---|---|---|---|---|
| 嘉宾入场介绍卡 | `[igs-fx:guest\|姓名\|年龄\|职业\|标签1;标签2]` | B2 | 综艺字幕样式（实色粉底+斜条） | S variety-fx.js；V fx-variety.js | S |
| 综艺花字 | `[igs-fx:caption\|粉字/贴纸/盖章/黑底\|文本]` | `charSpans` | 4 种：粉色大字、贴纸、名场面盖章、黑底字幕"然而他不知道的是……" | 同上 | S |
| 采访间 / 内心 OS | `[igs-fx:interview\|角色]`...`[igs-fx:interview-end]` | B5 区间 | 加 `data-igs-fx-interview` 进 RANGE_ATTRS；单色背景、立绘居中看镜头、OS 字幕条 | 同上 | M |
| 观察室画中画 + 评论弹幕 | `[igs-fx:observe]` | V danmaku-live.js / danmaku-runtime.js + 分屏 | 分屏参考通话分屏 `data-igs-fx-call-split`；评论走弹幕池，加"观察员"池（danmaku-pools.js） | 同上 | M |
| REC 角标 / 切镜 | `[igs-fx:rec]` | 区间 | 角标静态；切镜用 `playCameraImpact` 短版 | 同上 | S |
| 心动短信 / 匿名投票 | `[igs-fx:vote\|A:3;B:1]` | B2+B3 | 信封揭晓+票数滚动 | 同上 | M |
| 心动值排行榜 / 心率手环 | `[igs-fx:rank\|A:80;B:65]` / `[igs-fx:pulse\|数值]` | B3 `rollBars` | 动态排序条形榜；手环数字 `rollNumber` | 同上 | M |
| 关系箭头图 | `[igs-fx:relmap\|A>B;B>C]` | B4 | Q 版头像节点 + 箭头 | 同上 | M |
| 约会抽卡配对 / 交换 / 淘汰 / 告白之夜 | `[igs-fx:pair]`、`[igs-fx:exit\|角色]`、`[igs-fx:finale\|选择]` | 现有 `gacha` builder 改参 | 淘汰=立绘淡出+行李箱；告白之夜=走向对方（`playSpriteSpec` 位移）+灯牌点亮 | 同上 | M |
| 心动瞬间回放 | `[igs-fx:replay]` | B1 + 镜头 | 同一帧三次推近 + REPLAY 角标 | 同上 | S |
| 恋爱小屋常驻层 + 环境音 | place 命中小屋/客厅/泳池/露台 | B7 | 客厅暖光、厨房、泳池(静态水波)、露台夜景；环境音 `cabin` | S variety-ambience.js | M |
| 网友热评 | 并入舆论风暴 | V live-chatter.js / danmaku-audience.js | 加"综艺热评"话术池 | 无 | S |

#### 1F 后宫妃子包（B8 模板，`FX_ERA_ANCIENT_ONLY`）

| 演出 | 标签 | 依赖 | 改动锚点 | 新文件 | 量 |
|---|---|---|---|---|---|
| 位份晋升/降位卡 + 册封圣旨 | `[igs-fx:rank-up\|角色\|旧位\|新位]` | B2 + 已有 `edict`（fx-daily.js:468） | 位份阶梯：答应-常在-贵人-嫔-妃-贵妃-皇贵妃-皇后，高亮当前，可降；册封走 edict 卷轴变体 | S harem-fx.js；V fx-harem.js | M |
| 恩宠值条 / 六宫位份榜 | `[igs-fx:favor\|角色\|数值]`、`[igs-fx:board\|...]` | B3+B10 | gauge + 榜单 | 同上 | M |
| 翻牌子 / 选秀殿选 | `[igs-fx:flip\|角色]`、`[igs-fx:select\|留牌子/撂牌子]` | B2 | 绿头牌托盘，牌子被翻起（CSS 3D 一次）；殿选复用 | 同上 | S |
| 敬事房记档 / 凤鸾春恩车 | `[igs-fx:record\|留/不留]` | B2 | 记档卡；车为静态图标+一次移动；NSFW 衔接见 Q6 | 同上 | S |
| 太监通传 + 众人跪迎 | `[igs-fx:announce\|皇上驾到]` | crowd-fx + `castReact` | 大字通传 + 同屏立绘一起行礼 | 同上 | M |
| 晨昏定省站位 | `[igs-fx:greet]` | 同屏 cast 站位（`SLOT_CENTER_X`） | 众妃按位份排站，顺序取 B2 阶梯表 | 同上 | M |
| 赏赐清单卷轴 | `[igs-fx:reward\|物1;物2]` | `showItemCard` + edict 卷轴 | 卷轴逐行展开，每项调 showItemCard 角落小卡 | 同上 | S |
| 银针验毒 / 滴血验亲 / 巫蛊人偶 | `[igs-fx:probe\|银针/滴血/人偶]` | B2 | 银针变黑=CSS 渐变一次；滴血=水碗两滴合；人偶=证物卡变体 | 同上 | M |
| 掌嘴 / 禁足落锁 / 打入冷宫 | `[igs-fx:punish\|掌嘴/禁足/冷宫]` | B5 + B7 | 掌嘴=镜头冲击；禁足=宫门落锁卡；冷宫=褪色破败常驻层（静态） | 同上 | M |
| 赐死托盘 | `[igs-fx:tray\|白绫/毒酒/匕首]` | B2 | 托盘静态卡 | 同上 | S |
| 有孕 / 太医悬丝诊脉 | `[igs-fx:thread]`、`[igs-fx:congrats]` | B4 | 丝线连接手腕（一条） | 同上 | S |
| 宫宴献艺 | 复用 `dance`/`guqin` | 无新增 | 仅提示词提一句 | 无 | S |
| 众妃嫉妒目光 | `[igs-fx:glare\|A;B;C>目标]` | B4 | 多条视线汇聚一人 | 同上 | S |
| 宫殿常驻层 + 打更环境音 | place 命中寝宫/御花园/冷宫/长街 | B7 | 4 种常驻层 + 打更/宫灯环境音（`LAYER_ORDER` 末位） | S harem-ambience.js | M |

#### 1G ABO 包（B8 模板，独立开关，不进任何 `FX_ERA_*_ONLY`）

开关设计：`readerSettings.aboFx.enabled`（默认 false，写时浅拷），为包级总开关；包内 kind 仍各自在 `DAILY_FX_OPT_IN`。fx-era.js 的 `stripExclusive` 不涉及它，现代/古风/西幻均可用。气味名、颜色由正文标签字段携带（如 `[igs-fx:scent|角色|雪松|#8a6a4a]` 的颜色可省，省略时取角色主题色），不建本地词库。

| 演出 | 标签 | 依赖 | 改动锚点 | 新文件 | 量 |
|---|---|---|---|---|---|
| 信息素可视化 | `[igs-fx:scent\|角色\|气味名\|颜色]` | B11 + B1 | 头部锚点（`resolveSpriteHead`）处浮一团气雾 + 气味名小字（`charSpans`）；色取标签或角色主题色 | S abo-fx.js；V fx-abo.js | M |
| 信息素交缠 | `[igs-fx:scent-link\|A\|B]` | B4 `mist` 样式 + B11 | 两团气雾间一条雾状连线 | 同上 | S |
| 信息素压制（威压） | `[igs-fx:suppress\|施压者\|范围]` | B5(短) + B6 + `applyStageShakeEffect` | 画面压暗（grade 变量）+ 轻震 + 其他立绘下沉/颤抖（`playSpriteSpec` WAAPI）+ 对话框字重加沉（只改 CSS 变量，不碰基础打字机） | 同上 | M |
| 信息素安抚 | `[igs-fx:soothe]` | B11 + grade | 柔光、雾变暖（CSS 变量换色）、心跳放缓（romance-senses 心跳音降速参数） | 同上 | S |
| 发情期 / 易感期 | `[igs-fx:state\|heat/rut\|剩余]`...`[igs-fx:state-end]` | B5 + B10 | `data-igs-fx-state=heat/rut`：潮红晕染（grade 变量串联）、视野边缘脉动（实色径向渐变）、心跳；剩余时间用 gauge；喘息打字为 §4 附加层，此处只挂开关 | 并入 fx-state-style.js | M |
| 抑制剂注射 / 阻隔贴 / 失效警示 | `[igs-fx:inhibitor\|注射/阻隔贴/失效]` | `showItemCard`（fx-item.js:446） | 物品小卡；失效=红色警示变体 | 无 | S |
| 腺体特写 | `[igs-fx:zoom\|角色\|颈]` | B9 `neck` 区域 | 后颈特写框 | 无（用 fx-transform.js） | S |
| 标记咬痕（临时/终身） | `[igs-fx:bond\|角色\|临时/终身]` | B1+B9 + 贴片（Q1） | 临时=淡痕贴片；终身=专属印记动画（一次性描边+光脉冲）；贴片不可行时退化为特写框内的咬痕图标 | fx-abo.js | M |
| 第二性别分化 / 检测报告卡 | `[igs-fx:gender-test\|角色\|结果]` | B2 + `evidence` | 报告=证物卡变体，结果行字符逐字揭晓 | 同上 | S |
| 信息素匹配度 | `[igs-fx:match\|A\|B\|百分比]` | B3 | 数字滚动 + 心形环（CSS） | 同上 | S |
| 筑巢 | `[igs-fx:nest]` | 服装散落图标（romance-intimate-style.js）+ B7 | 衣物图标堆叠成圈的小常驻徽标，一次动画 | 同上 | S |
| 信息素检测仪 / 警报 | `[igs-fx:detector\|浓度]` | B2 + B3 + B10 | 仪表条 + 超标闪红；公共场所警报声合成（fx-daily-sfx.js DEFS 新增，不复用 `siren-*`） | 同上 | M |
| NSFW：成结 / 标记 / 怀孕节拍 | 并入 §4 `peak` 档位与 `bond` | §4 | 只写机制：成结=持续计数/余韵层（沿用 §4），标记=`bond`，怀孕=`test` | 无 | S |

#### 1H 神话妖魔包（B8 模板，封神/山海/志怪）

世界观：整包加进 `FX_ERA_ANCIENT_ONLY.dailyFx`（与修仙同组，S fx-era.js:24）。西幻可共享的"妖魔部分"（妖气、现原形/化形、九尾、魅惑、吸取精气、降妖符印、结界、妖丹、契约印记）另列 `FX_MONSTER_SHARED`，同时对 ancient 与 magic 世界观放行（在 `FX_WORLDVIEW_ONLY` 之外加一张共享表，或在 `stripExclusive` 里允许两个 owner）；封神榜、法宝、阵法、天庭、幽冥等东方专属项仍只对古代开放。法宝名、阵法名、妖物名全部取自正文字段，不建本地词库。

| 演出 | 标签 | 依赖 | 改动锚点 | 新文件 | 世界观 | 量 |
|---|---|---|---|---|---|---|
| 法宝祭出 | `[igs-fx:relic\|持有者\|法宝名\|样式]` | B1 + `charSpans` + `playSpriteSpec` | 从持有者立绘身侧（`spritePosX`）飞出、放大、环形光（CSS 实色光环，一次 WAAPI），名称小字 | S myth-fx.js；V fx-myth.js | 古 | M |
| 法宝对撞斗法 | `[igs-fx:clash\|A法宝\|B法宝]` | 上条 + `playCameraImpact` + `applyStageShakeEffect` | 两件法宝对飞相撞，白闪 + 冲击环 + 轻震 | 同上 | 古 | M |
| 封神榜 | `[igs-fx:mythroll\|名1;名2;名3]` | B2 + B3 的逐行节拍 + B4 | 金榜卷轴展开（复用 edict 卷轴 fx-daily.js:468），名字逐个亮起，魂光（小圆点 WAAPI）飞向封神台图标；独立标识避免与校园点名 rollcall 冲突 | 同上 | 古 | M |
| 阵法 | `[igs-fx:formation\|阵名\|展开/入阵/破阵]` | B5(短) + 粒子 | 地面阵图（SVG 描边，一次旋转后静态）；入阵=区间滤镜换色；破阵=图案 clip-path 碎裂 | 同上 | 古 | M |
| 元神出窍 | `[igs-fx:spirit\|角色]` | B1 `cloneSpriteLayer` + B6 | 复刻立绘半透明 + 发光 filter，缓缓上浮离体；本体 WAAPI 轻微失神下沉 | fx-transform.js | 古 | S |
| 三昧真火 / 雷部天雷 | `[igs-fx:flame]`、`[igs-fx:thunder-strike\|目标]` | 粒子 + 白闪 | 单次演出；天雷复用已有雷声（weather-fx-particles.js 的 thunder 调度不常驻），火焰 CSS 渐变一次 | fx-myth.js | 古 | S |
| 天庭/南天门、妖市鬼市、幽冥黄泉（彼岸花）、妖洞 | place 命中 | B7 | 4 种常驻层（云海+金阙 / 灯笼+雾 / 红花静态+暗紫 / 洞穴暗角）+ 环境音：天风、集市嘈杂、冥河水声、洞穴滴水 | S myth-ambience.js | 古（妖洞可共享） | M |
| 妖气 | `[igs-fx:aura\|角色\|妖气/魔气/仙气]` | B11 + B6 | 黑紫气雾缠身（颜色变量），竖瞳=B6 异化的 `eye` 样式（对头部锚点叠竖瞳贴片） | fx-myth.js | 共享 | S |
| 现出原形 / 化形 | `[igs-fx:shift\|角色\|原形名]` | B1 + 剪影 + 变身 form | 立绘转剪影（`brightness(0)`，不用 mask），背后投出巨大兽影：兽影是预置 SVG 剪影部件（尾/耳/角/翼，通用形状，原形名只影响选哪些部件与色），人形与原形转场用 `FREEZE_SPEC` 短停 + 淡切。服装/形态读取 S character-outfits.js 的 `form`（`normalizeOutfitForm`:5），转场结束后立绘换到该形态的素材，不新画图 | fx-transform.js | 共享 | L |
| 九尾展开 | `[igs-fx:tails\|角色\|数量]` | 上条的剪影尾部件 | 身后剪影尾巴逐条展开（delay 递增 WAAPI），数量取标签，上限 9 | fx-myth.js | 共享 | M |
| 魅惑 | `[igs-fx:charm\|施术者\|目标]` | B11 + B5 | 粉雾（B11）+ 目标侧持续区间 `data-igs-fx-state=charm`：视野迷离（blur 边缘 + 暖色 grade 串联）；对话字体轻飘仅改 CSS 变量（字距/基线轻摆），不碰基础打字机 | 并入 fx-state-style.js | 共享 | M |
| 吸取精气/灵气 | `[igs-fx:drain\|吸取者\|被吸者]` | B4 光丝变体 + B6 | 光丝从被吸者流向吸取者（stroke-dashoffset 循环，low 静态）；被吸者立绘 `saturate/brightness` 褪色（WAAPI add，结束还原） | fx-links.js | 共享 | M |
| 照妖镜 | `[igs-fx:truemirror\|角色\|原形名]` | **mirror 积木（1A）+ shift 的剪影部件** | 直接复用 `mirror`：镜框、镜面、翻转复刻节点流程不变，唯一差异是镜内内容。镜内节点 = 本人 `cloneSpriteLayer` 的剪影（`brightness(0)`）+ 叠 shift 同款兽影部件（按原形名选择），金光扫过一次；镜外立绘保持人形不变。因此 `truemirror` 只是 `mirror` 的 `content: 'true-form'` 参数变体，不新写镜框。样式随服装/表情差分仍由 B1 读取，但镜内是剪影故差分不可见，镜外保持正常差分 | 并入 fx-transform.js | 共享 | S |
| 降妖：符咒 / 金钵 / 葫芦 / 锁链 | `[igs-fx:subdue\|符咒/金钵/葫芦/锁链\|目标]` | B1 + `playSpriteSpec` | 符咒=贴片落在目标头部锚点；金钵=从上罩下（clip-path）；葫芦=目标立绘缩小被吸入（WAAPI 位移+缩放）；锁链=缠绕线（SVG 描边一次） | fx-myth.js | 共享 | M |
| 结界展开/破碎 | `[igs-fx:barrier\|展开/破碎]` | 粒子 | 半球线框（描边，非半透明填充）展开；破碎=clip-path 碎片散开 | 同上 | 共享 | S |
| 妖丹亮相 | `[igs-fx:core\|名称]` | `showItemCard`（fx-item.js:446） | 物品亮相的"妖丹"皮肤（光脉冲） | 无 | 共享 | S |
| 血契 / 主仆契约印记 | `[igs-fx:pact\|甲\|乙]` | B1 + B9 贴片(Q1) + B4 | 印记贴片落在双方立绘上，一条短线连接，印记亮起一次；贴片不可行时退化为头像旁印记徽标 | 同上 | 共享 | M |

### 第二批：COC/无限流、侦探、场景长尾

| 演出 | 标签 | 依赖 | 改动锚点 | 新文件 | 世界观 | 量 |
|---|---|---|---|---|---|---|
| SAN/HP 条 + 掉理智扭曲 | `[igs-fx:san\|数值\|变化]` | B10+B5+B6 | 条下降 + `insane` 滤镜短播 | S coc-fx.js；V fx-coc.js | 通 | M |
| 疯狂症状卡 + 持续 debuff | `[igs-fx:state\|疯狂/中毒/醉酒/受伤/药效]` | B5 | 同 B5，症状卡为 panel | fx-coc.js | 通 | M |
| 不可名状 | state=`haze` | B5 | 实色径向渐变收窄视野 + 噪点 CSS（不用 mask-image:url） | 同上 | 恐怖 | S |
| 线索卡 + 线索簿 | `[igs-fx:clue\|名称\|描述]` | B2 + showItemCard | 卡走物品小卡，簿走 panel | 同上 | 通 | M |
| KP/DM 旁白框 | 并入 `data-igs-fx-presentation` 报幕态（V fx-style.js:293 邻近） | 无 | 独立框样式，仅换皮 | 无 | 通 | S |
| 撕卡/团灭结局卡 | `[igs-fx:ending\|团灭/撕卡]` | B2 + reveal | 揭晓+撕裂 clip-path | 同上 | 通 | S |
| 副本公告/传送转场/结算评级/存活人数 | panel 类型 + count | B2/B3 | 传送转场=`eye` 遮罩短版（fx-runtime.js:696） | 同上 | 通 | M |
| 规则怪谈纸条 | `[igs-fx:rules\|规则1;规则2\|篡改:2\|违规:3]` | B2 | 某条被血迹（实色块）覆盖、违规行变红 | 同上 | 恐怖/通 | M |
| 主神空间/雾港小镇 常驻层 | place 命中 | B7 | 白色空间 / 雾港 | S coc-ambience.js | 换皮 | M |
| 1920 年代变体 | 见 Q4 | S fx-era.js | 待拍板 | 无 | 新 | M |
| 对抗检定分屏、多骰池 | 见 1C | | | | | |
| 推理线索板 / 搜证放大镜 / 指认定格 | `[igs-fx:board]`、`[igs-fx:magnify\|角色\|部位]`、`[igs-fx:accuse\|角色]` | B4+B9+reveal | 线索板=B4；放大镜=圆形裁切；指认=reveal | S detective-fx.js | 通 | M |
| 警戒线 + 红蓝警灯 | 常驻层 | B7 | 两色交替 CSS，low 静态 | 同上 | 现 | S |
| 电梯 | `[igs-fx:elevator\|楼层]` | B3 + 遮罩 | 楼层数字滚动 + 左右实色门板 + 叮 | V fx-places.js | 现 | S |
| 门缝偷听 + 隔墙闷音 | `[igs-fx:eavesdrop]` | 区间 + 低通 | 画面=门缝遮罩；声音见 Q2 | 同上 | 通 | M |
| 演唱会 / 记者闪光灯连闪 | `[igs-fx:concert]`、`[igs-fx:flashes]` | crowd-fx + 白闪 | 荧光棒=剪影上小亮点（限 12 个，low 静态） | 同上 | 现 | M |
| 起跑/冲线/记分牌 | 并入 count + 哨声 | B3 | 哨声加 fx-daily-sfx.js | 同上 | 现 | S |
| 开宝箱 / 升级弹窗 / 委托板 / 地图路线 | `[igs-fx:chest]`、`[igs-fx:levelup]` 等 | showItemCard + panel | 西幻/游戏向 | 同上 | 通/换皮 | M |
| 厨房/医院/便利店/洋馆/霓虹雨夜/祭典/体育馆/地下城 常驻层 + 环境音 | place 命中 | B7 | 每个一块 AMBIENCE_HTML + 一种环境音，逐个按需 | 各 `*-ambience.js` | 换皮 | 每个 S |
| 古风打更 / 市井叫卖 | 环境音 | B7 | 并入后宫包打更 | 无 | 古 | S |
| 天台风吹立绘摆动 | 常驻 | `playSpriteSpec` | 低频摆动，low 关 | fx-transform.js | 通 | S |
| 摔倒/撞人 | 按描述触发 | 复用 cam 抖动 | 只加提示词一句 | 无 | 通 | S |

### 第三批：长尾与打磨

| 项目 | 内容 | 量 |
|---|---|---|
| 日常卡片接皮肤 | 见 Q3；B2 的"跟皮肤"选项 | M |
| 常驻层省电审计 | 逐层检查 low 画质与 reduced | S |
| 提示词预算复查 | 超预算的 kind 照 `WARDROBE_FX_KINDS`/`PLAY_FX_KINDS` 分组做"正文提到才补"（S daily-fx-directives.js） | M |
| DLC 化 | 低频演出先走 `registerDlcFx`（S fx-registry.js:46）+ V dlc-fx-runtime.js 原型，验证后再并入核心 | 视情况 |

## 3. 世界观与时代变体汇总

| 机制 | 做法 |
|---|---|
| 恋综包仅现代 | 所有恋综 kind 加进 `FX_ERA_MODERN_ONLY.dailyFx`（S fx-era.js:9-14） |
| 后宫包仅古代 | 所有后宫 kind 加进 `FX_ERA_ANCIENT_ONLY.dailyFx`（:24） |
| 神话妖魔包 | 东方专属项（法宝、封神榜、阵法、元神、天雷、天庭/幽冥常驻层）进 `FX_ERA_ANCIENT_ONLY`；妖魔共享项（妖气、原形、九尾、魅惑、吸取、降妖、结界、妖丹、契约）进新增共享表 `FX_MONSTER_SHARED`，对 ancient 与 magic 放行，其余世界观拨成关（改动点 S fx-era.js `FX_WORLDVIEW_ONLY`:36 与 `stripExclusive`） |
| ABO 包不限时代 | 不进任何专属表，用独立开关 `aboFx.enabled`；画面按 `env.ancient/.is-<worldview>` 换皮（古风=淡墨雾、西幻=魔力雾） |
| 面板/揭晓换皮 | builder 内取变量（科技蓝/羊皮纸/古籍/血字） |
| 1920 年代 | 待 Q4 |
| 陷阱 | fx-era.js 的专属表互斥；每新增 kind 必须落在恰好一张专属表或"通用/独立开关"，测试覆盖 |

## 4. NSFW 批（直白型，全部默认关、opt-in，仅内测版）

只写机制，不写露骨描述。总开关沿用亲密演出设置（V romance-settings.js），以下全部挂其下新增子项默认 false，发布版不合入。已删除的回避类演出：拉窗帘遮罩、台灯局部光圈、锁门卡、任何拉灯/黑屏跳过。ABO 的 NSFW 节拍并入本章。

| 演出 | 标签/触发 | 依赖 | 改动锚点 | 新文件 | 量 |
|---|---|---|---|---|---|
| CG 连续挂图运镜节奏 | 无标签：CG 连续出现时按正文节奏推近/摇移 | 现有 `syncCgPan`（V romance-cg-pan.js:44）、`cancelCgPan`:35 | 给 syncCgPan 加"节奏档"参数（慢/中/快），由页面文本长度与情绪决定；不改挂图逻辑 | 无 | M |
| 局部特写框（CG/立绘） | `[igs-fx:zoom\|目标\|部位]` | B9 | 对 CG 背景按比例裁切；CG 无头部标定，用 `cg-portrait.js` 已有头颈肩位置或手动区域参数 | 无 | M |
| 高潮节拍（分 3 档） | `[igs-fx:peak\|1-3]` | `playCameraImpact`、`applyStageShakeEffect`（V stage-shake-runtime.js:79）、心跳音（romance-senses） | 白闪+震动+心跳+大字；reduced 只出大字 | V romance-peak.js | M |
| 体位/姿势变化镜头切换 | 随 CG 换图自动 | V cg-portrait.js 换图事件 | 换图时短切镜（淡入+微推），可关 | 并入 romance-cg-pan.js | S |
| 汗/潮红/痕迹贴片 | `[igs-fx:mark\|...]` | B1+B9 | 同 1A 贴片；评估不通过则退化为 CG 头像旁小徽标 | fx-transform.js | L |
| 喘息式打字节奏 | 附加层，亲密区间/发情期内 | V typewriter-runtime.js / typewriter-audio.js | 对台词加断句停顿，钩子参照 `slowerTypewriterSpeed`（V romance-moments.js:72），默认关，不改基础打字机 | V typewriter-breath.js | M |
| 内心 OS 小字 | `[igs-fx:os\|文本]` | `charSpans` | 屏幕一角小字淡入淡出 | fx-beats.js | S |
| 次数/持续计数器（可选） | `[igs-fx:counter\|N]` | B3 | 角落小数字，默认关 | romance-peak.js | S |
| 贴耳 TTS | TTS 既有 | V tts.js + audio-bus | 亲密区间 TTS 声像拉近+低音量+轻混响（`setAudioBusSpace`，audio-bus.js:86）；见 Q2 | 无 | M |
| 事后余韵层 / "凌乱"差分 | 区间尾部自动 / `[igs-fx:aftermath]` | B7 + 衣服回落 | 余韵=低饱和暖色静态层；"凌乱"=走现有表情/服装差分标签，不新画图 | V romance-aftermath.js | M |
| 体温/醉酒/药效 debuff | `[igs-fx:state\|...]` | B5 | 同 B5 | 无 | S |
| 衣物散落常驻图标 | 按当前服装 | 服装状态 | 小图标条，按已脱衣物显示（ABO 筑巢复用） | 并入 romance-intimate-style.js | S |
| 气氛升温分档常驻层 | 现有 `romance` 区间 | V romance-intimate-runtime.js | 扩 3 档，CSS 变量 | 无 | S |
| 题材化 | 古风红烛床幔 / 修仙双修光丝+修为数字 / 系统好感度提示 / 西幻契约印记 / 后宫门外脚步 / ABO 成结余韵 | B4+B3+各包 | 各为换皮变体，不新增机制 | 无 | 各 S |
| 人外特征贴片 | 随形态（`form`）显示 | B1+B9 + S character-outfits.js `normalizeOutfitForm` | 耳/尾/角/鳞贴片按当前形态是否为非人形显示；位置按头部锚点近似（同 Q1 限制），尾/角可复用 shift 的剪影部件 | 并入 fx-myth.js | S |
| 魅惑 / 采补·双修精气流动 | 并入 `charm`、`drain` | B4 光丝变体 + B3 | 亲密区间内光丝双向/单向流动，附修为或精气数字滚动 | 无 | S |
| 契约印记发光 | 并入 `pact` | 同上 | 亲密区间内印记按节拍亮起（`peak` 档位驱动 CSS 变量） | 无 | S |
| 后宫侍寝衔接 | 接 `record` | 上述全部 | 见 Q6 | 无 | S |

## 5. 验收

通用：每批 `npm run gate` 通过（structure + static + test + simulate + perf + build）；新增测试名以 `gate:` 开头；README 更新日志与版本号同步（见 CLAUDE.md）；只推内测版。

| 批 | 新增/修改测试（T） | 断言要点 |
|---|---|---|
| 积木 | `gate:stage-snapshot-reads-current-sprite`、`gate:fx-daily-kit-moved-no-regression`、`gate:ticker-reduced-final-value`、`gate:links-no-canvas`、`gate:state-filter-keeps-grade-vars`、`gate:mist-low-static` | B1 搬运后 fx-daily*.test.js 全绿；reduced 直接落终值；B1/B4/B11 源码不含 canvas / mask-image:url；B5 的 filter 链含 `--igs-grade-*` |
| 每个新 kind | 扩 `fx-daily.test.js`，各包新增 `fx-<pack>.test.js` | kind 在 `DAILY_FX_KINDS`、`DAILY_FX_LABELS`、`DAILY_FX_OPT_IN`、`DAILY_TRIGGER_WORDS`、`DAILY_PROMPT_LINES`、sfx `DEFS` 六处均有；默认 false；旧存档载入不触发 |
| 时代 | 扩 `fx-daily-ancient.test.js` + `gate:era-pack-exclusive` | 恋综 kind 古代被拨掉、后宫 kind 现代被拨掉；`FX_WORLDVIEW_OFF` 不遗漏；`gate:abo-not-era-gated` 断言 ABO 不在任何专属表且受 `aboFx.enabled` 控制 |
| 常驻层 | `gate:ambience-quality-low-static`，扩 `fx-atmos.test.js` | low 画质无动画；`AMBIENT_KINDS` 与 LABELS/VOICES 同步；不超 `MAX_LAYERS` |
| 骰子 | 扩 `fx-result.test.js` / `fx-result-dom.test.js` | `pool` 分支多 reel；tier 属性正确；旧 check/contest 输出不变 |
| 同页上限 | 扩 `fx-daily.test.js` | 第三条同页日常被丢弃（或放宽后的新上限） |
| NSFW | `gate:nsfw-fx-default-off`、`gate:aftermath-opt-in` | 全部默认 false；发布版配置不含；喘息节奏不改变基础打字机输出 |
| 神话妖魔 | `gate:myth-era-split`、`gate:truemirror-reuses-mirror`、`gate:shift-silhouette-no-mask-url` | 东方专属项现代/西幻被拨掉，共享项按 Q12 结果放行；truemirror 与 mirror 共用同一 builder 路径、仅 `content` 参数不同；剪影不含 canvas / mask-image:url |
| 提示词 | 扩 `fx-prompts-style.test.js` | 提示词块是描述句，无关键词表堆砌；ABO 无本地气味词库 |

## 6. 风险与未决问题

| # | 风险 | 说明 |
|---|---|---|
| R1 | 搬运 fx-daily 私有函数 | 改动面大但无行为变化；单独提交 + gate |
| R2 | 立绘图床 CORS | 禁用 canvas/mask-image:url 后，局部贴片与"被衣领遮挡"无法靠像素做；只能按头部标定近似定位 |
| R3 | 提示词预算 | 新增 70+ kind 全进提示词会爆预算；用分组"正文提到才补"，不穷举 |
| R4 | 多层并发性能 | 变形层复刻 DOM 多一份大图；同页限 1 个变形层，气雾限 3 团，low 关水波/扭曲 |
| R5 | 环境音 3 层名额 | 新环境音抢名额，需定优先级 |
| R6 | fx-era 互斥校验 | ABO 走独立开关，需确认 `stripExclusive` 不误拨 |

### 用户拍板结果（2026-10-11，全部按推荐）

| # | 决定 |
|---|---|
| Q1 | 贴片按头部标定近似叠加，不处理衣领遮挡 |
| Q2 | 不动 BGM 总线；只对环境音/语气音/TTS 做局部低通 |
| Q3 | 只有面板类卡片可选跟随 13 套皮肤，默认按世界观换皮 |
| Q4 | 1920 年代只做面板/常驻层换皮，不新增时代档 |
| Q5 | 恋综包仅现代，接受 |
| Q6 | 敬事房记档“留”后自动接入亲密区间（仍受 NSFW 开关约束） |
| Q7 | 题材包卡片同页上限放宽到 3，其余日常仍为 2 |
| Q8 | 常驻地点层每包 3-4 个 |
| Q9 | 骰子用 2D 骰面 + 数字滚动 |
| Q10 | 演出页“题材包”折叠区，恋综/后宫/ABO/神话妖魔/COC 共用一页 |
| Q11 | 信息素压制只改 CSS 变量，不动打字机 |
| Q12 | 妖魔共享项先只对古代放行，整包 `FX_ERA_ANCIENT_ONLY`，不建 `FX_MONSTER_SHARED` |
| Q13 | 原形兽影用通用部件剪影 |

原问题：

- Q1：立绘局部贴片（脸红/吻痕/咬痕/契约纹）。因外部图床 CORS 无法做"被衣领遮挡则不显示"。接受"按头部标定的近似位置叠加、不处理遮挡"，还是整体砍掉、改成只在头像旁加小徽标？
- Q2：BGM 全局低通。门缝偷听/隔墙闷音/贴耳 TTS 想让 BGM 一起闷掉，需要在 audio-bus.js 加总线级低通节点（影响所有声音路径，有回归风险）。做，还是只对环境音/语气音/TTS 做局部低通（scene-audio 已有 muffled 字段）？
- Q3：日常卡片要不要接 13 套皮肤？目前日常卡片不跟皮肤。接的话只给"面板类"（系统公告/榜单/介绍卡/检测报告）加可选跟随，默认仍按世界观换皮，可以吗？
- Q4：1920 年代 COC 变体：作为新时代档（改 fx-era.js 时代判定与设置项），还是只作为面板/常驻层的换皮选项、不新增时代档？
- Q5：恋综包整体仅现代生效，西幻/古代世界想演恋综（如古风相亲综艺）会被拨掉，可以接受吗？
- Q6：后宫包"侍寝"流程（敬事房记档后）是否自动接入亲密区间，还是只出记档卡、亲密演出仍由正文另行触发？
- Q7：同页日常演出上限 2 是否对题材包卡片放宽到 3（恋综的花字+榜单+REC 经常同屏）？
- Q8：常驻地点层一次做几个？建议每包 3-4 个（恋综小屋、后宫寝宫/御花园/冷宫/长街），其余地点按需后补。
- Q9：骰子 d4-d20 外观是 3D 骰子还是 2D 骰面+数字滚动（省电，建议后者）？
- Q10：ABO 包总开关 `aboFx.enabled` 放在设置器哪一页（建议与恋综/后宫包一起放"演出 > 题材包"折叠区），三个包是否共用一个"题材包"总页？
- Q12：神话妖魔包的妖魔共享项要不要对西幻（magic 世界观）放行？放行需要 fx-era.js 支持"一张表多个 owner"，改动略大；不放行则整包仅古代，实现最简单。
- Q13：现出原形/化形的兽影采用通用部件剪影（尾/耳/角/翼，按原形名选部件与颜色），不为每种妖物单独画，可以接受吗？还是希望原形剪影从角色已有的形态素材轮廓生成（受图床 CORS 限制，实现不可行或需 AI 另出图）？
- Q11：ABO 的"信息素压制"会让其他人立绘颤抖/下沉并加重对话框字重，是否接受只改 CSS 变量（不动打字机）这种轻量做法？
