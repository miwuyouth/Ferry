'use strict';
// 生成菜单栏模板图标、应用图标 PNG 与 macOS .icns。
// 自己编 PNG，省掉一个只用一次的图形依赖；边缘用超采样做抗锯齿。
// 跑一次即可：npm run icons（需要本机有 iconutil，即任意 macOS 都有）

const fs = require('fs');
const path = require('path');
const os = require('os');
const zlib = require('zlib');
const { execFileSync } = require('child_process');

const OUT = path.join(__dirname, '..', 'resources');
const SS = 4; // 超采样倍数：按 4x 分辨率画，再按 4x4 平均降采样出抗锯齿边缘

function crc32(buf) {
  let c, crc = 0xffffffff;
  for (let n = 0; n < buf.length; n++) {
    c = (crc ^ buf[n]) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = c ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

// px: Buffer，长度 w*h*4，RGBA
function encodePNG(w, h, px) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;   // 位深
  ihdr[9] = 6;   // 真彩 + alpha
  const raw = Buffer.alloc(h * (w * 4 + 1));
  for (let y = 0; y < h; y++) {
    raw[y * (w * 4 + 1)] = 0; // filter: none
    px.copy(raw, y * (w * 4 + 1) + 1, y * w * 4, (y + 1) * w * 4);
  }
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0))
  ]);
}

function canvas(w, h) {
  const px = Buffer.alloc(w * h * 4, 0);
  const set = (x, y, r, g, b, a = 255) => {
    x = Math.round(x); y = Math.round(y);
    if (x < 0 || y < 0 || x >= w || y >= h) return;
    const i = (y * w + x) * 4;
    px[i] = r; px[i + 1] = g; px[i + 2] = b; px[i + 3] = a;
  };
  const rect = (x, y, rw, rh, c) => {
    for (let j = 0; j < rh; j++) for (let i = 0; i < rw; i++) set(x + i, y + j, c[0], c[1], c[2], c[3] ?? 255);
  };
  // macOS 图标是「连续圆角」的方形（squircle），不是直角方块。
  // n 越大边越平直、拐角越急，4 接近系统图标的观感。
  const squircleRect = (x0, y0, rw, rh, radius, n, c) => {
    for (let y = Math.floor(y0); y < Math.ceil(y0 + rh); y++) {
      for (let x = Math.floor(x0); x < Math.ceil(x0 + rw); x++) {
        const lx = x - x0, ly = y - y0; // 本体内的局部坐标
        const cx = Math.min(Math.max(lx, radius), rw - radius);
        const cy = Math.min(Math.max(ly, radius), rh - radius);
        const dx = Math.abs(lx - cx), dy = Math.abs(ly - cy);
        if (dx === 0 && dy === 0) { set(x, y, c[0], c[1], c[2], c[3] ?? 255); continue; }
        if (Math.pow(dx / radius, n) + Math.pow(dy / radius, n) <= 1) set(x, y, c[0], c[1], c[2], c[3] ?? 255);
      }
    }
  };
  return { px, set, rect, squircleRect, w, h };
}

// 按 factor x factor 分块，用预乘 alpha 平均降采样 —— 让不透明色块之间、
// 色块与透明背景之间的边缘都出现平滑的过渡像素，而不是锯齿。
function downsample(src, factor) {
  const dstW = src.w / factor, dstH = src.h / factor;
  const dst = Buffer.alloc(dstW * dstH * 4);
  const n = factor * factor;
  for (let y = 0; y < dstH; y++) {
    for (let x = 0; x < dstW; x++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let j = 0; j < factor; j++) {
        for (let i = 0; i < factor; i++) {
          const sx = x * factor + i, sy = y * factor + j;
          const si = (sy * src.w + sx) * 4;
          const sa = src.px[si + 3];
          r += src.px[si] * sa;
          g += src.px[si + 1] * sa;
          b += src.px[si + 2] * sa;
          a += sa;
        }
      }
      const di = (y * dstW + x) * 4;
      if (a > 0) {
        dst[di] = Math.round(r / a);
        dst[di + 1] = Math.round(g / a);
        dst[di + 2] = Math.round(b / a);
        dst[di + 3] = Math.round(a / n);
      }
    }
  }
  return { px: dst, w: dstW, h: dstH };
}

// 菜单栏图标：双向箭头 ⇄ —— 隧道两头都在走数据。
// 模板图必须只有黑 + alpha，系统会按菜单栏明暗自动反色。
function drawTray(c, scale) {
  const K = [0, 0, 0, 255];
  const s = scale;
  const bar = Math.max(1, 1.5 * s);

  // 上：向右
  c.rect(3 * s, 5 * s - bar / 2, 9 * s, bar, K);
  for (let i = 0; i < 3 * s; i++) {
    c.rect(11 * s - i, 5 * s - i - bar / 2, bar, bar, K);
    c.rect(11 * s - i, 5 * s + i - bar / 2, bar, bar, K);
  }
  // 下：向左
  c.rect(4 * s, 10 * s - bar / 2, 9 * s, bar, K);
  for (let i = 0; i < 3 * s; i++) {
    c.rect(4 * s + i, 10 * s - i - bar / 2, bar, bar, K);
    c.rect(4 * s + i, 10 * s + i - bar / 2, bar, bar, K);
  }
}

function trayIcon(scale) {
  const w = 16 * scale, h = 16 * scale;
  const c = canvas(w * SS, h * SS);
  drawTray(c, scale * SS);
  const d = downsample(c, SS);
  return encodePNG(d.w, d.h, d.px);
}

// 应用图标：systemBlue 底 + 连续圆角（squircle）+ 白色双向箭头——
// 跟托盘图标、导航栏图标同一个语汇（隧道两端都在收发），扁平无边框。
//
// 形状不是拍脑袋定的：把系统自带图标（/System/Applications 里的 Calculator、Notes）
// 转成 1024 的 PNG，量它们的角部轮廓拟合出来的 —— 本体 814（画布的 79.5%，本体不
// 铺满画布，否则在 Dock 里比左右邻居大一圈），圆角半径 208（本体的 25.6%），
// 超椭圆指数 2.4。指数这项最容易画错：4 已经接近方角，系统图标其实很接近正圆。
const BODY = 814 / 1024;
const RADIUS = 0.256;  // 相对本体
const N = 2.4;

function drawAppIcon(c, size) {
  const ACC = [0, 122, 255, 255];
  const PAPER = [245, 245, 247, 255];

  const body = size * BODY;
  const inset = (size - body) / 2;
  c.squircleRect(inset, inset, body, body, body * RADIUS, N, ACC);

  // 箭头按本体（而不是整块画布）排版，并以本体中心为基准放大到本体的六成左右——
  // Dock 里邻居们的图形基本都占到这个比例，箭头再小就显得空。
  const GLYPH = 1.32;
  const u = (body / 64) * GLYPH;
  const mid = inset + body / 2;
  const bar = Math.max(2, 2.6 * u);
  const X = (n) => mid + (n - 32) * u;
  const Y = (n) => mid + (n - 32) * u;
  c.rect(X(18), Y(26), 26 * u, bar, PAPER);
  c.rect(X(20), Y(36), 26 * u, bar, PAPER);
  for (let i = 0; i < 8 * u; i++) {
    c.rect(X(44) - i, Y(26) - i, bar, bar, PAPER);
    c.rect(X(44) - i, Y(26) + i, bar, bar, PAPER);
    c.rect(X(20) + i, Y(36) - i, bar, bar, PAPER);
    c.rect(X(20) + i, Y(36) + i, bar, bar, PAPER);
  }
}

function appIcon(size) {
  const c = canvas(size * SS, size * SS);
  drawAppIcon(c, size * SS);
  const d = downsample(c, SS);
  return encodePNG(d.w, d.h, d.px);
}

fs.mkdirSync(OUT, { recursive: true });
fs.writeFileSync(path.join(OUT, 'trayTemplate.png'), trayIcon(1));
fs.writeFileSync(path.join(OUT, 'trayTemplate@2x.png'), trayIcon(2));
fs.writeFileSync(path.join(OUT, 'icon.png'), appIcon(1024));
console.log('wrote resources/trayTemplate.png, trayTemplate@2x.png, icon.png (1024)');

// macOS .icns：electron-builder 打包 dmg/app 时用得上。
// iconutil 只在 macOS 上有，非 mac 平台就跳过，留着已有的 icon.png 兜底
// （electron-builder 在拿到单张 1024 的 png 时也能自己转成 icns）。
if (process.platform === 'darwin') {
  const iconset = path.join(os.tmpdir(), 'Ferry.iconset');
  fs.rmSync(iconset, { recursive: true, force: true });
  fs.mkdirSync(iconset);
  const sizes = [
    ['icon_16x16.png', 16], ['icon_16x16@2x.png', 32],
    ['icon_32x32.png', 32], ['icon_32x32@2x.png', 64],
    ['icon_128x128.png', 128], ['icon_128x128@2x.png', 256],
    ['icon_256x256.png', 256], ['icon_256x256@2x.png', 512],
    ['icon_512x512.png', 512], ['icon_512x512@2x.png', 1024]
  ];
  for (const [name, size] of sizes) {
    fs.writeFileSync(path.join(iconset, name), appIcon(size));
  }
  const icnsPath = path.join(OUT, 'icon.icns');
  execFileSync('iconutil', ['-c', 'icns', iconset, '-o', icnsPath]);
  fs.rmSync(iconset, { recursive: true, force: true });
  console.log('wrote resources/icon.icns');
}
