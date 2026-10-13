import { readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

// 渲染器固定版本、独立安装，避免为打包资产给应用引入运行时依赖。
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const requireTool = createRequire(path.join(root, '.tools', 'icons', 'package.json'));
let Resvg;
try {
  ({ Resvg } = requireTool('@resvg/resvg-js'));
  const version = requireTool('@resvg/resvg-js/package.json').version;
  if (version !== '2.6.2') throw new Error(`当前渲染器版本为 ${version}，需要 2.6.2`);
} catch (error) {
  console.error('请先执行：npm install --prefix .tools/icons @resvg/resvg-js@2.6.2 --save-exact --no-audit --no-fund');
  throw error;
}

const directory = path.join(root, 'build');
const source = await readFile(path.join(directory, 'icon.svg'));
const pngs = new Map();

/** 每种尺寸直接从 SVG 光栅化，保留透明边距，避免重复缩放造成模糊。 */
function render(size) {
  if (!pngs.has(size)) {
    const renderer = new Resvg(source, {
      fitTo: { mode: 'width', value: size },
      font: { loadSystemFonts: false },
    });
    pngs.set(size, Buffer.from(renderer.render().asPng()));
  }
  return pngs.get(size);
}

/** ICO 使用标准目录和 PNG 图像载荷；256 像素在目录宽高中以 0 表示。 */
function createIco(sizes) {
  const header = Buffer.alloc(6 + sizes.length * 16);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(sizes.length, 4);
  let offset = header.length;
  const images = sizes.map((size, index) => {
    const png = render(size);
    const entry = 6 + index * 16;
    header.writeUInt8(size === 256 ? 0 : size, entry);
    header.writeUInt8(size === 256 ? 0 : size, entry + 1);
    header.writeUInt16LE(1, entry + 4);
    header.writeUInt16LE(32, entry + 6);
    header.writeUInt32LE(png.length, entry + 8);
    header.writeUInt32LE(offset, entry + 12);
    offset += png.length;
    return png;
  });
  return Buffer.concat([header, ...images]);
}

/** ICNS 使用现代 macOS 支持的 PNG 条目，同时提供普通与 Retina 表示。 */
function createIcns() {
  const representations = [
    ['icp4', 16], ['icp5', 32], ['icp6', 64],
    ['ic07', 128], ['ic08', 256], ['ic09', 512], ['ic10', 1024],
    ['ic11', 32], ['ic12', 64], ['ic13', 256], ['ic14', 512],
  ];
  const chunks = representations.map(([type, size]) => {
    const png = render(size);
    const header = Buffer.alloc(8);
    header.write(type, 0, 4, 'ascii');
    header.writeUInt32BE(8 + png.length, 4);
    return Buffer.concat([header, png]);
  });
  const header = Buffer.alloc(8);
  header.write('icns', 0, 4, 'ascii');
  header.writeUInt32BE(8 + chunks.reduce((sum, chunk) => sum + chunk.length, 0), 4);
  return Buffer.concat([header, ...chunks]);
}

// 顺序写入三个目标；输入与渲染器不变时，输出字节保持一致。
await writeFile(path.join(directory, 'icon.png'), render(1024));
await writeFile(path.join(directory, 'icon.ico'), createIco([16, 24, 32, 48, 64, 128, 256]));
await writeFile(path.join(directory, 'icon.icns'), createIcns());
console.log('已生成 build/icon.png（1024）、icon.ico（16–256）和 icon.icns（16–1024，含 Retina）。');
