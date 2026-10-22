// 验证码识别：照 hust-cli 的思路（帧交集去噪 + 切格 + 模板匹配），但用实测样本重建的模型
//
// 流程：GIF 多帧 → 取交集去噪 → 按列投影切 4 个数字块 → 各自裁紧居中补到 NxN
//       → 与模型里的样本做 1-NN（汉明距离）→ 输出代码 + 置信度
import fs from 'node:fs';
import path from 'node:path';
import { decodeGif, inkMask } from './gif.mjs';

const ROOT = path.resolve(import.meta.dirname, '..', '..');
// 模型放 data/（随仓库分发）；本地实验时回落到 state/
const MODEL_CANDIDATES = [
  path.join(ROOT, 'data', 'captcha-model.json'),
  path.join(ROOT, 'state', 'captcha-model.json'),
];
const MODEL_PATH = MODEL_CANDIDATES.find((p) => fs.existsSync(p)) || MODEL_CANDIDATES[0];
let cachedModel = null;

export function loadModel(path = MODEL_PATH) {
  if (cachedModel) return cachedModel;
  cachedModel = JSON.parse(fs.readFileSync(path, 'utf8'));
  return cachedModel;
}

/** 按列投影切成数字块 */
export function findBands({ width, height, mask }, { minw = 5, minInk = 2 } = {}) {
  const out = [];
  let start = -1;
  for (let x = 0; x <= width; x++) {
    let ink = 0;
    if (x < width) {
      for (let y = 0; y < height; y++) ink += mask[y * width + x];
    }
    const on = x < width && ink >= minInk;
    if (on && start < 0) start = x;
    else if (!on && start >= 0) {
      if (x - start >= minw) out.push([start, x]);
      start = -1;
    }
  }
  return out;
}

/** 裁紧包围盒 + 居中补到 NxN（不缩放，保证 Python / Node 两边一致） */
function cellBits({ width, height, mask }, x0, x1, N) {
  let y0 = Infinity;
  let y1 = -Infinity;
  for (let y = 0; y < height; y++) {
    for (let x = x0; x < x1; x++) {
      if (mask[y * width + x]) {
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
        break;
      }
    }
  }
  if (y0 === Infinity) return null;
  y1 += 1;
  const w = x1 - x0;
  const h = y1 - y0;
  const grid = new Uint8Array(N * N);
  const ox = ((N - w) / 2) | 0;
  const oy = ((N - h) / 2) | 0;
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      if (!mask[y * width + x]) continue;
      const gx = x - x0 + ox;
      const gy = y - y0 + oy;
      if (gx >= 0 && gx < N && gy >= 0 && gy < N) grid[gy * N + gx] = 1;
    }
  }
  return grid;
}

function hamming(a, b) {
  let d = 0;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) d++;
  return d;
}

/** 把 NxN 位图平移 (dx,dy)，越界部分丢弃 */
function shiftBits(bits, N, dx, dy) {
  if (!dx && !dy) return bits;
  const out = new Uint8Array(N * N);
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      if (!bits[y * N + x]) continue;
      const nx = x + dx;
      const ny = y + dy;
      if (nx >= 0 && nx < N && ny >= 0 && ny < N) out[ny * N + nx] = 1;
    }
  }
  return out;
}

const SHIFTS = [
  [0, 0],
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
];

/** 容差匹配：允许 ±1 像素平移，取最小汉明距离（实测把整图准确率从 84.7% 提到 91.5%） */
function bestDistance(bits, sample, N) {
  let best = Infinity;
  for (const [dx, dy] of SHIFTS) {
    const d = hamming(shiftBits(bits, N, dx, dy), sample);
    if (d < best) best = d;
  }
  return best;
}

/** 识别一张验证码图片（Buffer） */
export function recognize(buf, { model = loadModel(), maxFrames = 4 } = {}) {
  const gif = decodeGif(buf);
  const ink = inkMask(gif, maxFrames);
  const N = model.N || 24;
  const bands = findBands(ink);
  const digits = [];
  for (const [x0, x1] of bands) {
    const bits = cellBits(ink, x0, x1, N);
    if (!bits) continue;
    // 1-NN（含 ±1 平移容差）
    const scored = model.samples
      .map(([ch, ft]) => ({ ch, d: bestDistance(bits, ft, N) }))
      .sort((a, b) => a.d - b.d);
    const top1 = scored[0];
    const top2 = scored.find((s) => s.ch !== top1.ch) || { d: top1.d + 1 };
    const conf = top2.d > 0 ? (top2.d - top1.d) / top2.d : 0;
    digits.push({ ch: top1.ch, d: top1.d, conf: Number(conf.toFixed(3)) });
  }
  const code = digits.map((d) => d.ch).join('');
  const conf = digits.length ? Math.min(...digits.map((d) => d.conf)) : 0;
  return { code, conf, count: digits.length, digits, bands };
}
