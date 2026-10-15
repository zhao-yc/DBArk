# D07 二进制单元格首个可运行切片

分支 `task/parallel-d07-binary-viewer-20261015`，从干净 `5a1e8de` 创建普通任务分支。D06 原分支与提交保持不变。

## 入口与支持范围

- 表数据中选择二进制列后点击“单元格”，或双击、按 Enter，打开原有单元格弹窗内的 Hex／编码文本／图片查看器。二进制列不再进入通用网格文本编辑器；不能把显示的 `0x...` 意外存成普通字符串。
- 原有记录表单的二进制字段展开也使用同一查看器。任意 SQL 结果的二进制单元格支持双击、Enter 打开只读查看器，无写表定位或保存回调。
- Hex 修改沿用原有记录稀疏缓冲、离开确认、快照校验、草稿集中预览和可靠键／旧值冲突检测，不增加数据库写入入口。
- SQL NULL、DEFAULT 与空 BLOB 分别显示。Hex 空串表示零字节 BLOB，不隐式变成 NULL。二进制列的文本、JSON 保存模式禁用，编码展示保持只读。
- 连接、表结构、加载代次、行、原值或草稿引用变化使旧二进制编辑失效；只读结果刷新也关闭旧查看器。待删除、生成列及无可靠键的表继续受原有只读政策约束。

## 有界值与图片政策

只接受实际读取的完整 `CellValue` 二进制包装值，规范 Base64 校验。完整查看最多 2 MiB；超限在解码和创建 URL 前拒绝。Hex 每段 4096 字节。完整 Hex 编辑最多 131071 字节，并沿用原有 262144 UTF-16 输入上限；超限只能分页查看，不能暂存片段。没有后台取整列、文件路径、外部图片或服务器加载入口。

文本查看限 256 KiB，支持 UTF-8、UTF-16LE、UTF-16BE、GB18030、Windows-1252。`TextDecoder` 使用 `fatal: true` 和 `ignoreBOM: true`；解码失败明确显示错误，保留 BOM，不通过替代字符或重新编码改写原始字节。本轮没有文本编码写回。

图片支持 PNG、JPEG、静态 WebP，显示格式、像素尺寸及实际字节数。头信息尺寸、容器结构与动画标记在 Blob URL 创建前检查，边长最多 4096，像素最多 4194304，结构块最多 4096，JPEG 扫描最多 64。浏览器实际尺寸必须匹配预检尺寸。SVG、HTML、GIF、APNG、动画 WebP 均拒绝；GIF 是本轮未支持范围。创建 Blob 时只使用固定图片 MIME，不使用用户提供的文件名、类型、URL 或路径。

切换视图、修改值、关闭、快照失效与组件卸载均撤销自己创建的 Blob URL；图像解码失败也撤销。资源预算限制输入、显示文本、解码尺寸和扫描结构；不是对浏览器进程堆或操作系统回收时刻的硬保证。

规范依据：[WHATWG 严格文本解码](https://encoding.spec.whatwg.org/#interface-textdecoder)、[W3C PNG](https://www.w3.org/TR/png-3/)、[WebP 容器规范](https://developers.google.com/speed/webp/docs/riff_container)。

## 实际验证与复现

使用当前独立克隆的锁定依赖，无依赖／锁文件改动，没有本机 Docker、业务库访问或长期秘密生成。

```powershell
node node_modules/vitest/vitest.mjs run tests/unit/binary-cell.test.ts tests/unit/record-views.test.ts tests/unit/ui-clipboard.test.ts
node node_modules/typescript/bin/tsc --noEmit
node scripts/build.mjs
node node_modules/@playwright/test/cli.js test tests/e2e/binary-cell-offline.spec.ts --output .cache/d07-e2e
```

单元覆盖规范／非法 Base64、预算、完整 Hex 校验、空 BLOB、严格编码、分页、图片头／像素／动画、SVG／HTML 拒绝、原始快照和陈旧草稿。真实 Electron 夹具使用生产 TableTab、记录控制器、ResultsGrid 和图片解码器；仅表数据和桥接输入为离线夹具，不能代替实库验收。图片由测试 Canvas 生成，不连接外部资源。每例独立临时配置，测试结束关闭本例应用并清理自己的目录。截图与跟踪位于忽略的 `.cache/d07-e2e`。

本次针对性及相邻单元 62 项通过；二进制交互 5 项及 D06 回归 5 项共 10 项真实 Electron 用例分别通过。类型检查和构建通过，保留原有 Zod 注释及大分块提示。

## 交给主对话的验收边界

200 实库、实际集中写入与并发冲突、生产安装包及 macOS/Linux 原生测试由主对话统一安排，本对话不执行。需要的资源仅是主对话核对身份后的现有隔离 MySQL/MariaDB 实例，以及可创建／删除唯一测试库的已有临时账号；无需新容器或扩张业务权限。

实库建议：隔离表含可靠 BIGINT 主键、可空及不可空 BLOB、BINARY/VARBINARY、PNG/JPEG/WebP 字节、无效 UTF-8、空值与超限值。先查看与暂存，独立观察连接确认零写；集中预览后提交一次，逐字节比较 HEX、保留精确主键；制造并发旧值变化，确认整批回滚；再验证只读表、任意 SQL 结果与陈旧连接。

本轮仅支持已经完整读取的 MySQL/MariaDB 二进制值。Web/BFile 属于其它驱动能力，尚未支持；不能因此宣称整个 D07 完成。GIF／动画、文件导入导出、文本编码写回、大对象流式编辑也不在本切片范围。

真实相机的 EXIF 旋转 JPEG、大量 ICC 元数据及各厂商编码变体尚未验收；实际解码尺寸与头尺寸不符时当前选择明确拒绝，不放宽像素预算。

## 公共文件

`TableTab.tsx` 仅增加二进制编辑分流和非空二进制清空类型保持；`RecordValueEditor.tsx` 接入专用查看器；`RecordFormPanel.tsx` 加完整值只读回退及二进制快照门；`ResultsGrid.tsx` 增加只读入口。新增独立核心、组件、中文文案、样式与测试。未修改主进程、IPC、统一存储、功能覆盖表、版本和发布策略。
