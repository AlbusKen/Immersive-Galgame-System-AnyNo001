# media 模块契约

## 职责

- 提供通用图片池和媒体缓存。
- 管理本地文件、URL 图片、生成图片、Blob URL 和资源生命周期。
- 为 `backgrounds`、`characters`、`generated-images` 提供统一资源句柄。
- 自动插图的 tag 与图片持久化（`illustration-store.js`，IndexedDB，键 `chatId|messageId|swipeId[|slot]`）。
- 素材补全的图片与临时素材持久化（`generated-asset-store.js`，IndexedDB `igs-generated-assets`：`images` 存图片本体、`assets` 存本聊天临时素材、`floors` 记录楼层是否已处理）。
- 立绘抠图（`alpha-matte.js`）：从四边洪泛抠除与边缘连通的浅灰纯色底，边缘羽化 + 去溢色，并裁掉透明留白；无 canvas 时原样返回。调用方传的 `alreadyTransparent` 只是预期：没传时先用 `hasTransparentBorder` 看四边，过半像素已透明（智绘姬 / 柏宝绘接 NAI V5 等直接回透明底）就只裁边、不洪泛，`diagnostics.detectedTransparent` 为 true；否则透明像素的 RGB（多为黑色）会被当成底色，把深色描线和黑发一起抠掉。「从原图重新自动抠图」同样走这条判断。
- CG 库（`cg-library.js`）三层数据分开：目录（`cg-index-store.js`，IndexedDB `igs-cg-index` 的 `entries`，每张 CG / 照片一条轻记录，不含图片）、缩略图（统一 `igs-image-cache`，键 `thumb:cg:<key>:<updatedAt>`，320 宽 JPEG，CG 重画后自动作废；`igs-cg-index` v2 保留 `entries` 并移除旧 `thumbs`）、原图（`igs-illustrations` / `igs-photo-album` + 酒馆文件，只在看大图或生成缩略图时读）。打开 CG 库只读目录；对账只比主键（`getAllKeys`），只读缺失 / 未就绪的记录，每批 20 条。`withCgIndexSync` 让 `putSlot` / `deleteSlot` 顺手更新目录。每一步都有期限（`CG_LIBRARY_TIMEOUTS`），失败带原因码，`cgReasonText` 转中文。`idb-connection.js` 统一 IndexedDB 连接：打开超时 8 秒、被挡住直接报错、`versionchange` 时关闭让路、事务 20 秒超时。`parseFloorKey` / `parseCgSlotKey` 从右取两段解析（chatId 可含 `|`）。`cg-gallery-store.js`（`igs-cg-gallery`）只存隐藏 / 收藏标记；「删除」调用 `clearIllustration`（楼层 CG 同时消失），成功后才清标记和目录。

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

## 统一生命周期（v0.36.39）

- 图片像素、派生缩略图、对象 URL、下载和预载任务由 `tavern-image-cache.js` 管理。默认 320 个内容条目，设置允许 1–2000；内存编码字节预算 64 MiB，磁盘 192 MiB。当前页面通过 `media-lease-scope.js` 持有资源键，活跃资源可超过条目数软限制，字节预算仍为硬限制。浏览器解码/GPU/HTTP 缓存由浏览器管理，不包含在该字节统计里。
- 磁盘 schema v3：`files` 按内容身份存一份 Blob，`meta` 存路径别名与 LRU 信息；两者同事务。v1/v2 升级只清可再生缓存。旧素材缩略图库删除，CG 目录保留。业务层不得另建原图 Map、对象 URL 或无限预载缓存。
- 新文件使用像素字节 SHA-256，统一到 `user/images/igs-media/<sha256>.<ext>`。非安全 HTTP 环境用分片 SHA-256 后备实现。持久记录只存文件路径；上传失败时原始像素留在业务数据库并标记待上传，重试成功后才能宣称备份完成。
- 四类文件适配器共用 `media-record-journal.js`：先准备 WAL，提交业务事务，再标记日志完成；备份 v2 保存版本、删除标记和前一版文件引用。未提交的离线像素可临时保留在 WAL，提交后移除，不能当可再生缓存清空。
- 元数据查询用原始记录；显示只 hydrate `dataUrl`，编辑/导出才显式 hydrate 所需字段。读图失败返回空显示结果，不改原始路径；缺少原图/遮罩的记录不得冒充可编辑完整记录。
- 新引用持久化成功后才释放旧引用。物理删除统一进 `media-file-gc.js`：备份成功后，在同一提交锁里检查全部媒体/配置引用和持久写租约再删除；网络错误保留队列，共享引用保护与真正删除失败分别统计。恢复备份会根据前一版引用重建删除任务。
- 同源提交与磁盘预算用 Web Locks；缺失时用 IndexedDB lease 锁。BroadcastChannel 通知缓存清除/单键失效。清理增加世代、取消旧请求和 FileReader、撤销对象 URL；下载最多 4 路。销毁关闭通道和缓存连接，旧任务不得回填。
- `IGS.media` 提供 `clearCache/stats/auditImages/auditFiles/collectImages/flush/retryDeletes/destroy`；孤儿图片先审计，删除仍复查引用。旧文件名恢复只接受可验证归属，不猜 Unicode/截断名称；旧哈希按真实键与内容校验。目录 listing 短期共享，不永久缓存缺图结果。
- 酒馆文件接口不提供 CAS：版本合并、写后校验与重试依赖本机日志仍存在，不能保证多设备同时写入无丢失或提供跨设备强删除隔离。完整库存、兼容条件和验收边界见 `docs/MEDIA_REFACTOR.md`。
