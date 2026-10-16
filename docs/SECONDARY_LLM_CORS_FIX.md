# v0.36.58 副 LLM 经酒馆转发

风险 R4：宿主网络适配、共享副 LLM 调用与发布构建。

## 现象与原因

点击「拉取模型」时，旧版从酒馆页面直接 GET 上游 `/v1/models`。携带 Authorization 后触发跨域预检，上游未提供 Access-Control-Allow-Origin，浏览器拦截请求。独立副 LLM 的生成同样直接 POST 上游，存在相同问题。错误提示却让用户检查浏览器跨域设置。

对照同项目 `nai-dbgen/src/adapters/llm/transport/st-backend.js` 与 `request-data.js`：模型列表经酒馆 `/api/backends/chat-completions/status`，生成由 ChatCompletionService POST `/generate`，使用 `custom` 来源和酒馆 CSRF 请求头。对照 `ref/SillyTavern/src/endpoints/backends/chat-completions.js`，确认这两个原生路由在服务器端请求上游，并合并请求内的 custom_include_headers。

## 修改

- `secondary-llm.js` 共用同一个同源 POST 入口，模型列表走 `/status`，生成走 `/generate`；从酒馆上下文读取请求头，使用当前会话。没有新增服务器路由、通用代理依赖、网络轮询或重试队列。
- `custom_url` 接受接口根地址、版本路径及完整 models/chat-completions 地址，转换为酒馆需要的 API 基址。API Key 放在请求内的 custom_include_headers，JSON 作为有效 YAML 由酒馆解析；空 Key 显式覆盖 Authorization，不读写酒馆主连接配置或密钥库。
- 保留完整 system/user 消息、用户附加词、模型去重和转发响应的 JSON/SSE 解析。缺少宿主请求头时报告加载环境错误。
- HTTP 错误、HTTP 200 的 error 响应都明确报告失败，错误文案隐藏插件密钥并去除 HTML。超时覆盖响应体读取，并通过 AbortController 停止这次请求。
- 既有设置器测试改为模拟原生转发；上游跨域访问被测试桩拒绝，验证模型列表仍可加载、选择和保存，失败不清掉已选模型。

## 执行状态与证据

- [x] 确认需求、风险、工作区和模块契约。
- [x] 对照生图插件及酒馆原生路由，旧版两条关键路径在禁止上游直连时复现失败。
- [x] 实现并更新版本、契约和回归测试；八项新增宿主回归通过。
- [x] 146 项定向单测和两项完整设置器模拟通过，覆盖禁止上游直连、模型选择保存及失败后保留已选模型。
- [x] 隔离副本完整 `npm run gate` 通过：structure、static、2362 项单测、239 项模拟、perf 和 build 全绿。性能 smoke：4.03ms，map-gen 779ms，reader-source 400ms。
- [x] 压缩/调试 × 自动/手动四种 bundle 冷启动检查通过；loader 预先构建，一致性门禁通过。选择性同步后再次核对 manifest、loader 原文及 17 个 WebP 的 SHA256。
- [ ] 真实酒馆复验；当前只使用模拟接口，未调用用户配置的真实模型、未打 tag。

原工作区 17 个 WebP 修改保留；完整构建使用隔离副本，产物选择性同步。

完成门禁后提交并推送 main，远程提交核对结果由本次交付回复记录；真实酒馆复验通过后才打对应版本标签。

## 待复验

自动更新版加载 v0.36.58 后，使用用户已填的独立接口点击「拉取模型」，确认浏览器请求目标为酒馆同源 `/api/backends/chat-completions/status`，模型下拉可选且保存成功；再触发一次副 LLM 规划，确认 `/generate` 成功且主连接配置不变。真实酒馆、该上游接口与手机仍待复验，通过后才打对应 tag。
