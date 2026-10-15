# AI 工作流

## 用户明确禁止全量门禁（2026-10-15）

禁止运行 `npm run gate`、`pnpm gate` 或改名、拆分、间接执行的等价全量流程；不自动运行整套 test / simulate / perf。只有用户明确重新授权才可恢复。本条覆盖本文件内所有旧门禁要求。`build` 只生成发布文件，不附带批量验收或自动启动检查。下载、语法和启动问题直接获取并执行实际发布文件，不以酒馆、手机调试或导出数据为前提。HTTP 200、构建成功和测试数量均不能替代实际下载和启动结果。

本项目主要由 AI 根据用户方向逐步实现，因此必须让每次改动都能被定位、测试和回滚。

## 开工前

1. 读取根目录 `README.md`。
2. 读取根目录 `AGENTS.md`，判定 `R0-R5` 风险级别。
3. 读取 `功能总集表.md`。
4. 按任务找到 `app/src/<模块>/CONTRACT.md`；shujuku 数据层读取 `app/src/data/shujuku/CONTRACT.md`。
5. 涉及跨模块数据结构时读取 `docs/SCHEMA_AND_FIXTURES.md` 与 `app/src/schemas/CONTRACT.md`。
6. 涉及模块流向或归属不清时读取 `docs/ARCHITECTURE.md`。
7. 只修改对应模块，跨模块必须说明原因。
8. 当前项目不使用奶龙工具箱发布壳；不要新增 `project.json`、`latest/`、`tavern helper/` 等发布壳相关目录或清单，除非用户明确要求进入发布实施阶段。
9. 涉及打包、发布、上传、loader、远程 bundle 或酒馆助手脚本 JSON 时，读取 `docs/PACKAGING_WORKFLOW.md` 与 `docs/RELEASE.md`。

## 执行中清单

功能修改、bug 修复、结构调整和发布流程改动按 `AGENTS.md` 的短清单推进。每完成一项就更新状态；不适用项写明原因，不静默跳过。

## 修改中

- 单文件尽量不超过 300 行。
- 新能力优先新增模块，不把逻辑塞进入口。
- 新增可切换配置时进入 `presets`。
- 新增本地/URL/生成图片缓存时进入 `media`。
- 新增背景规则和背景资源业务时进入 `backgrounds`。
- 新增立绘、头像和说话人匹配时进入 `characters`。
- 新增生图 provider、队列和轮询时进入 `generated-images`。
- 新增模型专属请求构建时进入 `generated-images/request-builders`。
- 新增提示词上下文适配时进入 `prompts/adapters`。
- 新增模型提示词/工作流 schema 时进入 `prompts/schemas`。
- 新增跨模块通用 schema 时进入 `schemas`。
- 新增 JS 扩展能力时进入对应能力页和 `mods`。
- 新增 shujuku 数据读写时进入 `data/shujuku`。
- 新增 shujuku 表格交互 UI 时进入 `shujuku-panel`。

## 验收

构建发布文件使用下列命令；定向检查按当前问题选择，禁止自动批量执行测试：

```text
npm run build
```

当前本机可执行命令使用 npm。后续安装 pnpm 后，保持以下命令等价：

```text
pnpm build
```

全量门禁入口已移除，不得按旧顺序拆开执行。下载与启动问题直接验证实际响应及执行结果。

本项目不运行奶龙工具箱 `pack-project`、`verify-project`、`validate`、`check-refs` 作为本项目验收，除非用户明确要求重新接入工具箱流程。

NailongHub 工作流中的安装版实机验真、Computer Use 实机操作和 live AI 校验，在本项目默认替换为 `docs/SCHEMA_AND_FIXTURES.md` 的 `S0-S10` 模拟测试矩阵。真实酒馆、真实 provider 或真实 shujuku 写入只在用户明确要求时加入。

## 真机调试与复验

模拟测试覆盖不到、或现象只在用户真实酒馆+存量数据下出现时（例如解析管线在特定 AI 输出、特定宿主插件组合下的行为），用真机探针定位，并在改完后真机复验。

**首选：CDP 直连自动注入。** 用户用 Edge/Chrome 时优先。要点：

- Chromium 调试端口只能启动时开，运行中实例无法附加；必须关掉浏览器再带 `--remote-debugging-port=9222` 重启。关浏览器属外部可见操作，先征得用户同意。
- 重启必须复用同一个 `--user-data-dir`（Edge 默认 `…\AppData\Local\Microsoft\Edge\User Data`），否则丢登录态与 `localStorage` 存量数据。
- 用 Node 全局 `WebSocket` 连 `http://127.0.0.1:9222/json/list` 里目标标签页的 `webSocketDebuggerUrl`，发 `Runtime.evaluate`（`returnByValue:true`、表达式末尾 `return JSON.stringify({...})`、值要 slice 短）。探针脚本放项目内临时路径，跑完即删，不进 git。
- IGS 全局句柄 `window.IGS`；数据层 `window.SillyTavern.getContext().chat[id].mes`。

**兜底：F12 `top.prompt()` 手动探针。** CDP 不可用时（用户不愿重启、手机端 TauriTavern/柏宝箱等非 Chromium 宿主）才用：给用户一行顶层 Console 片段，结果用 `top.prompt('复制发给Claude:', JSON.stringify(out))` 弹出可选文本框粘回。

**铁律：改完代码必须真机复验，不靠推理下结论。** 用真机导出的真实数据本地复跑修复后代码，或重载新 bundle 后真机抓状态确认，再提交。

### 修复闭环（真机可用时）

bug 修复按当前用户规则交付测试版本：

1. 修复、必要的定向验证、升 patch，同步 package.json / bootstrap / README。
2. 构建 bundle 与 `npm run build:loader -- --release test-v<当前版本>`，记录实际执行证据。
3. 提交并推送 main，为同一提交创建并推送 `test-v<当前版本>` 测试标签。
4. 有条件时做真实酒馆/手机复验；未做时保留边界。后续修复再次升号和打测试标签，不覆盖旧标签。

2026-10-15 起每次更新均附测试标签，不自动创建 `v<当前版本>` 正式版标签。测试标签不是设备验收结论。

### CDP 不可用时

用户不在、不愿重启浏览器、或手机端（TauriTavern/柏宝箱等非 Chromium 宿主）时：直接下载并执行发布文件，明确记录实际运行环境和未覆盖的设备边界；不能据此声称真实酒馆或手机已验收；照常交付对应测试标签。

## 酒馆助手脚本打包

最终发布给用户导入的是：

```text
loader/igs-loader.json
```

该文件是 JS-Slash-Runner / 酒馆助手脚本 JSON，结构参考：

```text
D:\下载\酒馆\奶龙王\nailongwang-main\_inbox\酒馆助手脚本-玉子手机.json
```

发布数据流固定为：

```text
app/src/** -> npm run build -> app/dist/igs.bundle.js + app/dist/igs.bundle.css -> loader/igs-loader.js -> loader/igs-loader.json
```

原版 Immersive Galgame System 脚本只作为迁移来源和兼容参考，位置固定为：

```text
D:\下载\酒馆\奶龙王\nailongwang-main\奶龙工具箱\projects\Immersive Galgame System 原版备份
```

打包发布任务必须遵守：

- 全量门禁已禁用。直接生成发布文件，核对下载与启动结果；文档任务只检查文档一致性。
- `loader/igs-loader.js` 只负责加载远程 bundle，不写业务逻辑。
- `loader/igs-loader.json` 的 `content` 必须等于 `loader/igs-loader.js` 原文。
- 当前仓库是 private 时，不得把 private raw 地址写成最终用户可用发布源。
- 具体字段、校验命令和公开地址限制见 `docs/PACKAGING_WORKFLOW.md`。

## GitHub 上传

本项目拥有独立 GitHub 仓库：

```text
https://github.com/Anyno001/Immersive-Galgame-System-AnyNo001
```

上传前必须在项目根目录运行：

```text
git status --short
```

确认通过后，只提交本项目目录内文件。不要从上级 `nailongwang-main` 仓库提交，也不要把真实 API key、真实聊天记录、真实 shujuku 数据、本机私有配置或 `pc-data/` 上传。

## 每轮结束回退点

每次更新都升 patch，选择性暂存本轮文件，提交并推送 main，同时为该提交打 `test-v<当前版本>` 测试标签。保留无关工作区改动，不自动创建正式版标签。

```powershell
cd app
npm run build
npm run build:loader -- --release test-v<当前版本>
cd ..
# 仅 git add 本轮修改的具体文件
git commit -m "test-v<当前版本>: <简短说明>"
git tag -a test-v<当前版本> -m "test-v<当前版本>: <简短说明>"
git push origin HEAD:main
git push origin test-v<当前版本>
git status --short --branch
git ls-remote --heads origin main
git ls-remote --tags origin test-v<当前版本>
```

标签版本与脚本版本一致；已存在标签不覆盖、不强推。真实设备尚未终验时明确记录，测试标签不阻断交付。只有用户明确要求不要上传或不要打标签时跳过。

详细发布与上传命令见 `docs/RELEASE.md`。
