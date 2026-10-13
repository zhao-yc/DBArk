# DBArk 应用图标

`icon.svg` 是唯一矢量源。图形沿用 `src/renderer/App.tsx` 的自主品牌路径，增加深色圆角底和透明外边距；未使用 Navicat 或第三方品牌素材。资产与项目一同采用 MIT 许可证。

## 重新生成

在项目根目录执行（Node.js 20 及以上）：

```sh
npm install --prefix .tools/icons @resvg/resvg-js@2.6.2 --save-exact --no-audit --no-fund
node scripts/generate-icons.mjs
```

工具独立安装在被忽略的 `.tools/icons`，不会修改应用的依赖。脚本直接读取 SVG，使用固定版本的 resvg 渲染每种尺寸，再封装平台格式。目录中已提供生成后的资产；正常应用构建不需要重新安装此工具。

| 文件 | 内容 | 用途 |
| --- | --- | --- |
| `icon.svg` | 1024 × 1024 矢量画布 | 可编辑设计源 |
| `icon.png` | 1024 × 1024 RGBA | 窗口及通用位图 |
| `icon.ico` | 16、24、32、48、64、128、256 像素，32 位色 | Windows 应用与安装包 |
| `icon.icns` | 16、32、64、128、256、512、1024 像素；含 Retina 表示 | macOS 应用与安装包 |

配色来自应用：薄荷绿 `#6BD3AE`，背景从 `#202D32` 渐变至 `#10181D`。图标包含透明通道，勿预先铺白底。

ICO 与 ICNS 的图像条目使用 PNG 编码；目标为项目支持的现代 Windows/macOS。生成后已通过 Pillow 独立解码所有条目、尺寸和透明通道，并检查大图及小尺寸预览；macOS Finder/Dock 的实际展示仍需在 macOS 安装包验收时确认。
