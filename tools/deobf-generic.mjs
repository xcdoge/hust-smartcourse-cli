// 通用 obfuscator.io 字符串表还原（字符串感知的括号匹配 + 自动旋转）
// 用法: node probe/deobf-generic.mjs <in.js> [out.js]
import fs from 'node:fs';

const inFile = process.argv[2];
const outFile = process.argv[3] || inFile.replace(/\.js$/, '.deobf.js');
const src = fs.readFileSync(inFile, 'utf8');

// ---- 字符串感知的括号匹配 ----
function matchBracket(text, startIdx, open = '{', close = '}') {
  let depth = 0;
  let i = startIdx;
  while (i < text.length) {
    const c = text[i];
    if (c === '"' || c === "'" || c === '`') {
      const q = c;
      i++;
      while (i < text.length) {
        if (text[i] === '\\') {
          i += 2;
          continue;
        }
        if (text[i] === q) {
          i++;
          break;
        }
        i++;
      }
      continue;
    }
    if (c === '/' && text[i + 1] === '/') {
      while (i < text.length && text[i] !== '\n') i++;
      continue;
    }
    if (c === '/' && text[i + 1] === '*') {
      i += 2;
      while (i < text.length && !(text[i] === '*' && text[i + 1] === '/')) i++;
      i += 2;
      continue;
    }
    if (c === open) depth++;
    else if (c === close) {
      depth--;
      if (depth === 0) return i;
    }
    i++;
  }
  return -1;
}

// ---- 1) 数组函数 ----
const arrRe = /function (_0x[0-9a-f]+)\(\)\s*\{\s*var _0x[0-9a-f]+=\[/i;
const am = src.match(arrRe);
if (!am) throw new Error('没找到字符串数组函数');
const arrName = am[1];
const braceStart = src.indexOf('{', am.index);
const braceEnd = matchBracket(src, braceStart);
const arrFnSrc = src.slice(am.index, braceEnd + 1);
const base = new Function(arrFnSrc + `; return ${arrName}();`)();
console.log('数组函数:', arrName, '长度:', base.length);

// ---- 2) 访问器 + 偏移 ----
// 文件开头就是 var _0xNNN=_0xACC; 拿这个 acc 名
const headM = src.match(/^\s*var (_0x[0-9a-f]+)=(_0x[0-9a-f]+);/i);
const accName = headM ? headM[2] : null;
if (!accName) throw new Error('没找到访问器别名');
const accDecl = src.indexOf('function ' + accName + '(');
if (accDecl < 0) throw new Error('没找到访问器函数体');
const accEnd = matchBracket(src, src.indexOf('{', accDecl));
const accBody = src.slice(accDecl, accEnd + 1);
const offM = accBody.match(/-\s*(0x[0-9a-f]+)/i);
if (!offM) throw new Error('访问器里没有偏移量');
const OFF = parseInt(offM[1], 16);
console.log('访问器:', accName, '偏移量:', OFF);

// ---- 3) 旋转量：直接执行文件自带的旋转 IIFE（精确，不靠猜） ----
const arrFnObj = new Function(arrFnSrc + `; return ${arrName};`)();
const accFn = new Function('arrFn', `return function(i){ return arrFn()[i - ${OFF}]; };`)(arrFnObj);

const iifeIdx = src.indexOf('(function(', headM[0].length);
let rotatedFromIife = null;
if (!process.env.ROT) try {
  const endM = src.slice(iifeIdx).match(new RegExp(`\\}\\(${arrName}\\s*,\\s*0x[0-9a-f]+\\)`, 'i'));
  if (endM) {
    const endPos = iifeIdx + endM.index + endM[0].length;
    const iifeSrc = src.slice(iifeIdx + 1, endPos); // 去掉最外层 ()
    // eslint-disable-next-line no-new-func
    new Function(arrName, accName, headM[1], `return ${iifeSrc}`)(arrFnObj, accFn, accFn);
    rotatedFromIife = arrFnObj().slice();
    console.log('旋转 IIFE 执行成功');
  } else {
    console.log('没找到 IIFE 结尾');
  }
} catch (e) {
  console.log('旋转 IIFE 执行失败:', e.message);
}

const score = (arr) => {
  let s = 0;
  for (const v of arr) {
    if (typeof v !== 'string') continue;
    if (/^[a-z][a-zA-Z0-9]*$/.test(v)) s += 3;
    if (v === 'indexOf' || v === 'userAgent' || v === 'prototype' || v === 'apply' || v === 'length') s += 25;
  }
  return s;
};

let rotated = process.env.ROT ? (()=>{const w=base.slice();for(let i=0;i<Number(process.env.ROT);i++)w.push(w.shift());return w;})() : rotatedFromIife;
if (rotated) { console.log("使用旋转:", process.env.ROT || "iife");
  console.log('IIFE 旋转后得分:', score(rotated));
} else {
  const work = base.slice();
  let best = { shift: 0, score: -1e9, arr: null };
  for (let r = 0; r < work.length; r++) {
    const sc = score(work);
    if (sc > best.score) best = { shift: r, score: sc, arr: work.slice() };
    work.push(work.shift());
  }
  console.log('兜底旋转量:', best.shift, '得分:', best.score);
  rotated = best.arr;
}
const decode = (i) => rotated[i - OFF];

// ---- 4) 还原 ----
let n = 0;
const out = src.replace(/([_$a-zA-Z][_$a-zA-Z0-9]*)\(\s*(0x[0-9a-f]+)\s*\)/g, (all, fn, hex) => {
  const idx = parseInt(hex, 16);
  if (idx < OFF) return all;
  const v = decode(idx);
  if (typeof v !== 'string') return all;
  n++;
  return JSON.stringify(v);
});
fs.writeFileSync(outFile, out);
console.log('还原引用:', n, '->', outFile, out.length, 'bytes');
