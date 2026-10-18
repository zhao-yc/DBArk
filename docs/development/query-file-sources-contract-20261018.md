# SQL 文件来源合同（0.24独立片）

本合同只定义 backend 与 renderer 接缝，基于固定 `457692009dbe4363acc7d61cc877c1063c5ea23d`。不改变既有本地查询库 `sourceBinding`，不接收 renderer 提供的文件路径。

- 查询标签可持有 `fileSourceBinding: {id, revision}`。它只是引用；主进程私有来源表按 tabId 保存原生选择的路径、身份及文件基线。只有 query 标签可以持有，table 标签拒绝。
- `QueryFileSourceView` 供显示，含 `ref/name/displayPath/encoding/bom/eol/savedSqlDigest`。`displayPath` 不是权限，也不能回传来授权写入。
- `queryFileSources.open({tabId,encoding,source?})`：tab 必须先经 `settings.save` 保存为当前查询文档。没有 source 弹原生打开框；有 source 是用户明确要求重读当前关联原文件。返回 `opened` 的正文与 binding，或 `cancelled/blocked`。启动及 status 不读外部文件。
- `save({tabId,source,sql,eol?})`：对精确修订的关联保存点击时正文，默认 preserve。统一换行按文件原风格编码；混合换行正文未变保留原字节，正文编辑后 preserve 被拒绝，用户须明确选 lf/crlf/cr。BOM/编码按来源保持。
- `saveAs({tabId,source?,sql,encoding,bom,eol})`：原生保存框授权新路径，显式选择编码/BOM/换行策略。source 存在时必须精确匹配，不能借另存覆盖另一标签刚建立的关联。
- `status({tabId,source?})`：仅查看主进程私有记录，不访问外部文件；用于重启后的文档重新绑定。返回 `bound/unbound/blocked`。坏来源不删除查询正文。
- `release({tabId,source})`：只释放精确 tab/ref 的授权与在途意图，返回 `{released}`；不能凭旧 revision 删除后来保存/重新打开的来源。文档移除也精确回收；窗口导航仅撤销该窗口的活动操作，仍保留属于已保存文档的重启授权。

保存成功返回 `saved`，binding 中的 revision 及 savedSqlDigest 是本次保存快照的基线。renderer 应只推进该快照基线，不回填旧正文，不清除保存期间新输入。文件保存与本地查询库保存的菜单、Ctrl/Cmd+S、保存后关闭路由由 renderer 片统一，菜单保留原 `save-query` 事件。

`blocked` 必须处理 `wrote`：`no` 可表述未写；`yes` 表示文件已写但记录等后续失败；`unknown` 表示不能确定最终文件。后两者不能自动重试。reason 区分外部变化/缺失/物理身份变化/来源或文档失效/占用/混合换行/编码/IO/存储/结果不确定。所有消息是固定中文，不透传系统错误或 SQL。

backend 下一提交负责私有 SQLite 8→9、重启授权、来源版本核对、原子替换与写后读回、窗口来源及退出等待。此合同提交本身不代表已实现后台，未进行平台验收。
