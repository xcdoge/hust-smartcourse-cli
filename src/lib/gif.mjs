// 极简 GIF 解码器：只做验证码识别需要的部分
// 输出每帧的合成像素（RGB）与暗色墨迹掩码
//
// 支持：GIF87a/89a、全局/局部调色板、透明索引、disposal 0/1/2、多帧

function readSubBlocks(buf, pos) {
  const chunks = [];
  while (pos < buf.length) {
    const len = buf[pos++];
    if (len === 0) break;
    chunks.push(buf.subarray(pos, pos + len));
    pos += len;
  }
  return { data: Buffer.concat(chunks.map((c) => Buffer.from(c))), pos };
}

function lzwDecode(minCodeSize, data, pixelCount) {
  const out = new Uint8Array(pixelCount);
  const clearCode = 1 << minCodeSize;
  const endCode = clearCode + 1;
  let codeSize = minCodeSize + 1;
  let next = endCode + 1;
  let dict = [];
  const resetDict = () => {
    dict = new Array(4096);
    for (let i = 0; i < clearCode; i++) dict[i] = [i];
    next = endCode + 1;
    codeSize = minCodeSize + 1;
  };
  resetDict();

  let bitPos = 0;
  let prev = null;
  let o = 0;
  const readCode = () => {
    let code = 0;
    for (let i = 0; i < codeSize; i++) {
      const byte = data[(bitPos >> 3) | 0];
      if (byte === undefined) return -1;
      const bit = (byte >> (bitPos & 7)) & 1;
      code |= bit << i;
      bitPos++;
    }
    return code;
  };

  while (o < pixelCount) {
    const code = readCode();
    if (code < 0 || code === endCode) break;
    if (code === clearCode) {
      resetDict();
      prev = null;
      continue;
    }
    let entry;
    if (code < next && dict[code]) entry = dict[code];
    else if (prev) entry = [...prev, prev[0]];
    else break;
    for (const v of entry) {
      if (o < pixelCount) out[o++] = v;
    }
    if (prev) {
      dict[next++] = [...prev, entry[0]];
      if (next === (1 << codeSize) && codeSize < 12) codeSize++;
    }
    prev = entry;
  }
  return out;
}

export function decodeGif(buf) {
  if (buf.toString('ascii', 0, 3) !== 'GIF') throw new Error('不是 GIF');
  const width = buf.readUInt16LE(6);
  const height = buf.readUInt16LE(8);
  const packed = buf[10];
  let pos = 13;
  let gct = null;
  if (packed & 0x80) {
    const n = 2 ** ((packed & 7) + 1);
    gct = buf.subarray(pos, pos + n * 3);
    pos += n * 3;
  }

  const frames = [];
  let gce = { transparent: -1, disposal: 0, delay: 0 };
  let canvas = new Uint8Array(width * height * 3).fill(255);

  while (pos < buf.length) {
    const marker = buf[pos++];
    if (marker === 0x3b) break; // trailer
    if (marker === 0x21) {
      const label = buf[pos++];
      if (label === 0xf9) {
        const size = buf[pos++];
        const p = buf[pos];
        gce = {
          disposal: (p >> 2) & 7,
          transparent: p & 1 ? buf[pos + 3] : -1,
          delay: buf.readUInt16LE(pos + 1),
        };
        pos += size;
        pos++; // block terminator
      } else {
        pos = readSubBlocks(buf, pos).pos;
      }
      continue;
    }
    if (marker === 0x2c) {
      const left = buf.readUInt16LE(pos);
      const top = buf.readUInt16LE(pos + 2);
      const w = buf.readUInt16LE(pos + 4);
      const h = buf.readUInt16LE(pos + 6);
      const ip = buf[pos + 8];
      pos += 9;
      let ct = gct;
      if (ip & 0x80) {
        const n = 2 ** ((ip & 7) + 1);
        ct = buf.subarray(pos, pos + n * 3);
        pos += n * 3;
      }
      const minCodeSize = buf[pos++];
      const { data, pos: np } = readSubBlocks(buf, pos);
      pos = np;
      const idx = lzwDecode(minCodeSize, data, w * h);

      const before = canvas.slice();
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const ci = idx[y * w + x];
          if (ci === gce.transparent) continue;
          const cx = left + x;
          const cy = top + y;
          if (cx >= width || cy >= height) continue;
          const o = (cy * width + cx) * 3;
          canvas[o] = ct ? ct[ci * 3] : ci;
          canvas[o + 1] = ct ? ct[ci * 3 + 1] : ci;
          canvas[o + 2] = ct ? ct[ci * 3 + 2] : ci;
        }
      }
      frames.push({ pixels: canvas.slice(), delay: gce.delay, disposal: gce.disposal });

      if (gce.disposal === 2) canvas = new Uint8Array(width * height * 3).fill(255);
      else if (gce.disposal === 3) canvas = before;
      gce = { transparent: -1, disposal: 0, delay: 0 };
      continue;
    }
    break; // 未知块，收工
  }
  return { width, height, frames };
}

/** 多帧取交集：同一像素在多帧里都暗才算墨迹 */
export function inkMask(gif, maxFrames = 4, threshold = 200) {
  const { width, height, frames } = gif;
  const n = Math.min(frames.length, maxFrames);
  const mask = new Uint8Array(width * height);
  for (let i = 0; i < width * height; i++) {
    let cnt = 0;
    for (let f = 0; f < n; f++) {
      const px = frames[f].pixels;
      const r = px[i * 3];
      const g = px[i * 3 + 1];
      const b = px[i * 3 + 2];
      if (r * 0.3 + g * 0.59 + b * 0.11 < threshold) cnt++;
    }
    mask[i] = cnt > 1 ? 1 : 0;
  }
  return { width, height, mask };
}
