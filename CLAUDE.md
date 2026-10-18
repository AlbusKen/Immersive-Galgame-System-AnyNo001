# CLAUDE.md

## 检查清单精简

实际删除无用、重复、仅锁定源码写法或 CSS 字面量的检查及其执行入口，不以默认跳过代替精简。保留能发现行为、数据、兼容性、安全、资源生命周期和启动故障的已有用例，范围见 `app/tests/README.md`。不为测试数量或覆盖率补用例，不改名恢复等价全量门禁。

构建只生成发布文件；下载、语法和启动问题直接获取并执行实际发布文件，不要求先接入酒馆。不以构建、HTTP 200 或测试数量代替启动结果。

本文件是 Claude Code 的项目指令文件。

## 项目概述

Immersive Galgame System 是一个 SillyTavern（酒馆）的酒馆助手脚本，提供视觉小说阅读器、AI 图片生成集成、场景素材模式和统一设置面板。

## 关键路径

- 源码：`app/src/`
- 测试：`app/tests/`
- 构建产物：`app/dist/`
- 远程加载器：`loader/`
- 文档：`docs/`

## 开发命令

在 `app/` 下执行：

```text
node --test tests/reader-floor-preparation.test.js  # 按问题选择已有行为用例
npm.cmd run build                                # 构建 bundle
npm.cmd run preview:records                      # 资料页预览
```

## 版本号同步清单

**每次 push 到 main 前都必须升 patch 版本号**（如 0.23.11 → 0.23.12），并同步更新以下文件：

1. `app/package.json` — `"version": "X.Y.Z"`
2. `app/src/core/bootstrap.js` — `const IGS_VERSION = 'X.Y.Z'`
3. `README.md` — 当前状态行和更新日志
4. 升号后必须 `npm run build`（dist bundle 内 `IGS version` 注释随之更新）+ `npm run build:loader -- --release vX.Y.Z`（更新自动更新版并生成锁定版本标签的 `loader/沉浸式Galgame系统 vX.Y.Z.json`）

## Loader 说明

`loader/` 下有两类 loader：

- **自动更新版** `igs-loader.json`（脚本名「沉浸式Galgame系统（自动更新）」）：拉取 `@main` 最新代码，push 到 main 后真机即可加载验证。这是开发/日常使用的 loader，固定一个文件、不带版本号。
- **版本固定版** `沉浸式Galgame系统 vX.Y.Z.json`：替换 loader 内部 `PINNED_REF` 常量，锁定同名版本标签；使用 `build:loader -- --release vX.Y.Z` 生成并随发布推送。固定版失败不回退其他版本，`--pin` 可生成指定历史版本。

历史上曾每次升号生成一份「（自动更新） vX.Y.Z.json」副本，但它们内容全同且都指向 `@main`、不锁版本，纯属冗余，已于 v0.23.21 清理，并改为上述固定版机制。

`app/tests/gate-contract.test.js` 与 `app/tests/simulate.test.js` 自 v0.23.9 起已改为动态读 `package.json` 版本号（`pkgVersion`/`readJson`），无需手改；但升号后必须重新 `npm run build` 让 dist 版本号对齐，否则 `gate-contract` 校验 dist 版本会失败。

## 提交与推送规则

- 每次更新提交前升 patch，并同步 package.json、bootstrap、README、dist 与 loader。
- 2026-10-18 用户纠正：经用户授权发布时推送 main，版本标签统一使用 `vX.Y.Z`；禁止再沿用带 test 前缀的新标签。
- 经用户授权发布时使用 `vX.Y.Z` 标签，与在线包和程序版本一致。
- 禁止覆盖旧标签；只暂存本轮文件，保留无关工作区改动。

## Bug 修复闭环

1. 复现并修复，执行能证明本问题行为的定向验证；不恢复已删除的检查项。
2. 升 patch、同步文档，构建 bundle 与 `--release vX.Y.Z` loader，记录实际执行结果。
3. 提交并推送 main；创建 `git tag -a vX.Y.Z` 并推送，核对分支和标签。
4. 真实酒馆与手机未终验时明确记录边界；版本标签不代表设备验收。后续发现问题则升号提交新的版本标签，不覆盖旧标签。


## 修改前必读

1. `README.md`
2. `AGENTS.md`（协作规则，不要修改此文件）
3. 目标模块的 `CONTRACT.md`

## 代码风格

- 无注释优先，只在 WHY 不明显时加一行注释
- 不加 JSDoc、不加 TODO 注释
- 测试名描述所保护的行为，既有前缀不作为删留依据
- ES Module 语法，Node 原生 test runner

## 场景素材模式相关文件

- `app/src/scene/scene-directives.js` — @igs-scene 标签解析
- `app/src/host/prompt-injector.js` — AI 提示词注入
- `app/src/visual/igs-ui/reader-host.js` — 设置面板 + 阅读器渲染
- `app/src/scene/message-source.js` — 正文管线集成
