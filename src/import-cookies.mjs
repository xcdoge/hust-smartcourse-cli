// 备用登录通道：从浏览器直接导入 cookie
//   node src/import-cookies.mjs            读取 state/cookie.txt（纯文本 Cookie 头或 JSON）
//   node src/import-cookies.mjs --check    校验 state/cookies.json 是否仍有效
import fs from 'node:fs';
import path from 'node:path';
import { CookieJar } from './lib/http.mjs';
import { verify } from './lib/verify.mjs';
import { stateFile } from './lib/const.mjs';

const ROOT = path.resolve(import.meta.dirname, '..');
const STATE = path.join(ROOT, 'state');
const SRC_CANDIDATES = [stateFile('cookie.txt'), stateFile('cookies.txt')];
// 取最近修改的那一份（两个文件名历史上都用过，避免读到旧快照）
const existing = SRC_CANDIDATES.filter((p) => fs.existsSync(p));
existing.sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);
const SRC = existing[0] || SRC_CANDIDATES[0];
const DEST = stateFile('cookies.json');

function parse(raw) {
  const t = raw.trim();
  if (!t) throw new Error('cookie.txt 是空的');

  // 0) DevTools「Copy as cURL」：整条命令里抠 -H/--header 'cookie: ...'
  if (/^\s*(curl|curl\.exe)\b/i.test(t) || /--header\s+['"]?cookie:/i.test(t)) {
    const m =
      t.match(/-H\s+['"]cookie:\s*([^'"]+)['"]/i) ||
      t.match(/--header\s+['"]cookie:\s*([^'"]+)['"]/i) ||
      t.match(/-H\s+['"]Cookie:\s*([^'"]+)['"]/i);
    if (!m) throw new Error('这段 cURL 里没找到 cookie 头');
    return parseKV(m[1]);
  }

  // 1) JSON: {"host":{"k":"v"}} 或 {"k":"v"}
  if (t.startsWith('{')) {
    const o = JSON.parse(t);
    if (o['smartcourse.hust.edu.cn'] || o['pass.hust.edu.cn'] || o['chaoxing.com']) return o;
    return { 'smartcourse.hust.edu.cn': Object.fromEntries(Object.entries(o).map(([k, v]) => [k, String(v)])) };
  }

  // 2) 纯文本
  return parseKV(t);
}

function parseKV(rawText) {
  let s = rawText
    .trim()
    .replace(/^["'`]+|["'`]+$/g, '')
    .replace(/^cookie\s*:\s*/i, '')
    .replace(/\r/g, '\n');

  // 2a) DevTools「应用 -> Cookies」表格复制出来的 TSV：name<TAB>value<TAB>domain...
  if (/\t/.test(s)) {
    const kv = {};
    for (const line of s.split('\n')) {
      const f = line.split('\t').map((x) => x.trim());
      if (f.length >= 2 && f[0] && f[1] !== undefined && !/\s/.test(f[0])) kv[f[0]] = f[1];
      else if (f.length === 1 && f[0].includes('=')) {
        const i = f[0].indexOf('=');
        kv[f[0].slice(0, i).trim()] = f[0].slice(i + 1).trim();
      }
    }
    if (Object.keys(kv).length === 0) throw new Error('TSV 里没解析出 cookie');
    return { 'smartcourse.hust.edu.cn': kv };
  }

  const kv = {};
  for (const part of s.split(/[;\n]+/)) {
    const p = part.trim();
    if (!p) continue;
    const i = p.indexOf('=');
    if (i <= 0) continue;
    const k = p.slice(0, i).trim();
    const v = p.slice(i + 1).trim();
    if (!k || /\s/.test(k)) continue;
    kv[k] = v;
  }
  if (Object.keys(kv).length === 0) throw new Error('没能解析出任何 name=value');
  return { 'smartcourse.hust.edu.cn': kv };
}

if (process.argv.includes('--check')) {
  const jar = new CookieJar();
  jar.load(JSON.parse(fs.readFileSync(DEST, 'utf8')));
  const r = await verify(jar);
  console.log(r.ok ? 'SESSION_OK' : 'SESSION_EXPIRED ' + r.status + ' ' + r.url.slice(0, 120));
} else {
  const obj = parse(fs.readFileSync(SRC, 'utf8'));
  const jar = new CookieJar();
  jar.load(obj);
  const names = Object.values(obj).flatMap((m) => Object.keys(m));
  console.log('来源:', SRC);
  console.log('导入 cookie:', names.length, '个 ->', names.join(', '));
  fs.writeFileSync(DEST, JSON.stringify(jar.toJSON(), null, 2));
  const r = await verify(jar);
  console.log(
    r.ok
      ? `SESSION_OK 已写入 state/cookies.json（课程页 ${r.len} 字节）`
      : `SESSION_EXPIRED status=${r.status} url=${r.url.slice(0, 160)}`
  );
}
