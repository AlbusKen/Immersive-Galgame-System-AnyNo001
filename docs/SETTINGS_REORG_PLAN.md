# 设置器重排计划（2026-10-11）

用户反馈「越来越多用户找不到东西在哪」。本计划是**用户已拍板**的方案，执行时不要自行改设计；拿不准的地方按「最少意外」处理并在报告里写明。

所有路径相对 `app/src/visual/igs-ui/`，除非另写。

## 0. 硬规则

- **兼容**：存储路径（`bridge.*`、`readerSettings.*`）一律不改；旧的 tab / 子页 id（`basic|reader|scene|image`，`dialog|text|performance|interface`，`characters|scenes|review|rules`，`source|llm|auto|logs|cg`）和所有 `data-advanced` / `advancedOpen` key 继续可用，通过别名映射到新页面。`data-action`、`data-path` 不改。
- **审美**：把用户当成阅读吃力的人，**不要堆砌**：
  - 不用宫格；不用大内边距的大框卡片；不要横排多行按钮。
  - 导航都是竖排扁平文字，一行一项。
  - 沿用现有的扁平按钮风格和设置器配色变量（`--igs-settings-*`）。
- **能耗**：不加常驻动画、不加实时预览、不加轮询。搜索索引懒建，只在第一次输入搜索词时建一次。
- **文案**：
  - 按钮不超过 4 个字；说明压成一句。
  - 中文与英文、数字之间不加空格；AI 写法示例如 `[igs-...]` 保持原样。
  - 对话框外观统一叫「**风格**」（设置器文案里不用「皮肤 / 主题」，代码标识符不改）。
  - DNA 在首次出现处写「外貌（DNA）」，其余保留 DNA。
  - 副LLM / 副API 一律改叫「**备用模型**」。
- **文件行尾用 LF**：Edit 工具可能写成 CRLF，改完用 `sed -i 's/\r$//' 文件` 转回 LF，再用 `git diff --stat` 确认没有整文件变动。
- **shell 注意**：
  - heredoc 会吃掉反斜杠；`/tmp` 和 Windows 程序不互通，临时文件放仓库内 `.tmp/`（已被忽略）。
  - npm 用 `npm.cmd`。
- **不提交、不推送、不升版本号**。完成后跑 `cd app && npm.cmd run build && npm.cmd run gate`，必须全绿；失败要修，修不了就在报告里如实写。
- 模拟测试卡住时先查是不是某条断言失败：失败会跳过 `vn.destroy`，残留的定时器让 simulate 卡到内存溢出。

## 1. 新信息架构

`settingsState.tab` 改为**分类 id**，新增 `asyncState.page`（页面 id）作为当前显示内容的唯一依据。旧字段 `readerSubTab / sceneSubTab / imageSubTab` 不再作为显示依据；所有写旧字段跳页的地方，改成调用统一的 `openSettingsPage(settingsState, pageId)`（或等价函数）。

| 分类 id | 名称 | 页面（id：子页名） | 内容来源 |
|---|---|---|---|
| `dash` | 仪表盘 | `dash` | 见第 2 节 |
| `style` | 风格 | `style` | 原 阅读器›对话框（READER_DIALOG_TEMPLATE） |
| `text` | 文字 | `text` | 原 阅读器›文字 |
| `ui` | 界面 | `ui` | 原 阅读器›界面；另外把原基础页的「打开方式」「显示提示弹窗」放到本页最上面一张卡「阅读器」 |
| `perf` | 演出 | `perf-text`：台词；`perf-stage`：画面；`perf-story`：情绪与提示；`perf-special`：题材；`perf-rhythm`：节奏 | 原演出 6 组里除「声音」外的 5 组，每组一个子页，组内**不再套折叠卡**，组内小标题分段保留 |
| `sound` | 声音 | `sound` | 原演出「声音」组 |
| `chars` | 角色 | `chars`：角色；`wardrobe`：衣柜与情绪；`review`：待确认 | 原 素材›角色（含「立绘设置」折叠卡）、原 规则页里的「衣柜提示词」和「情绪组」、原 素材›待确认 |
| `scenes` | 场景 | `scenes`：背景；`eventcg`：预置CG；`cglib`：CG库 | 原 素材›场景、原 规则页「CG库（作者预置）」、原 生图›CG库 |
| `ai` | 生图与AI | `source`：图像来源；`kinds`：画师与模型；`llm`：备用模型；`rules`：写法规则；`parse`：正文解析 | 原 生图›图像来源、生图›分类、生图›副LLM、规则页「AI格式规则」（含注入位置折叠）、原基础页「标签解析」和「正文格式化」两张折叠卡 |
| `data` | 数据 | `data`：备份；`logs`：日志 | 「备份」放：导出配置、导入配置、本页诊断、本地缓存张数（`bridge.imageCache.maxCount`）、清除素材缓存（`purge-asset-cache`）。「日志」= 原 生图›日志。备注「配置不含素材图片和API Key；导入不覆盖已有素材。」跟到备份页 |

细节：
- **角色、场景两个分类的所有页面**顶部都保留原素材页的头部：「启用场景素材模式」开关、`assetScopeBar`（当前角色卡、导出本卡素材 / 导入素材包、素材预设折叠）。开关关闭时，页面内容整块隐藏，和现在一致。
- 页面里只有一个子页的分类不显示子页条。有多个子页的分类，子页条用一行扁平文字按钮（沿用现有 `igs-reader-subtabs` 的视觉，可抽一个通用类 `igs-page-tabs`）。演出有 5 个子页：手机上一行放不下就横向滚动，不要换成两行。
- 「待确认」子页名后面的数字角标保留。
- 原基础页的演出档位条（含世界观、画质 / 省电模式两行）搬到**仪表盘**。演出、声音各子页顶部只放档位按钮那一行（`renderPerformancePresetBar` 不带 extraRows），便于在细项页里切档。档位条底部的说明「细项前往「阅读器 › 演出」调整」改成「细项在「演出」「声音」里调整」。
- `CG库` 页的缩略图网格、`日志` 页的列表，只在当前就是该页时才渲染（沿用现有判断）。

旧 id → 新页面的映射（`normalize` 时用；同时用于上次停留页面、搜索旧 target、阅读器里 `openSettings({tab:'scene'})` 一类调用）：
- `basic` → `dash`；带 open `source-filter` 或 `body-format` / `virtual-regex` → `parse`
- `reader` + `dialog` → `style`；`text` → `text`；`interface` → `ui`；`performance` → `perf-text`，带 open `perf-group-<g>` 时 → 对应页（`sound` → `sound`，`rhythm` → `perf-rhythm`）
- `scene` + `characters` → `chars`；`scenes` → `scenes`；`review` → `review`；`rules` → `rules`。带 open `rules-mood` 或设置了 `wardrobeFocus` → `wardrobe`；带 open `rules-event-cg` → `eventcg`
- `image` + `source` → `source`；`llm` → `llm`；`auto` / `prompts` / `content` → `kinds`；`logs` → `logs`；`cg` → `cglib`；`other` → `source`
- 旧子页别名（`wardrobe`→rules，`generated`→review，`display/theme/toolbar/visual/options`）继续认。

## 2. 外壳：仪表盘 + 侧边栏

- **电脑**（视口宽度 ≥ 900px）：
  - 面板加宽到约 `min(980px, 视口-48px)`。
  - 左侧常驻侧边栏，约 120px，竖排扁平文字，一行一个：仪表盘、风格、文字、界面、演出、声音、角色、场景、生图与AI、数据。
  - 当前项用 `--igs-settings-raised` 底色和加粗标出，和现有 tab 激活态一致。
  - 右侧依次是子页条和内容。
- **手机 / 窄屏**：
  - 侧边栏默认隐藏，头部左侧放 ☰ 按钮。
  - 点 ☰ 从左侧滑出同样的竖排列表，盖在内容上，带半透明遮罩；点遮罩或选中一项后收起。
  - 头部标题显示当前分类名，在仪表盘时显示「设置」。
  - 滑出只用 transform 过渡；`data-igs-quality="low"` 或 `prefers-reduced-motion` 时不做动画。
- 头部的配色切换、版本号、关闭按钮保留。搜索框保留，位置在头部下方、内容上方，所有页面都有。
- 去掉原来的 4 格 `.igs-settings-tabs` 横条。`SETTINGS_PANEL_REQUIRED_SELECTORS` 里对应项改成新侧边栏的选择器；`.igs-scene-settings-subtabs`、`.igs-reader-subtabs` 如果不再必有，从必需列表里移除，契约测试同步改。

**仪表盘页内容**，从上到下：
1. 演出档位条：带世界观、画质两行，即原基础页那块。
2. 分类行列表：一行一个分类，左边分类名，右边灰色小字写它现在的关键状态，最右一个 ›，整行可点（`data-cat="<id>"`），行之间用细分隔线，不加卡片底。各分类右侧状态：
   - 风格：当前对话框风格名（`dialogSkinLabel`）
   - 文字：字号，如「18px」
   - 界面：工具栏位置（「顶部固定」 / 「紧贴对话框」）
   - 演出：「开 N 项」，按 `PERFORMANCE_FEATURES` 中开着的、不含 sound 组的数量
   - 声音：「开 N 项」，只算 sound 组
   - 角色：「N 个角色」，素材模式关闭时写「素材模式未开」
   - 场景：「N 个背景」
   - 生图与AI：图像来源名
   - 数据：「备份 · 日志」
3. 「最近改过」：最多 5 行，扁平列表，没有记录时整段不显示。点一行跳到那一项并闪一下。
4. 底部一行扁平文字按钮：「新手引导」（`onboarding-start`）。

**最近改过**：
- 在设置器的 DOM 事件里，用户改 `data-path`、`data-switch`、`data-segment-path` 时记录 `{ path, label, page }`。
- label 从触发元素就近取：`.igs-settings-field > span`，或开关的 `span` 主文字，或 segmented 所在 field 的标题。
- 存 localStorage `igs:settings-recent:v1`，按 path 去重，最新在前，保留 5 条。
- 只在事件发生时写，不做任何常驻开销。

## 3. 搜索机制（先修机制）

- 搜索条目的 target 改为 `{ page, open: [...], path? }`。手写条目（`FEATURE_ALIASES`、`EXTRA_ENTRIES`）保留口语别名，target 按第 1 节的映射改成新页面，location 文案改成新路径，如「演出 › 画面」「生图与AI › 画师与模型」。
- 新增**自动索引**：
  - 第一次输入搜索词时，用渲染器把每个页面以「索引模式」渲染成 HTML 字符串。索引模式下所有 `isOpen` 都返回 true；跳过角色 / 背景 / 衣柜 / 预置CG 列表、CG 网格、日志列表这些重内容和带副作用的部分，不触发缩略图读取和 CG 库加载。
  - 用正则从 HTML 提取三类条目：
    - `<label class="igs-settings-field"><span>标签</span>…data-path / data-segment-path="路径"`（不跨越 `</label>`）
    - `data-switch="路径"…<span>标签`
    - 卡片标题 `igs-source-filter-title`、折叠 `<summary><b>…</b>`
  - 同时记下条目所在的 `data-advanced` 折叠 key，以及外层 perfItem 的 `perf-<key>`，作为 open 列表。
  - 与手写条目合并去重：同页同名时以手写条目为准，因为它带别名。
  - 缓存在本次打开的设置状态上，关掉设置即丢弃。
- **跳转定位**：有 path 时按 `[data-path="…"]`、`[data-switch="…"]`、`[data-segment-path="…"]` 精确找元素，取最近的 `.igs-settings-field / .igs-perf-item / label` 闪烁；没有 path 再用现有的 `findSettingNode` 按文字找。
- 新增测试：对每个页面（索引模式）断言自动索引覆盖了页面里所有带 `data-path` / `data-switch` 的项。允许少量白名单，例如列表里按角色动态生成的字段。

## 4. 需要改的调用点（已定位）

- `settings-tabs.js`：模板拆分重组。
  - 基础模板拆成 dash / parse 两部分。
  - 规则模板拆成 rules / wardrobe / eventcg 三部分。
  - 生图子页模板沿用。
  - 旧的 `*_SUBTAB_DEFS` 导出如果被测试或其他模块引用，保留或改成从新的页表派生。
- 新建 `settings-pages.js`：分类表、页面表、旧 id 映射、`normalizeSettingsPage`、`categoryOfPage`。纯数据和纯函数。
- `settings-host-render.js`：
  - 把 `renderSettingsBody` 里按 tab 的四个大分支改成四个**值构建函数**（basic / image / scene / reader），按页面所需懒调用。
  - 页面渲染 = 子页条 + 页面模板（`renderTemplate(模板, 合并后的值)`）。
  - snapshot 里加 `page`、`category`；`tabs` 契约改为按分类给出。
  - 侧边栏和仪表盘在这里生成。
- `settings-shell.js`：新外壳，包括头部 ☰、侧边栏、遮罩、搜索、body。
- `settings-host.js`：
  - 点击委托：新增 `data-cat`、`data-page`、`data-nav-toggle`、最近改过的跳转；旧的 `data-tab`、`data-*-subtab` 处理可以删除或映射。
  - 其他改动：`openSettings` 与 `rememberSettingsPage`（新格式 `{tab, page}`，读旧格式时走映射）、`goToSetting`、`revealSetting`、搜索懒建索引、最近改过的记录。
- `settings-normalize.js` 的 `normalizeSettingsTab`：认新分类 id 和旧 id。
- `reader-host.js`：
  - 约 415 / 434 行的 `tab === 'scene'`：图片刷新判断改为「当前页面属于角色或场景分类」。
  - 437 行 `sceneSubTab === 'review'`：改为 `page === 'review'`。
  - 444 行日志：改为 `page === 'logs'`。
  - 536 行 `getSettingsSnapshotContract`。
  - 4171–4174、4308、4397–4401 行：跳到 `chars` 页。
- `settings-actions.js` 约 3307 行 `open-character-dna`：跳到 `chars` 页。
- `settings-outfit-actions.js` 约 157、401 行：跳到 `wardrobe` 页，`wardrobeFocus` 照旧。
- `reader-dom-render.js` 约 457 行 `buildFallbackSettingsOverlay` 用到的快照字段：同步。
- `performance-settings-layout.js`：
  - 新增按组渲染单页的函数，返回该组内容，不包 `groupCard` 的 details。
  - `renderPerformanceSettings` 如果再无调用方可以删除，或者保留给测试。
  - `GROUP_BRIEFS` 和组计数可以给仪表盘复用。
- `reader-host-constants.js`：`SETTINGS_PANEL_REQUIRED_SELECTORS`、`SETTINGS_PANEL_TAB_CONTRACT` 改为按新分类，requiredPaths 跟着项目搬家。
- `settings-search.js`：见第 3 节。
- `settings-style.js`：侧边栏、滑出抽屉、仪表盘行、通用子页条的样式。旧 tab 横条样式删除。
- 测试，在 `app/tests/` 下，至少包括：
  - `settings-search`、`settings-panel-ux`、`settings-detail-polish`、`performance-settings`
  - `gate-contract`、`simulate`、`onboarding-guide*`
  - `character-outfits-settings`、`feed-settings`、`settings-energy`
  - 另有 `scripts/record-pages-capture.mjs`
  - 断言旧结构的，改成断言新结构；不要为了过测试删断言。

## 5. 新手引导（代理 C，在结构改完后做）

文件：`onboarding-guide-steps.js / -runtime.js / -controller.js / -style.js / -invite.js / onboarding-guide.js`。

已知缺陷，全部要修：
1. 「素材模式」没开时，旧第 8、9 步指向隐藏元素。步骤要支持 `requires`：目标不可见（`hidden` 或 `offsetParent===null`）时，先高亮「启用场景素材模式」开关并提示「先开启」；或者自动跳过。择一实现，并写进报告。
2. 打开方式那步的文案要照实际选项标签写，见 `schemas/reader-mode.js`，建议项写「楼层内嵌」。
3. 窄屏上引导卡会盖住目标：
   - 挂载时量出引导卡高度，给 `.igs-settings-body` 预留同样高度的底部内边距。
   - 目标滚动用 `block:'start'` 加 `scroll-margin`。
   - 宽度 ≤420px 时，引导卡要么可折叠，要么当目标在下半屏时贴到顶部。
4. 中途关闭不能续接：
   - 每次换步都持久化 `step`。
   - 邀请条在有进度时显示「继续」。
   - 明确 Esc 等于暂停，并在卡片里写一句。
5. 目标找不到时卡片加一行「这一项当前不可见」，不要静默指空。
6. 步骤数据支持 `open: [advancedKey...]`（自动展开折叠）和 `page`（新页面 id），去掉旧的 `tab` / `subTabs`。
7. 测试里写死的步骤下标，一律改为按 id 取，例如导出 `stepIndex(id)`。

新步骤，约 10 步，第 2 步保持问卷 quiz：
1. 欢迎：说明可跳过、可暂停后继续。
2. 问卷：高亮仪表盘档位条。
3. 侧边栏：手机上高亮 ☰，电脑上高亮侧边栏；说明「设置按用途分类，仪表盘右侧能看到每类现状」。
4. 演出档位与省电模式：高亮档位条里的画质行。
5. 演出细项：跳到 `perf-text`，讲「每项一个开关，点 › 看细项」。
6. 风格与文字：跳到 `style`，高亮对话框风格；顺带提字号、字体在「文字」。
7. 界面与工具栏：跳到 `ui`，高亮按钮管理列表（选择器限定在本页内）；说明阅读器里目录、存档、CG库都在工具栏。
8. 角色与场景：先过素材模式的 requires；跳到 `scenes`，讲＋、下载默认素材、多选；提「立绘设置」在「角色」页。
9. 生图（optional）：跳到 `source`，高亮图像来源字段；没配置也不影响阅读。
10. 找不到就搜：高亮搜索框；说明「最近改过」在仪表盘；结束。

## 5.5 演出写法改成世界书条目（代理 D，在结构改完后做）

用户 10-11 拍板：每个演出模块的写法按酒馆世界书的格式排版，**每条只有四个字段，加正文**。

- **位置**：生图与AI › 写法规则 页。上面是总格式规则，原「AI格式规则」不变；下面是演出条目列表。删掉演出页里的「演出提示词」入口，也就是 `renderFxPromptsFields` / `perf-fx-prompts`；搜索别名把「演出提示词」指到这里。
- **每条的内容**：
  - 标题：模块名，用现有的 `FX_PROMPT_LABELS` 和 prompt-entries 的块名。
  - 启用：开关，等同现在的「关闭」状态。
  - 常驻：开关。
  - 触发关键词：逗号分隔；`/正则/` 里的逗号不拆，沿用现有解析。
  - 注入位置：系统说明区 / 聊天末尾 / 指定深度，与现有全局 `promptPlacement` 的取值对齐，另加「指定深度」。
  - 深度：只在选「指定深度」时出现，指**插入深度**，同酒馆 @D，即插在倒数第 N 条消息处。
  - 正文：文本框，预填内置写法；改动即覆盖，清空恢复默认。沿用 `fxPromptTexts` 的覆盖逻辑。
- **列表排版**：每条一行，显示「名称 · 常驻 / 关键词摘要 · 位置」加 ›，点开展开字段和正文；同一时间只展开一条。扁平样式，不用大卡片。
- **删掉的界面**：排除词、次要词、黏性、冷却、扫描范围。已存的旧值忽略，逻辑按「无排除、无次要、无黏性、无冷却、默认扫描范围」运行；规范化时可以直接丢弃这些字段。
- **运行时**：
  - 现在所有按需块拼进同一段，注入到全局位置。改成**每条按自己的位置和深度单独注入**。
  - 位置和深度与全局相同的条目可以合并成一段，以免段数过多。
  - 常驻条目每轮都发；关键词条目按现有 `resolvePromptTriggers` 判断是否命中。
  - 相关文件：`scene/prompt-entries.js`、`scene/prompt-triggers.js`、`tag-grammar.js`，以及注入处（grep `promptPlacement`）。
  - 先确认酒馆的注入 API（`setExtensionPrompt` 一类）怎么支持「位置 + 深度」，每条用独立的 key。
  - 「本页诊断」和 `getLastPromptReport` 要带上每条的位置和深度。
- **存储**：继续用 `bridge.sceneAssets.promptEntries`，每条新增 `position`、`depth` 两个字段；没写时取全局 `promptPlacement`。
- **测试**：更新 `tests/prompt-entries.test.js`，新增按位置和深度分段注入的用例；全量 gate 要绿。

## 5.9 收尾：性能负担审查（全部完成后，用户 10-11 提前要求）

所有代理（结构、文案、引导、世界书条目、社区手机修复）都完成后，单独做一次审查，重点找加重演出负担的写法：
- 反复渲染：整页或整块 innerHTML 重建、输入或滚动时每次都重绘、仪表盘状态每次重绘都全量重算。
- 深拷贝：`cloneData`、JSON 往返、`structuredClone`，特别是落在翻页、渲染或输入路径上的。参见 10-10 / 10-11 发烫修复的规则：存储配置共享只读、写时浅拷，不许原地改下层。
- 常驻定时器或动画、没节流的滚动或 resize 监听、搜索索引是否真的只建一次。
- 新外壳的抽屉动画在省电画质下是否关掉。

有问题就修；修完重跑 gate。

**审查结果（10-11）：**
- 已修：
  - `prompt-triggers.js` 的关键词匹配器加了缓存，键为「块 + 关键词原文」，上限 64 条。
  - 建搜索索引时，各页共用同一份归一化草稿，见 `settings-host.js` 中 `indexDraft` 一行和 `renderPageForIndex` 的第三个参数。原来每次打开设置后第一次搜索要归一化约 19 次，现在只要 1 次。渲染只读草稿，这一点已在 `settings-host-render.js` 文件头注明。
- 评估后暂不改，交接给后续：
  1. `prompt-entries-fields.js` 的 `renderPromptEntryFields`：每次重绘规则页都调用 `fxBuiltinPromptTexts`，把全部块的内置写法拼一遍。
     - 不改的原因：只在规则页重绘时发生，不在翻页或注入路径上。
     - 用 reader 对象做缓存键没用，因为每次重绘都会重新归一化出新对象，缓存永远不命中。
     - 以后如果规则页变卡，可选的改法：(a) 只给展开的那一行计算正文，收起的行用一个「是否有内置写法」的轻量判断，也就是在 `collectGrammarBlocks` 旁边加一个只返回 key 列表的函数；(b) 以 `fxPrompts`、各功能开关拼成的短签名做缓存键。
  2. `onboarding-guide-runtime.js` 的 `mountOnboardingCard`：引导进行中，每次设置重绘都要读 `offsetHeight` 和 `getBoundingClientRect`，会强制同步布局。
     - 不改的原因：只在引导进行时发生，次数少。
     - 以后要改，可以按「步骤 id + 视口宽高」缓存卡片高度，只在换步或视口变化时重新测量。

## 6. 文案清理（代理 B）

依据审查结论：约 100–130 处，其中约 60 处机械替换，约 40 处需要人工压缩。

第一阶段只改**代理 A 不碰的文件**：
- `fx-settings-fields.js`、`feed-settings-fields.js`、`danmaku-settings-fields.js`、`meta-settings.js`
- `settings-fields.js`、`settings-outfit-fields.js`、`settings-outfit-actions.js`、`settings-actions.js`（只改用户可见的字符串）
- `bgm-settings-actions.js`、`settings-sections.js`、`settings-prompt-kinds.js`、`settings-event-cg.js`
- `reader-host-constants.js` 里的提示文案常量（`PROMPT_RULE_*_HINT` 等，**不要动** `SETTINGS_PANEL_*` 契约）
- 其他 `*-fields.js`

第二阶段等 A 完成后再改：`settings-tabs.js`、`settings-host-render.js` 里的文案。

主要问题：
- **过长**：
  - 演出提示词说明约 170 字 → 一句话，详细 / 精简的区别放进 title。
  - OFF_HINT 约 120 字 → 「已关闭自动注入，请把「复制到酒馆预设」的内容贴进预设，否则背景和立绘不会切换。」
  - 预置CG 说明、补全插图说明、严格匹配说明都压成一句。
  - 工具栏下拉选项压到 4–6 字，解释放进 title。
  - 「立绘透明底（V4.5 需关）」。
  - 日志「保留天数（0 不限）」。
  - TTS 说明压短。
- **黑话**：
  - `enableCorsProxy`、`config.yaml`、`/audio/speech`、`image.novelai.net` 改成通俗说法：传输方式「浏览器直连 / 经酒馆转发」。
  - 「回落 / 回退」→「改用原装图」；「情绪槽 / 表情槽 / 槽名」→「情绪」。
  - token →「费用」或删掉；「注入位置」→「发给AI的位置」；「正则」→「匹配规则」（高级区可保留「正则」并标「进阶」）。
  - 「生图 / SVG」选项 →「图片 / 矢量图标」。
  - 本页诊断输出属于给开发看的文本，可以保留。
- **叫法统一**：
  - 风格（不用皮肤 / 主题）；剧情图叫 CG，「过场图」→「过场CG」。
  - 「情绪」「情绪组」；备用模型；素材预设 / 酒馆预设始终带前缀；本卡。
  - 恢复类按钮只保留「恢复默认」「重置本区」两种；占位符统一「清空恢复默认」，并且只在区块标题说一次。
- **中英空格**：设置器面向用户的文案里去掉中文与英文、数字之间的空格。阅读器 toast 不改，`[igs-` 示例不改。
- **超过 4 字的按钮**：
  - AI整理词库 → 整理词库；清除素材缓存 → 清缓存；导出本卡素材 → 导出素材；导入素材包 → 导入素材
  - 改为跟随上方设置 → 跟随上方；检测并测试生成 → 测试生成；复制到酒馆预设 → 复制预设
  - 全部放到全局 → 全放全局；全部收进本卡 → 全收本卡
- **病句**：「相近情绪词会归入同组」；「只登记外貌的角色」。

改文案后，相关测试里断言旧文案的要同步更新；但搜索的别名表要保留旧叫法作为别名，例如「清除素材缓存」「副LLM」「皮肤」，方便老用户搜到。
