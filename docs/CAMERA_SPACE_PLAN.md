# 镜头与空间包最小锚点实施方案

> 状态：已实施（2026-10-11，P1-P3 一次完成，实际落地与方案的差异见文末「实施记录」）。只改内测版（AnyNo001）。V = `app/src/visual/igs-ui/`，S = `app/src/scene/`，T = `app/tests/`。
> 行号核对于 2026-10-11，实施前以符号名为准。本包是第 12 个题材包（第 11 个是偶像包 idol），id=`camera`，清单文件 V `fx-pack-camera.js`。
> `docs/FX_PACK_CONTRACT.md` 在撰写时尚不存在，接入方式按 `STAGING_EXPANSION_PLAN.md` 的 B8 模板写；**以契约为准**，契约落地后只需对照改接线处。
> `V stage-snapshot.js`（B1）已存在，可直接用 `cloneSpriteLayer / resolveRegionCrop / playWarp`。
> 设计前提（用户判断）：画面只有上半身立绘 + 背景，看不到脚。不做地形、脚印、立绘动腿；移动与空间感靠镜头语言、剪辑转场、声音。坐下/躺下 = 镜头下沉，不改立绘姿态。

## 0. 铁律对照

| 规则 | 本包落实 |
|---|---|
| 正文驱动，提示词世界书式，不建词库 | 镜头词只往 `FX_CAMERA_SHOTS` 现有格式里加（每个镜头 2-4 个别名）；脚步材质由标签字段 > 当前环境音层（snow/rain/stream）> 室内外二分推断，不建地点词表；提示词写在包自己的 prompt 块，一类一两句；`DAILY_TRIGGER_WORDS` 每类 2-4 词仅作门禁 |
| 全部 opt-in | 包总开关 `cameraPackFx.enabled` 默认 false（写时浅拷）；包内 kind 并入 `DAILY_FX_OPT_IN`；cam 扩展仍受现有「AI镜头指令」`camera.aiShots` 控制；脚步等声音另有总开关默认关 |
| 省电 | 常驻/循环动画（手持晃动、颠簸、窗光、车灯）在 `data-igs-quality="low"` 降级为静态，`env.reduced` 一律静态兜底；运动模糊用一次性 WAAPI，low 去掉 blur 只留位移；life 乘 `env.hold` |
| 缓存只读 | 读立绘/背景只读 DOM（`readStageBackground`、`cloneSpriteLayer`）；新设置写时浅拷 |
| 不改基础打字机 | 喘息/心跳只复用 romance 音效附加层，不碰 typewriter |
| 对话框是画框 | 空镜/主观镜头隐藏对话框用外层透明度，不改框皮肤；不加半透明装饰 |
| 禁止 | 对立绘用 canvas / `mask-image:url`；立绘动腿；脚印 |

## 1. 现状核实

| # | 项 | 证据（文件:符号/行） | 结论 |
|---|---|---|---|
| 1a | AI 镜头标签 | S fx-directives.js:98 `FX_CAMERA_SHOTS`：特写 closeup / 拉远 wide / 虚化 focus / 摇镜 pan / 倾斜 tilt / 复位 reset；约 :195 解析 `kind === 'cam'`，pan 第 3 栏左右，closeup 第 3 栏角色；约 :396 每页只取第一条 `cam`。V fx-prompt.js:197 `CAMERA_GRAMMAR_LINE`；开关 V stage-direction-settings.js:85 `camera.aiShots` | **部分有**：语法与开关齐全，但只有 6 种镜头、1 个参数位 |
| 1b | 镜头落地 | V stage-direction-runtime.js:714 `resolveCameraShot` -> `data-igs-sd-cam`（:805）；样式 V stage-direction-style.js:30-39：closeup 立绘 scale1.24 / 背景 1.1；wide 立绘 .82；focus 背景 blur(6px)+scale1.05（low 不做）；pan `igs-sd-pan` 9s 背景 scale1.14 + translateX ±5%（**放大裁切，不需要更宽的图**）；tilt 背景 rotate -3deg；pan 在 low 关动画、reduced 不播；CG 页、立绘编辑态不生效 | 已有，作为 C1 载体 |
| 1c | 视差/呼吸/Ken Burns | `syncParallax`:627 鼠标视差（变量 `--igs-sd-px/py`，仅 mouse）；`data-igs-sd-kenburns` 34s 缓动；`data-igs-sd-closeup` 按情绪自动特写；立绘 translate/scale 由 `--igs-sd-closeup-scale / --igs-sd-tx/ty / --igs-rm-scale/dx` 合成，总放大上限 1.3 | 已有。新镜头必须走同一组变量，别另开 transform |
| 2 | 集中线/速度线 | V fx-symbols.js:261 `speedLinesImage`（离屏 canvas 烤一次，只铺背景层，不碰立绘）；fx-runtime.js:526 `speedLines`、:174 `pickSpeedLines(emotion)` 按漫画情绪触发 700ms；fx-style.js:211 CSS 兜底；manga-back.js `speed` 平行速度线背景；fx-daily.js:657 `brake` 5 条横线+字，:672 `depart` 5 条流线 | **部分有**：只有情绪触发的瞬时放射线和载具一次性横线；没有「同色系整屏速度流线背景」 |
| 3 | 地点名卡/地点栏 | V fx-runtime.js:143 `planTitle`（换地点/换时间出 `title` 卡，:600 古代竖排朱印、`worldSkin` 换皮、fx-title-themes.js）；设置 fx-settings.js:101 `titleCard.onLocation/onTime`；地点栏 `.igs-hud-location`（bgm-note.js:38） | **已有**。定场镜头可直接复用 `title` 卡，缺的是「空镜 + 卡」的组合 |
| 4 | 散步 stroll | V fx-daily.js:848 `stroll`：5 个足印形小块 `igs-dfx-stroll-step`（fx-daily-style.js:760/879，宽 11 高 18 的椭圆，近似脚印）+ 暖光 + 落叶；音效 fx-daily-sfx.js:620 四下左右脚交替；life 2800ms | **部分有**，但视觉含脚印，与「不做脚印」冲突。新做的并肩散步不用它（见 Q4） |
| 5a | 慢动作/定格 | 无。V fx-daily.js:223 `FREEZE_SPEC` 只是 620ms 轻抖（点穴用），不是定格；`romance-moments.js:72 slowerTypewriterSpeed` 是打字变慢 | **没有** |
| 5b | letterbox | 范围标签 `[igs-fx:letterbox]…-end`（V fx-prompt.js:10、fx-runtime.js:1020 `data-igs-fx-letterbox`，黑边条 fx-layer.js:19）；战斗演出 fx-battle.js:14 另有一套 | **已有**，可作为慢动作/空镜的黑边 |
| 5c | 冲击推近 | V camera-impact.js:55 `playCameraImpact`（按情绪新页播一次） | 已有，变焦/甩镜落点可借其结尾 |
| 6a | 通话分屏 | V fx-runtime.js:797 `buildSplit` / :807 `syncCallSplit`；CSS fx-style.js:355 斜切 `--igs-split-w/k`，对方格 = 立绘 feed 或头像，说话方亮起；仅绑通话 | **部分有**：斜切分屏壳可借；对方格内容固定为通话对象 |
| 6b | 漫画分格 | V comic-style.js 只有整页画格边框（单格）+ 网点，无多格拼贴 | **没有**多格；蒙太奇需新做 |
| 6c | 背景转场 | V stage-direction-runtime.js:439 `playBgTransition`：black / blinds / wipe(clip-path inset) / iris(circle) / fade，背景幽灵层 `state.bgGhosts` 复刻 `copyBackgroundGeometry`，**不重新加载图**（`whenDecoded`） | **部分有**：划变、圈入圈出已有，但是用户全局设置，不能由正文标签逐页指定 |
| 7a | 环境音交叉淡化 | V scene-audio.js:2328 `startLayer`（淡入 `AMBIENT_FADE_IN_S`=1.5s :70）、:2382 `syncAmbient`（按 `layerKey` 差集：多出的 `fadeOutLayer` 1.2s，新增的 `startLayer`，key 相同保留）；`MAX_LAYERS=3`:97，`LAYER_ORDER`:132；plan 由 `resolveAmbientPlan`:316 从 `context.location` 推 | **已有**交叉淡化；没有「提前进入」（J-cut）与「延后退出」（L-cut）的参数 |
| 7b | 声像 | `panTo`:1014（StereoPanner，缺则直连）、`blip`:1024；voice-bark.js:396 `buildBarkChain` 声像取 `spritePan(line.posX)`；romance-intimate-audio.js:60 noise/tone 带 pan | **已有**，但都是静态定点，没有「左 -> 右经过」的 pan 自动化 |
| 7c | 混响 | V audio-bus.js:86 `setAudioBusSpace(buffer, wet)`：voice+sfx 两路送同一卷积器；scene-audio.js:2457 `syncVoiceSpace`、`VOICE_SPACE_WET`:158（room .05 / hall .12 / long .15）、`impulseBuffer`:872、`resolveAmbientSpace`:309 | **已有**，可做走廊回声；只有全局湿度，没有按声源远近的单独发送 |
| 8 | 脚步声合成 | scene-audio.js:1267 `footsteps(layer, at, count, pan)`（随机声像、低频闷响+摩擦，**只是 crowd/图书馆层的背景细节**，scene-audio-campus.js:88 同）；romance-intimate-audio.js:151 `outside('steps')`（门外 4 步）；fx-daily-sfx.js:620 `stroll`（4 步，无声像参数，`playDailySfx`:908 一次性） | **部分有**：能出脚步，但无材质、无方向移动、无远近、无节奏 |
| 9 | 背景层 | V reader-dom-render.js:252 `#igs-bg`（单层 `background-image`，`inset:0; background-size:cover`，original-reader-source.js:144），其下 `#igs-bg-blur`；已有 CSS `scale/translate/rotate/filter` 单独驱动（stage-direction-style.js:12/19/34/37）；换图用幽灵层 | **已有**：横移/放大/虚化均不需重新加载图 |
| 10 | 前景层 | 层级：bg < `#igs-effect-layer`(z1) < `#igs-sprite/#igs-cast`(z2) < `#igs-fx-stage`(z2，DOM 在立绘之后，故盖住立绘，fx-layer.js:16/27) < `#igs-effect-front-layer`(z3，天气前景) < 对话层(z4) < `#igs-fx-front`(z6，盖住对话)。花瓣：fx-daily.js:900 `petalLayer`，fx-daily-particles.js:739 `startPetals` 是 canvas 粒子 | **部分有**：「立绘之上、对话之下」的位置已存在（`stage` 层 builder 可用）；没有「虚化掠过物 / 遮挡物」部件 |
| 11 | 其他可借 | 剪影 `silhouette`（STAGING 1A，V fx-transform.js，brightness(0)）；`playSpriteSpec` V sprite-actions.js:22；`peekSpriteHead` V fx-anchor.js；心跳 romance-intimate-audio.js:129 `heartbeat`；场景调色 `--igs-grade-bg/sprite`；状态滤镜 B5 `data-igs-fx-state` | 已有 |

## 2. 积木

分工规则：**改变整页构图** -> 扩 `cam`（沿用现有语法）；**叠一次性层** -> 包内日常 kind（`[igs-fx:类型|…]`，进 `DAILY_FX_OPT_IN`，layer 用 `stage`）；**声音** -> 包自己的音频模块；**持续一段** -> 范围标签（照 letterbox）。

### C1 镜头积木（扩 cam）

扩展方式：`FX_CAMERA_SHOTS` 加条目；语法 `cam|镜头|目标或方向|修饰`，第 4 栏 `修饰` 只认 `手持 / 慢`，可与任意镜头叠（如 `cam|摇镜|右|手持`）。`resolveCameraShot` 返回值进 `data-igs-sd-cam`；修饰另写 `data-igs-sd-cam-mod`。

| 镜头 | 标签词 | 实现（全部走现有 scale/translate/rotate/filter 变量，CSS 为主） | 条件 |
|---|---|---|---|
| 横移跟拍 | `跟拍 track`（左/右） | 背景 `igs-sd-pan` 短版（5s、±8%）+ 立绘 `--igs-sd-tx` 反向小位移 | reduced 不播，low 静态 |
| 手持晃动 | 修饰 `手持` | 背景+立绘 `rotate ±.4deg / translate ±3px` 2.4s 循环关键帧，覆盖整页 | low/reduced 关 |
| 甩镜 | `甩镜 whip`（左/右） | 背景一次性 WAAPI：350ms `translateX` 快速横移 + `filter:blur(10px)`，落点回正；立绘轻微反向拖尾 | low 去 blur 只留位移；同页一次 |
| 焦点转移 | `焦点 focus`（现有）加第 3 栏 `前/后` | 现有 focus = 背景虚化；`前` = 背景清晰、立绘 blur(3px)，用于「看向远处」。仅加 CSS 选择器 | low 不做 |
| 升降 | `下沉 sink`、`升起 rise`、`仰望 lookup` | sink：背景 `translateY(+4%) scale(1.1)`、立绘 `--igs-sd-ty:-3%`，1.2s；rise 反向；lookup：背景 `translateY(-6%)` + 立绘 scale1.12、origin 底部。**坐下/躺下/起身全靠它** | 需立绘；CG 页不生效 |
| 希区柯克变焦 | `变焦 vertigo`（`远/近`） | 背景 scale 1 -> 1.28（拉远感），立绘 scale 不变，1.6s ease；立绘不走 closeup 变量，单独压住 | 需立绘；reduced 直接落终值 |
| 主观镜头 | `主观 pov` | 立绘整体 `visibility:hidden`（属性驱动，**不改 spriteUrl 解析**，见 Q1）+ 背景 scale1.06 呼吸摆动 4s（±.6deg） | CG 页不生效；low 摆动静态 |
| 慢动作 | `慢 slow`（修饰或独立） | CSS 无法真放慢。近似：本页 `--igs-cam-slow:2.5` 乘长背景/立绘过渡，叠 letterbox 黑边（复用 `data-igs-fx-letterbox`）+ 轻微降饱和；BGM 不动（STAGING Q2 已定不动总线） | 标注「近似」 |
| 空镜 | `空镜 empty` | 页内隐藏立绘/同屏/对话框外层（`opacity` 过渡，点击推进层保留），仅背景+环境音；见 C4 | 见 Q1 |

现状锚点：S fx-directives.js:98 / 约 :195；V stage-direction-runtime.js:714 / :805；V stage-direction-style.js:30-39；V fx-prompt.js:197 `CAMERA_GRAMMAR_LINE`（追加一句，保持描述式）。
最小改动：fx-directives.js 加条目与第 4 栏；`resolveCameraShot` 加分支（pov/empty 不要求 `spriteUrl`）；style 追加选择器。
新文件：V `fx-camera-style.js`（新镜头 CSS，由包清单注入，避免撑大 stage-direction-style.js）。
被谁用：C4 空镜/定场、全部组合演出。

### C2 前景层（日常 kind，layer:'stage'）

| 部件 | 标签 | 实现 | 低配 |
|---|---|---|---|
| 虚化掠过物 | `[igs-fx:fg\|树叶/栏杆/路人/电线杆\|方向]` | 通用实色剪影 SVG 部件（一类一个 path，近黑 `#10151a`）+ `filter:blur(5-8px)`，一次性 WAAPI 横穿 1.2-2.2s；栏杆/电线杆为竖条按间距重复，路人为一个人形剪影 | reduced 不画；low 去 blur |
| 前景遮挡 | `[igs-fx:peek\|窗框/树叶/门缝\|角]` | 屏幕一角静态实色剪影挡一部分（偷看感），可叠 `手持` 轻晃；窗框 = 实色边框形，树叶 = 3-4 片叶 path | 静态 |
| 镜头光晕/散景 | `[igs-fx:flare\|方向]` | 一次性 1 条光晕扫过（实色渐变横向拉伸，不用 mix-blend）+ 3-5 个散景圆斑缓慢漂；颜色取场景调色 | low 只留光晕静态 |

现状锚点：V fx-layer.js `#igs-fx-stage`；V fx-daily.js `BUILDERS`（B8 合并片段）；剪影规则参考 STAGING 1A `silhouette`。
新文件：V `fx-camera.js`（builder）、`fx-camera-parts.js`（SVG 部件，通用形状）。
同页：前景部件最多 2 个，计入题材包上限 3。

### C3 速度与情绪背景

| 部件 | 标签 | 实现 | 低配 |
|---|---|---|---|
| 速度流线背景 | `[igs-fx:streak\|方向\|色]` | `stage` 层、立绘之下的横向流线（线性渐变条，同色系取自 `--igs-grade-bg` 或标签色），覆盖背景；与 brake/depart 的短线不同，`life` 3-4s 后淡出；冲刺可用 `speedLinesImage` 放射版（只铺背景层，不碰立绘） | low 静态几条 |
| 上半身颠簸 | 修饰 `手持` 的 `颠` 档，或 `[igs-fx:bob]` | `playSpriteSpec` 对 `#igs-sprite` 小幅 translateY（±1%，.45s）循环，与呼吸互斥：先查 `data-igs-sd-breathe`，有则不叠 | low/reduced 关 |
| 情绪背景 | `[igs-fx:mood\|纯色/花/闪光/雷\|色]` | 复用 V manga-back.js 已有 `flowers/sparkle/burst/gloom`，本包只加「纯色渐变底」与「雷」；其余直接调用 manga-back，不重写 | 静态 |
| 逆光剪影 | 复用 STAGING 1A `silhouette\|角色\|逆光` | 不新写；本包只在组合演出里调用 | 同 1A |

被谁用：追逐、赶路、并肩散步、被壁咚（情绪背景）。

### C4 转场积木

| 转场 | 做法 | 锚点 | 现状 |
|---|---|---|---|
| J-cut / L-cut | `[igs-fx:jcut\|地点]`（下一场景环境音提前进入）、`[igs-fx:lcut]`（上一场景环境音延后退出）。J：`resolveAmbientPlan` 额外按 `context.leadLocation` 补一层，淡入拉长到 3s；下一页地点真变时该层 key 一致，`syncAmbient` 不重建。L：`fadeOutLayer` 加可选 hold，把退出推迟 N 秒 | scene-audio.js:316 / :2382 / :2328 | 机制现成，加两个参数 |
| 空镜 | cam `空镜`（C1）；需要时同页连 letterbox | stage-direction-style.js | 新 |
| 定场镜头 | `[igs-fx:establish\|地点]`：本页 cam=`拉远` + 隐藏立绘/对话框 + 触发 `planTitle` 同款 `title` 卡（主=地点），环境音走 J-cut | fx-runtime.js:143 | 组合，全用现成 |
| 划变/圈入圈出 | 让 cam 或 kind 能逐页覆盖背景转场样式：`playBgTransition` 的 `style` 增加来源「本页标签」，覆盖用户全局值；wipe/iris 现成 | stage-direction-runtime.js:439 | 机制现成，缺标签入口 |
| 蒙太奇 | `[igs-fx:montage\|N]`（2-4 格）：网格壳借通话分屏斜切 clip-path 写法；每格 = 同一背景的不同 `background-position/size` 裁切（不重新加载），含立绘时用 `cloneSpriteLayer`（B1）不同 crop；逐格 0.25s 依次切入，最后一格停住，再整体淡出 | fx-runtime.js:797（借样式）、stage-snapshot.js | 新 |
| 延时 | `[igs-fx:timelapse]`：背景叠一层「云影/光带」快速横扫 + `scene-grade` 变量 2s 内从当前值走到目标时段值（不重新加载图） | scene-grade.js | 新 |
| 匹配剪辑 | **不做**：需识别两张图的相似形体，图床 CORS 禁止读像素，无法可靠实现。降级为「划变 + 圈入」，由正文自行描述 | - | 不做 |
| 分屏「同一时间另一边」 | `[igs-fx:split\|地点或角色]`…`split-end`：复用通话分屏壳 `syncCallSplit` 的斜切，对方格内容改为「另一地点背景裁切 + 对方立绘 feed」；独立于通话开关 | fx-runtime.js:807 | 部分，需把内容源参数化 |

### C5 空间声音（新 V `camera-steps-audio.js`，仿 `createIntimateVoice` 与 `createCampusVoices` 的模块写法）

| 能力 | 做法 | 复用 | 默认 |
|---|---|---|---|
| 脚步分材质 | `[igs-fx:step\|材质\|方向\|数量]`；材质 = 木地板 / 石板 / 草地 / 雪 / 水洼 / 走廊回声 六套合成配方（噪声+滤波+短 sine 的参数表，是音色配方不是词库）。材质推断：标签 > 当前环境音层（snow -> 雪，rain/stream -> 水洼）> 室内=木地板、室外=石板；草地仅标签或地点命中已有 `NATURE_WORDS`（scene-audio.js 顶部）。**走 sfx 总线**，不是画面 | `noiseBurst`（scene-audio.js:1280）写法、`busInput('sfx')`（audio-bus.js:64） | 声音总开关默认关 |
| 声像移动 | StereoPanner 的 `pan.linearRampToValueAtTime`，方向 左->右 / 右->左 / 逼近 / 远去，跨 N 步 | `panTo`（:1014）模式；新写「自动化 pan」单函数 | 随脚步 |
| 远近 | 近 = 音量大、低频足；远 = 音量小 + 低通 + 往卷积器多送（给本包 sfx 增加单独发送 gain，**不动** `setAudioBusSpace` 的全局湿度，避免回归） | audio-bus.js:86 | 随脚步 |
| 区域交叉淡化 | 换地点环境音已有交叉；补 J/L-cut（C4） | scene-audio.js:2382 | 随 C4 |
| 喘息与心跳 | 追逐/被壁咚时调用 romance 的 `heartbeat(t,{bpm,gain})`、`breath`；追逐中 bpm 递增 | romance-intimate-audio.js:129 | 组合时 |
| 两人同频脚步 | 同一 `step` 带 `pair`，第二套脚步相位差 ≤30ms、声像左右分开、材质一致 | 同上 | 并肩散步 |

被谁用：穿过树林、追逐、潜行、并肩散步、到达、目送。

### 时间流光（待在某处）：常驻氛围，走 B7 模板

| 效果 | 实现 | 低配 |
|---|---|---|
| 窗格光斑缓慢移动 | `AMBIENCE_HTML` 里一块实色 4 格窗影，CSS `translate` 90s 线性一次；仅日间 | low 静态 |
| 影子拉长 | 黄昏 `scene-grade` 之上加一条斜向暗条，随时间缓慢变宽（CSS 变量，一次性） | low 静态 |
| 热气消失 | 复用 B11 `mist`，一团气雾淡出 | low 静态 |
| 窗外路人剪影/车灯扫过天花板 | 车灯 = 一条斜向亮带 6s 一次横扫；路人 = C2 剪影部件 + blur，夜间室内才出 | 关 |
| 窗帘飘动 | 一块实色帘形 SVG，CSS `skewX` 微摆 6s | low 静态 |
| 孤独拉远降饱和 | 走 B5 `state\|lonely`：`filter` 串 `--igs-grade-bg`，降饱和 + cam `拉远` | 静态 |
| 紧张暗角收紧 | 走 B5 `state\|tense`：实色径向渐变暗角逐步收紧 | 静态 |

触发：`[igs-fx:linger\|窗光/夕影/车灯/窗帘]` 单标签，或室内地点命中时由 `resolveCameraAmbience(place)` 自动挂（B7 回落链加一项）。常驻层同页最多 2 块。

新文件汇总：S `camera-fx.js`（KINDS/parse/of/提示词块/触发词）、S `camera-ambience.js`；V `fx-pack-camera.js`（清单）、`fx-camera.js`、`fx-camera-parts.js`、`fx-camera-style.js`、`fx-camera-sfx.js`、`camera-steps-audio.js`。

## 3. 组合演出

标签是建议；组合 = 一个 builder 内部直接调用积木函数，不做标签嵌套解析。声音列「步」= C5 脚步。

| 演出 | 标签建议 | 积木 | 声音 | 世界观换皮 | 量 |
|---|---|---|---|---|---|
| 穿过树林 | `[igs-fx:walk\|树林]` | C1 跟拍+手持 / C2 fg(树叶) 两三次 / C3 光斑 | 步(草地/落叶)、风声、鸟鸣淡入 | 古=竹林；西幻=林中魔力光点 | M |
| 追逐战 | `[igs-fx:chase\|逃脱/被抓/获救]` | C3 streak+bob / C1 手持、甩镜回头 / C2 fg 掠过；结局：逃脱=门声+静默+降速，被抓=变焦 vertigo+白闪+心跳骤停，获救=flare+风声收 | 身后脚步逼近（远->近，bpm 递增）、喘息、心跳 | 现=街巷；古=屋檐；末世=嘶吼层 | L |
| 潜行躲藏 | `[igs-fx:sneak]` | C2 peek(遮挡一角)+C1 主观/焦点转移+暗角收紧 | 远处脚步(远，低通)、心跳、屏息(环境音 duck) | 现=走廊；古=屏风后 | M |
| 并肩散步 | `[igs-fx:walk\|并肩]` | C1 跟拍(缓)+C2 fg(栏杆/电线杆间隔掠过)+C3 暖色流线 | 两人同频步、环境音随地点交叉 | 古=石桥/灯会；现=黄昏街 | M |
| 坐下谈心 | `cam\|下沉` + 环境音压低 | C1 sink | 木地板/椅子轻响一下(`step` 的一下) | 通 | S |
| 到达新地点 | `[igs-fx:establish\|地点]` | C4 定场(空镜+title 卡)+J-cut+C1 拉远->复位 | 环境音提前进入 | 古=竖排朱印卡(现成) | M |
| 目送离开 | `[igs-fx:watch-leave\|方向]` | C1 变焦 vertigo(人物不动、背景拉远)或 拉远 + 立绘渐隐(现有 fade) | 步远去(pan 向一侧、低通渐强) | 通 | S |
| 被壁咚主观镜头 | `cam\|主观` + STAGING 的壁咚 cam | C1 pov(隐藏立绘)+暗角 | 心跳、衣料摩擦、环境音压低 | 通；亲密档受 NSFW 开关约束 | M |
| 走进陌生房间 | `[igs-fx:enter\|房间]` | C1 手持+焦点前->后 / C2 peek(门框) / 空镜一页再回人物 | 走廊回声+脚步材质 | 西幻=石厅回声；现=木地板 | M |
| 赶路蒙太奇 | `[igs-fx:montage\|3]` | C4 蒙太奇+C3 streak+timelapse | 步(材质逐格变)、环境音逐格交叉 | 古=驿道/渡口；现=车站 | L |

## 4. 分批

| 批 | 内容 | 理由 |
|---|---|---|
| P1 | C1 全部镜头（跟拍、手持、甩镜、升降、变焦、主观、慢）+ C5 脚步/声像/远近/同频 + J-cut/L-cut + 组合：坐下谈心、目送离开、到达新地点（cam+声音即可） | 价值最高，几乎全是 CSS 与单个音频模块，不依赖新积木 |
| P2 | C2 前景部件 + C3 流线/颠簸/情绪背景 + 组合：穿过树林、并肩散步、潜行躲藏、被壁咚主观 | 需要剪影 SVG 部件与 B1 剪影 |
| P3 | C4 空镜/划变入口/蒙太奇/延时/分屏 + 时间流光 + 组合：追逐战、走进陌生房间、赶路蒙太奇 | 改 `playBgTransition`、通话分屏壳参数化，最重 |

每批核对本批受影响的行为再继续，不恢复已删除的门禁；只推内测版；README 更新日志与版本号同步。

## 5. 验收测试 `app/tests/fx-pack-camera.test.js`（名称均以 `gate:` 开头）

| 测试名 | 断言 |
|---|---|
| `gate:camera-shots-extend-existing-grammar` | 新镜头全在 `FX_CAMERA_SHOTS`；`cam\|…` 仍每页取首条；写错镜头整条丢弃；旧 6 种行为不变 |
| `gate:camera-resolve-gates` | `resolveCameraShot`：CG 页空、reduced 下 pan/甩镜/手持空、low 下 focus 空且甩镜无 blur；pov/empty 无立绘仍可用 |
| `gate:camera-pack-default-off` | 包内 kind 均在 `DAILY_FX_OPT_IN`；默认 false；旧存档载入不触发；`cameraPackFx.enabled=false` 时标签被剥离不渲染 |
| `gate:camera-pack-six-places` | kind 在 `DAILY_FX_KINDS / LABELS / OPT_IN / TRIGGER_WORDS / PROMPT_LINES` 与 sfx 各处齐全 |
| `gate:camera-no-canvas-no-mask-url` | 本包源文件不含 `canvas` / `mask-image:url`；不含脚印/立绘腿相关样式 |
| `gate:camera-low-static` | `data-igs-quality="low"` 下手持、颠簸、窗光、车灯无 animation；reduced 兜底 |
| `gate:step-material-inference` | 标签材质 > 环境音层 > 室内外二分；未知材质回落木地板；本包不新增地点词数组 |
| `gate:step-pan-automation` | 左->右的 pan 单调递增并落在 [-1,1]；无 StereoPanner 时直连不抛错 |
| `gate:step-default-off-and-volume` | 声音总开关默认 false；默认音量低于环境音默认；不改 `setAudioBusSpace` 全局湿度 |
| `gate:jcut-lcut-layer-keep` | J-cut 层 key 与下一页 plan 一致时 `syncAmbient` 不重建；L-cut 推迟 `fadeOutLayer`；层数上限符合 Q8 结论 |
| `gate:bg-transition-tag-override` | 标签样式只覆盖本页，翻页后恢复全局样式 |
| `gate:camera-era-split` | 包不进任何 `FX_ERA_*_ONLY`（通用）；世界观只换皮 |
| `gate:camera-prompt-descriptive` | 提示词块是描述句，无关键词表堆砌 |
| `gate:camera-no-sprite-pose-change` | 坐下/躺下只改 cam 变量，不触发姿态帧、不改立绘 URL |

## 6. 风险与需用户拍板

| # | 风险 | 说明/建议 |
|---|---|---|
| R1 | 主观镜头/空镜隐藏立绘与挂图/CG 冲突 | 现 `resolveCameraShot` 在 CG 页直接不生效；NSFW 整楼挂图、事件 CG 停留页同理，建议保持「CG 页不执行」。隐藏用属性而非清 `spriteUrl`，避免和 `hideSpriteNsfw`（reader-dom-render.js 约 :1402）、换装幽灵层（sprite-outfit-swap.js）打架 |
| R2 | 与 breathe/closeup 抢 transform | 手持/颠簸要和 `data-igs-sd-breathe`、closeup 变量合成互斥；实施时在 stage-direction-style.js 末尾（:48 附近）补互斥规则 |
| R3 | 甩镜运动模糊性能 | 对整张背景动画 `filter:blur` 在低端机重绘重；限一次性 350ms，low 去 blur |
| R4 | `title` 卡与定场空镜重叠 | 同页同时出现时需定优先级 |
| R5 | 蒙太奇素材有限 | 只能用同一背景裁切 + 立绘克隆，视觉丰富度有限 |
| R6 | 环境音 3 层名额 | J-cut 额外占 1 层，plan 满 3 层时会顶掉末位 |

需要用户拍板的问题：

1. 【Q1 主观镜头/空镜】隐藏立绘（主观镜头）与隐藏立绘+对话框（空镜）在 CG 页（NSFW 整楼挂图、SFW 事件 CG）一律不生效，可以吗？空镜隐藏对话框期间，点击屏幕仍然翻页，可以吗？
2. 【Q2 背景横移】跟拍/摇镜继续用「放大裁切」（背景 scale1.14 平移 ±5-8%），不要求用户提供更宽的背景图，可以吗？
3. 【Q3 脚步声默认音量与开关】声音默认关，开启后默认音量取比环境音默认（0.4）更低的一档（建议 0.25）、走 sfx 总线，可以吗？
4. 【Q4 旧 stroll 的足印】`stroll`（fx-daily.js:848）现有足印形小块，与「不做脚印」冲突。是保持不动（已有用户）、改成只出暖光+落叶+脚步声，还是并入新的并肩散步后淘汰？
5. 【Q5 甩镜运动模糊】甩镜在普通画质用 `blur(10px)` 的一次性动画，省电画质只做位移。可以接受吗？还是整个甩镜只做位移+重影、不要模糊？
6. 【Q6 慢动作】CSS 无法真正放慢正文已有动画，慢动作按「过渡拉长 + 黑边 + 降饱和」做近似，接受吗？
7. 【Q7 匹配剪辑】因图床跨域无法读像素，匹配剪辑不做，由划变/圈入圈出代替，接受吗？
8. 【Q8 J-cut 占名额】J-cut 期间环境音临时允许第 4 层（`MAX_LAYERS` 3 -> 4，仅 J-cut 期间），还是严格 3 层、顶掉末位？
9. 【Q9 逐页转场样式】允许正文标签逐页覆盖「背景转场样式」（划变/圈入圈出/黑场），覆盖用户在设置里选的全局样式，可以吗？
10. 【Q10 同页上限】前景部件 + 流线 + 光晕同屏时仍受题材包同页上限 3，追逐战这类组合 builder 内部只算 1 个，可以吗？

### 用户拍板结果（2026-10-11，全部按推荐）

Q1 同意；Q2 同意（放大裁切）；Q3 同意（默认关，音量 0.25，走 sfx 总线）；Q4 stroll 去掉足印，改为暖光+落叶+脚步声，保留标签名兼容旧存档；Q5 同意；Q6 同意（近似慢动作）；Q7 不做匹配剪辑；Q8 J-cut 期间临时允许第 4 层，结束回到 3 层；Q9 允许正文逐页覆盖转场样式；Q10 组合演出算 1 个，受题材包同页上限 3。

## 7. 实施记录（2026-10-11）

编号：第 12 个题材包，id=camera，总开关 `cameraPackFx.enabled`，声音开关 `cameraPackFx.sound`（默认关）与音量 `cameraPackFx.volume`（默认 0.25）。

与方案不同或简化之处：
- 慢动作按 Q6 做成近似（过渡拉长、黑边、降饱和）；匹配剪辑按 Q7 不做。
- 情绪背景 `backdrop` 全部自写（纯色/花/闪光/雷/暗），没有调用 manga-back（它依赖漫画情绪驱动，不能直接按标签调用）。
- 延时 `timelapse` 用染色层加云影加光带实现，没有改写 scene-grade 变量，避免与场景调色互相覆盖。
- 分屏 `split` 是单个定时标签（5.2 秒后自动收回），没有做成成对区间；另一边是同背景换裁切加色相偏移，没有另一地点的真实背景图。
- 窗光常驻层只做室内地点上的缓慢窗格光斑与长影（`cmroom`），车灯、窗帘、孤独拉远等走 `linger` 标签与 B5 状态滤镜，没有额外自动挂载。
- 组合演出（walk、chase、sneak、seeoff、enterroom、establish）除自身画面外，还会隐含一个镜头（见 `fx-camera-gate.js` 的 `impliedCam`），用户写了 cam 标签则以 cam 为准。
- 旧 stroll 按 Q4 去掉足印方块，改为暖光加两片落叶加原有脚步声。
