// 定点爆破：只解出日志 URL 数组里用到的那批索引，用「多个参数都以 & 开头」做一致性判据
import fs from 'node:fs';

const src = fs.readFileSync('probe/out/videojs-ext.min.js', 'utf8');
function matchBracket(text, startIdx, open = '{', close = '}') {
  let depth = 0;
  let i = startIdx;
  while (i < text.length) {
    const c = text[i];
    if (c === '"' || c === "'" || c === '`') {
      const q = c;
      i++;
      while (i < text.length) {
        if (text[i] === '\\') { i += 2; continue; }
        if (text[i] === q) { i++; break; }
        i++;
      }
      continue;
    }
    if (c === open) depth++;
    else if (c === close) { depth--; if (depth === 0) return i; }
    i++;
  }
  return -1;
}

const am = src.match(/function (_0x[0-9a-f]+)\(\)\s*\{\s*var _0x[0-9a-f]+=\[/i);
const arrName = am[1];
const arrFnSrc = src.slice(am.index, matchBracket(src, src.indexOf('{', am.index)) + 1);
const base = new Function(arrFnSrc + `; return ${arrName}();`)();
const OFF = 0x123;

// 这段日志 URL 数组里用到的静态字符串索引
const idxs = [0x3e7, 0x25d, 0x41c, 0x50d, 0x3fd, 0x508, 0x480, 0x270, 0x37c, 0x237, 0x538, 0x203, 0x467];
// 另外还有 obj[..] 的键名，可能包含 base 路径
const keyIdxs = [0x25b, 0x252, 0x541, 0x2bd, 0x507, 0x2d9, 0x14d, 0x2fb, 0x370, 0x190];

const work = base.slice();
let found = 0;
for (let r = 0; r < work.length && found < 3; r++) {
  const d = (i) => work[i - OFF];
  const a = d(0x25d), b = d(0x41c), c = d(0x50d);
  if (typeof a === 'string' && a.startsWith('&') && typeof b === 'string' && b.startsWith('&') && typeof c === 'string' && c.startsWith('&')) {
    found++;
    console.log('=== 旋转量', r, '===');
    console.log('静态片段:', idxs.map((i) => `${i.toString(16)}=${JSON.stringify(d(i))}`).join(' '));
    console.log('键名:', keyIdxs.map((i) => `${i.toString(16)}=${JSON.stringify(d(i))}`).join(' '));
  }
  work.push(work.shift());
}
if (!found) console.log('没找到一致旋转量');
