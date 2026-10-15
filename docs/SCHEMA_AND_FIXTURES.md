# Schema、Fixtures 与模拟测试

本项目保留运行时数据 schema 与真实行为回归所需的 fixtures。模拟结果与真实酒馆验收分开记录。

## Schema 落点

| 类型 | 位置 | 说明 |
| --- | --- | --- |
| 跨模块通用数据结构 | `app/src/schemas/` | SceneState、ImportManifest、ModPermission、ResourcePack 等跨目录共享结构 |
| 模型提示词和工作流 schema | `app/src/prompts/schemas/` | NAI、ComfyUI、GPT 图像、banana 等模型专属输入输出 |
| shujuku 表格模型 | `app/src/data/shujuku/` | 表格行、sheet 映射、刷新结果、错误结构 |
| Mod / Preset / Pack 格式 | `app/src/registry/` 或 `app/src/schemas/` | 导入清单和能力声明放通用 schema，运行时代码放 registry |

优先使用 JSON Schema 描述可导入文件格式，优先使用 Zod 或轻量 runtime validator 描述运行时 LLM 输出和外部 API 返回值。schema 样例只能放脱敏短样例，不放真实聊天正文、真实 API key 或大段 prompt。

## Fixtures 规则

`app/fixtures/` 只放模拟测试数据：

- fake TavernHelper 聊天消息
- 标准 IGS 正文、空聊天、乱码文本、含时空栏正文
- 含生图段正文和 provider 响应
- fake shujuku 表格和写表结果
- 背景、立绘、头像资源包样例
- 移动端和桌面端布局输入样例

fixtures 文件应短小、可读、可复用。需要大资源时只放 manifest 和占位 URL，不放真实图片包。

## 行为回归与证据

保留范围统一见 `../app/tests/README.md`，不再维护逐域必跑矩阵或重复的门禁命令表。只选能验证当前行为风险的已有用例，不为覆盖率、数量或矩阵完整性补项。

例如，在 `app/` 验证阅读器准备缓存：

```text
node --test tests/reader-floor-preparation.test.js
```

报告实际命令、退出结果和未覆盖的环境。未执行、失败或只有 fixtures 证据时，不声称真实酒馆、手机或 provider 已验收。

## 图片数据边界（v0.36.39）

| 数据 | Schema / 归属 | 回归重点 |
| --- | --- | --- |
| 内容缓存 | `igs-image-cache` v3，files 内容 / meta 别名 | 同内容去重、原子 quota abort、条目与字节预算、活跃租约、多页面失效、清理中断、四路下载、销毁 |
| 图片业务记录 | 素材 schema v2；CG / 照片原有 schema | 原图不可变、metadata 不读像素、revision 冲突、重画失败保旧图 |
| 媒体日志 / 备份 | `igs-media-journal` v1；四类酒馆备份 v2 | WAL 准备失败、离线上传恢复、版本合并、tombstone 防复活、浏览器数据丢失后恢复删除队列 |
| 配置引用 | `igs-settings.json` v2；地图记录独立权威 | 网络/500 不覆盖、远程键合并、地图旧配置迁移与删除、导入新 ID/共享链接/头像/失败补偿 |

新增 `media-cache-lifecycle`、`media-cache-concurrency`、`media-storage-lifecycle`、`media-transactions`、`media-settings-concurrency` 测试。`helpers/fake-idb.js` 模拟多 store 原子事务、abort、quota 与升级；`helpers/fake-media-server.js` 模拟文件和图片 API，不接触真实图库。真实酒馆、移动端解码内存和真实 provider 为未验证边界，不用这些 fixture 结果替代真机验收。
