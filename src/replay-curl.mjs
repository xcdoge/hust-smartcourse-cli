// 原样重放一段 DevTools 复制的 cURL（bash 版），用于对比「浏览器能过、我们过不去」的差异
//   node src/replay-curl.mjs [路径]   默认 state/req.curl.txt
import fs from 'node:fs';
import path from 'node:path';
import { STATE } from './lib/const.mjs';

const file = process.argv[2] || path.join(STATE, 'req.curl.txt');
if (!fs.existsSync(file)) {
  console.log(`没有找到 ${file}`);
  console.log('请把浏览器里「复制为 cURL (bash)」的整段内容粘进该文件');
  process.exit(2);
}
const raw = fs.readFileSync(file, 'utf8').replace(/\\\r?\n/g, ' ').trim();
console.log('读取', file, raw.length, '字节');

// --- 解析 bash cURL ---
function tokenize(s) {
  const out = [];
  let i = 0;
  while (i < s.length) {
    const c = s[i];
    if (/\s/.test(c)) {
      i++;
      continue;
    }
    if (c === "'" || c === '"') {
      const q = c;
      i++;
      let buf = '';
      while (i < s.length) {
        if (q === '"' && s[i] === '\\') {
          buf += s[i + 1];
          i += 2;
          continue;
        }
        if (s[i] === q) {
          i++;
          break;
        }
        buf += s[i++];
      }
      out.push(buf);
      continue;
    }
    if (c === '$' && s[i + 1] === "'") {
      i += 2;
      let buf = '';
      while (i < s.length && s[i] !== "'") {
        if (s[i] === '\\') {
          const n = s[i + 1];
          const map = { n: '\n', t: '\t', r: '\r', '\\': '\\', "'": "'", '"': '"' };
          buf += map[n] ?? n;
          i += 2;
          continue;
        }
        buf += s[i++];
      }
      i++;
      out.push(buf);
      continue;
    }
    let buf = '';
    while (i < s.length && !/\s/.test(s[i])) buf += s[i++];
    out.push(buf);
  }
  return out;
}

const toks = tokenize(raw);
const url = toks.find((t) => /^https?:\/\//i.test(t));
if (!url) {
  console.log('没解析出 URL');
  process.exit(2);
}
const headers = {};
let method = 'GET';
let body;
for (let i = 0; i < toks.length; i++) {
  const t = toks[i];
  if (t === '-H' || t === '--header') {
    const kv = toks[++i] || '';
    const idx = kv.indexOf(':');
    if (idx > 0) headers[kv.slice(0, idx).trim().toLowerCase()] = kv.slice(idx + 1).trim();
  } else if (t === '-X' || t === '--request') {
    method = (toks[++i] || 'GET').toUpperCase();
  } else if (t === '--data-raw' || t === '--data' || t === '-d') {
    body = toks[++i];
    if (method === 'GET') method = 'POST';
  } else if (t === '--compressed') {
    // 忽略
  } else if (t === '--url') {
    // url 已取
  }
}

// cookie 头里到底有哪些
const cookieHdr = headers['cookie'] || '';
const cookieNames = cookieHdr
  .split(';')
  .map((p) => p.split('=')[0].trim())
  .filter(Boolean);
console.log('方法:', method);
console.log('URL :', url.slice(0, 200));
console.log('Cookie 数量:', cookieNames.length, '->', cookieNames.join(', '));
console.log('其它头:', Object.keys(headers).filter((h) => h !== 'cookie').join(', '));

const u = new URL(url);
const h = { ...headers };
delete h['content-length'];
delete h.host;

const res = await fetch(url, { method, headers: h, body, redirect: 'manual' });
const text = await res.text().catch(() => '');
const loc = res.headers.get('location') || '';
console.log('\n--- 重放结果 ---');
console.log('status:', res.status);
console.log('location:', loc.slice(0, 200));
console.log('set-cookie:', (res.headers.getSetCookie?.() || []).map((c) => c.split(';')[0]).join(' | ').slice(0, 400));
console.log('body[0:300]:', text.replace(/\s+/g, ' ').slice(0, 300));
console.log('\n判定:', /logout/.test(loc) ? '✘ 被登出' : /pass\.hust|passport/.test(loc) ? '✘ 未登录' : res.status === 200 ? '✔ 通过' : '?');
