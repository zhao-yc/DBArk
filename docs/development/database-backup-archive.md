# B01 单归档流式基础模块

本片仅提供 `.dbark-backup.zip` 的顺序编码与严格读取端口，结构对齐固定合同 `fb4db474c453bac2bc98a35fa50cf3f9cca90232` 中的 `DatabaseBackupManifest`。不启动备份工具、不执行 SQL、不选择文件，也不获得 AtomicFile 的提交或删除权。

## 给执行器的接口

```ts
const writer = new DatabaseBackupArchiveWriter(
  { writeBytes: bytes => atomicFile.writeBytes(bytes) },
  checkCancelled,
);
await writer.startDump();
// 工具 stdout 的原字节；每片不超过 65536 字节，必须等待背压。
await writer.writeDump(chunk);
const result = await writer.finish(manifest);
// result: { dump: { entry: 'dump.sql', bytes, sha256 },
//           archive: { bytes, sha256 }, manifest }

const checked = await inspectDatabaseBackupArchive({
  size: originalHandleSize, // bigint
  read: (offset, length) => readOriginalHandle(offset, length),
}, checkCancelled);
// checked: { dump, archive, manifest, integrity: 'valid', restoreVerified: false }
```

`finish` 允许省略清单的 `dump` 字段，由模块注入实际字节数及 SHA-256；显式提供时必须完全一致。SQL 不经过解码、换行转换、数值解析或全量缓存。`writeDump` 保存当前片的副本，最多一片在途；错误、取消、非法顺序或并发调用会永久停链。每次 sink 等待前后都检查取消及停链。执行器应先证明工具退出、锁与其他资源终态，再决定如何填写清单以及何时提交 AtomicFile；任何失败由执行器清理临时文件。writer 成功仅证明 sink 接受全部字节，不能标记 `fileCommitted: true`。

reader 只持有同一个受控文件句柄，`size` 与 `offset` 都为 bigint，每次读取请求最多 64KiB。允许返回非空短片，模块继续读取缺少部分；空片、超额片、越界、取消及读取中大小改变都会拒绝。调用方必须持有原文件令牌并保证读取视图稳定。相同大小的外部并发改写不能仅由末尾大小检查排除；本次散列不授权未来恢复，恢复前应按当前文件身份重新检查。

## 固定容器格式与预算

归档恰有两个条目，顺序为 `dump.sql`、`manifest.json`，方法 STORE，UTF-8 与 data descriptor flags 固定为 `0x0808`，版本 45。小归档也采用 ZIP64；本地头 ZIP64 大小占位为零，条目后为带 `0x08074b50` 签名的 24 字节 descriptor，含实际 CRC32、压缩和未压缩 64 位大小。中央目录与结束结构复用 `queryZipDirectory`、`queryZipEnd`。

完整归档上限 10GiB（包括头、清单和目录），清单上限 2MiB，读取和写出片段最多 64KiB。来自文件的 uint64 值先通过 bigint 预算检查，才转换为安全整数。清单还限制深度、节点、字符串和数组数量，拒绝 getter、toJSON、循环、稀疏数组、未知字段、重复对象及非规范大小或散列。类型是固定合同的结构兼容本地类型，没有复制或修改共享合同文件。

inspect 从归档末尾精确定位 98 字节 ZIP64/EOCD，检查磁盘、条数、定位器、目录大小及偏移。中央目录固定为两项共 169 字节，逐字节核对名字、flags、STORE 方法、extra、大小及偏移。随后核对本地头与带签名 descriptor，以及顺序无间隙、重叠、第三条目、额外字段、注释或尾部字节。dump 只流式经过一次，实算 CRC32 和 SHA-256；清单最多缓存 2MiB，验证 UTF-8、规范紧凑 JSON、结构与实际 dump 声明。重读元数据一致后，将头、原数据、descriptor、目录和尾部按原顺序计入整包 SHA-256。

`integrity: 'valid'` 只证明本次读到的容器和字节自洽。CRC/SHA 不证明来源可信；清单中的锁、完整对象范围、工具版本、权限、外部依赖和资源终态仍需执行器及恢复预检独立证明。模块始终返回 `restoreVerified: false`。

## 本片验证范围

仅运行 `tests/unit/database-backup-archive.test.ts` 的 RAM 专项和 `tsc --noEmit`。覆盖原字节、短读、背压、取消、重入停链、CRC 与独立 SHA 不符、清单预算与损坏、重复/路径名字、方法和 flags、头/描述符/目录偏移、条数、伪 ZIP64、尾部歧义及超预算 uint64。

超过 4GiB 的测试使用稀疏 reader，仅提供小块头、descriptor、清单、目录和尾部，证明大偏移无 32 位截断且分配有界。在首次读取合成 dump 原字节时有意阻断；它不代表已经完整读取或验证 4GiB 数据。尚未验证真实工具输出、真实磁盘与原子提交、数据库或恢复，也未运行 full/build。
