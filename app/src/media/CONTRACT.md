# media 模块契约

## 职责

- 提供通用图片池和媒体缓存。
- 管理本地文件、URL 图片、生成图片、Blob URL 和资源生命周期。
- 为 `backgrounds`、`characters`、`generated-images` 提供统一资源句柄。
- 自动插图的 tag 与图片持久化（`illustration-store.js`，IndexedDB，键 `chatId|messageId|swipeId[|slot]`）。
- 素材补全的图片与临时素材持久化（`generated-asset-store.js`，IndexedDB `igs-generated-assets`：`images` 存图片本体、`assets` 存本聊天临时素材、`floors` 记录楼层是否已处理）。
- 立绘抠图（`alpha-matte.js`）：从四边洪泛抠除与边缘连通的浅灰纯色底，边缘羽化 + 去溢色，并裁掉透明留白；无 canvas 时原样返回。
- CG 库（`cg-library.js`）三层数据分开：目录（`cg-index-store.js`，IndexedDB `igs-cg-index` 的 `entries`，每张 CG / 照片一条轻记录，不含图片）、缩略图（同库 `thumbs`，320 宽 JPEG，`stamp` 使用条目 `updatedAt` 与可选 `revisionToken`，旧条目沿用时间戳，CG 同槽替换后自动作废）、原图（`igs-illustrations` / `igs-photo-album` + 酒馆文件，只在看大图或生成缩略图时读）。打开 CG 库只读目录；对账只比主键（`getAllKeys`），只读缺失 / 未就绪及本实例已提交但目录同步失败的槽位，每批 20 条。`withCgIndexSync` 让 `putSlot` / `updateSlot` / `deleteSlot` 同步目录；写入按实际保存结果登记，目录失败不撤销已提交图片。每一步都有期限（`CG_LIBRARY_TIMEOUTS`），失败带原因码，`cgReasonText` 转中文。`idb-connection.js` 统一 IndexedDB 连接：打开超时 8 秒、被挡住直接报错、`versionchange` 时关闭让路、事务 20 秒超时。`parseFloorKey` / `parseCgSlotKey` 从右取两段解析（chatId 可含 `|`）。`cg-gallery-store.js`（`igs-cg-gallery`）只存隐藏 / 收藏标记；「删除」调用 `clearIllustration`（楼层 CG 同时消失），成功后才清标记和目录。

  - `createAlphaMatte()(dataUrl, { detailed: true })` 返回 `{ dataUrl, alphaMaskDataUrl, diagnostics: { crop, sourceWidth, sourceHeight } }`；不传 `detailed` 时仍只返回字符串（旧契约）。遮罩为 RGB=alpha 的不透明 PNG，与透明结果同尺寸。
- 生成图片记录 schema v2（`generated-asset-store.js`）：立绘额外保存不可变 `originalDataUrl`、最近接受的 AI 重建 `workingDataUrl`、当前遮罩 `alphaMaskDataUrl`、自动抠图裁边 `matteCrop` 与 `revision`；`dataUrl` 始终是当前透明结果，供旧消费者读取。只有 `dataUrl` 的旧记录按 legacy 读取，不伪造原图、不可编辑。`updateImage(id, expectedRevision, patch)` 在同一 readwrite 事务内校验 revision 后写入，`originalDataUrl`/`id` 永不改写；失败原因为 `not-found` / `source-unavailable` / `stale-revision` / `empty-result`。写入完整记录遇存储额度错误时降级为只存透明结果，并在素材记录上标 `sourceUnavailable: 'quota'`。
- 遮罩编辑（`matte-brush.js` 纯函数、`matte-edit-session.js` 会话）：保留 / 删除 / 软边画笔、坐标映射回原像素、有界撤销重做（默认 20 步，只在内存中）；会话不写存储，由调用方保存。

## 子能力

- `image-pool`
- `local-pack-store`
- `url-pack-store`
- `generated-image-store`

## 边界

- URL 图片只在当前渲染页实际需要时加载；同一地址共享加载任务与会话缓存，缓存必须有界，并在销毁或淘汰时释放 Blob URL。
- `media` 不决定哪张背景或立绘应当显示，只提供资源读写与缓存。
- 背景匹配属于 `backgrounds` / `scene`。
- 角色匹配属于 `characters` / `scene`。
- 生图请求、轮询和 provider 适配属于 `generated-images`。
- 用户上传字体（`custom-fonts.js`）：文件存酒馆 `user/files/igs-font-*`，清单存 localStorage `igs-custom-fonts-v1`（随全局配置同步）；用 FontFace 注册到宿主 document，渲染只读 font-family 栈。
- 酒馆图片搬家（`tavern-image-files.js`）只在整条记录未被改写时落盘，避免用旧记录覆盖期间保存的提示词等字段。
- 一致性工作画布（`cg-reference-canvas.js`）保留角色粗区域 `rect`、原 CG 尺寸和像素上限。工作裁剪 `crop` 向各侧包含原 CG 短边 10%（向上取整）的周边上下文，并裁到整图边界。输入蒙版独立使用硬边矩形：实际工作区像素映射到原角色矩形内（含角点）时 RGB 为 255，外部为 0，alpha 恒为 255；无圆角、羽化或抗锯齿灰度。上下文、工作区取整延展与侧边参考区保持黑色蒙版。回贴仍使用原角色区域的圆角支撑区，四侧统一渐变，包括触及整图边缘的侧边；混合带为区域短边 16%（最多 96 像素），以 smoothstep 混合当前原图与重绘图 RGB，取原坐标和实际缩放采样点回贴权重的较小值。中心采用重绘结果，原 alpha、区域外 RGBA 与零权重角点保持，不修改输入原图；参考区不回贴正式 CG。输入硬边与回贴混合是独立步骤，不保证消除模型生成的边框或错位轮廓。粗区域不是人物分割，区域内非目标内容及构图保持仍依赖模型遵从，真实效果需候选预览复验。
- 一致性接受经 `updateSlot` 的 revision/token 与提交门禁写入：正式 CG 保存场景 recipe／DNA 快照，各轮实际 `infill` 来源单独存于 `consistencyPrompt.version: 1` 的 `rounds`。`clearSentPrompt: true` 是存储选项，清除旧整图 wire；新 `prompt` 不沿用旧 wire。首次基线保留原图及实际存在的正文、来源和尺寸字段，不写可选 undefined 字段。文件 offload／备份恢复保留嵌套轮次与基线；无该字段的旧记录继续原形读取。文件上传与 IndexedDB 不共有事务，拒绝提交时只清理新文件，不宣称跨系统原子性。
- `updateSlot` 可接收事务外的异步 `beforeCommit` 与事务内的同步 `shouldCommit`。文件适配器在 offload 后执行一次 `beforeCommit`，再将剩余选项交给原存储；直连内存／IndexedDB 存储在启动提交前执行复核。复核失败或最后同步守卫拒绝时保留原记录，只清理本次新文件；守卫及租约令牌不持久化。
- 一致性接受替换同一 CG 槽位，复用现有图库与删除入口。`withCgIndexSync` 的目录写失败待修集合仅在当前实例内存中；对账按完整槽位 key 定向补登记，不是持久任务队列。`refreshEntry(key)` 从权威槽位存储重读并保留隐藏／收藏状态，只有确认记录不存在才移除目录，读取失败不伪装删除。图库通过 `ILLUSTRATION_UPDATED_EVENT` 按 `chatId/messageId/swipeId/slot` 刷新同槽目录、缩略图及已打开大图；版本变化清内存缩略图，迟到旧版本结果不得覆盖新版本，视图销毁解除订阅。
