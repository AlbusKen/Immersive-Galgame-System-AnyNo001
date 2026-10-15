# CLAUDE.md

## 用户明确禁止全量门禁（2026-10-15）

禁止运行 `npm run gate` / `pnpm gate`，也不得通过改名、拆开或间接调用执行等价全量门禁；不自动运行整套 test / simulate / perf。本条覆盖下文所有旧门禁要求，只有用户明确重新授权才可恢复。构建只生成发布文件；下载、语法和启动问题直接下载并执行实际发布文件，不要求先接入酒馆。不以构建、HTTP 200 或测试数量代替启动结果。

本文件是 Claude Code 的项目指令文件。

## 项目概述

Immersive Galgame System 是一个 SillyTavern（酒馆）的酒馆助手脚本，提供视觉小说阅读器、AI 图片生成集成、场景素材模式和统一设置面板。

## 关键路径

- 源码：`app/src/`
- 测试：`app/tests/`
- 构建产物：`app/dist/`
- 远程加载器：`loader/`
- 文档：`docs/`

## 验收命令

```bash
npm test        # 单元测试（tests/ 下除 simulate 外的全部 *.test.js）
npm run simulate # 模拟测试（tests/simulate.test.js）
npm run build   # 构建 bundle
```

## 版本号同步清单

**每次 push 到 main 前都必须升 patch 版本号**（如 0.23.11 → 0.23.12），并同步更新以下文件：

1. `app/package.json` — `"version": "X.Y.Z"`
2. `app/src/core/bootstrap.js` — `const IGS_VERSION = 'X.Y.Z'`
3. `README.md` — 当前状态行和更新日志
4. 升号后必须 `npm run build`（dist bundle 内 `IGS version` 注释随之更新）+ `npm run build:loader -- --release test-vX.Y.Z`（更新自动更新版并生成锁定测试标签的 `loader/沉浸式Galgame系统 test-vX.Y.Z.json`）

## Loader 说明

`loader/` 下有两类 loader：

- **自动更新版** `igs-loader.json`（脚本名「沉浸式Galgame系统（自动更新）」）：拉取 `@main` 最新代码，push 到 main 后真机即可加载验证。这是开发/日常使用的 loader，固定一个文件、不带版本号。
- **测试固定版** `沉浸式Galgame系统 test-vX.Y.Z.json`：在 loader 源前注入 `IGS_LOADER_REF='test-vX.Y.Z'`，锁定测试标签；使用 `build:loader -- --release test-vX.Y.Z` 生成并随提交推送同名标签。`--pin` 仍可锁定历史正式标签。

历史上曾每次升号生成一份「（自动更新） vX.Y.Z.json」副本，但它们内容全同且都指向 `@main`、不锁版本，纯属冗余，已于 v0.23.21 清理，并改为上述固定版机制。

`app/tests/gate-contract.test.js` 与 `app/tests/simulate.test.js` 自 v0.23.9 起已改为动态读 `package.json` 版本号（`pkgVersion`/`readJson`），无需手改；但升号后必须重新 `npm run build` 让 dist 版本号对齐，否则 `gate-contract` 校验 dist 版本会失败。

## 提交与推送规则

- 每次更新提交前升 patch，并同步 package.json、bootstrap、README、dist 与 loader。
- 2026-10-15 用户新规则：每次更新提交均推送 main，并为同一提交创建和推送 `test-vX.Y.Z` 测试标签；版本号与脚本一致。
- 不自动创建 `vX.Y.Z` 正式版标签，正式发布须用户另行明确要求。
- 禁止覆盖旧标签；只暂存本轮文件，保留无关工作区改动。

## Bug 修复闭环

1. 复现并修复，执行本问题必要的定向验证；全量门禁仍禁用。
2. 升 patch、同步文档，构建 bundle 与 `--release test-vX.Y.Z` loader，记录实际执行结果。
3. 提交并推送 main；创建 `git tag -a test-vX.Y.Z` 并推送，核对分支和标签。
4. 真实酒馆与手机未终验时明确记录边界；测试标签不代表设备验收。后续发现问题则升号提交新的测试标签，不覆盖旧标签。


## 修改前必读

1. `README.md`
2. `AGENTS.md`（协作规则，不要修改此文件）
3. 目标模块的 `CONTRACT.md`

## 代码风格

- 无注释优先，只在 WHY 不明显时加一行注释
- 不加 JSDoc、不加 TODO 注释
- 测试名以 `gate:` 前缀开头
- ES Module 语法，Node 原生 test runner

## 场景素材模式相关文件

- `app/src/scene/scene-directives.js` — @igs-scene 标签解析
- `app/src/host/prompt-injector.js` — AI 提示词注入
- `app/src/visual/igs-ui/reader-host.js` — 设置面板 + 阅读器渲染
- `app/src/scene/message-source.js` — 正文管线集成
