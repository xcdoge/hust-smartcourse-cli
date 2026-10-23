// 退出登录
//   node src/logout.mjs          只清登录态（cookie），保留加密凭据
//   node src/logout.mjs --all    连凭据一起清掉
import fs from 'node:fs';
import path from 'node:path';
import { CookieJar, follow } from './lib/http.mjs';

// 不 import const.mjs —— 退出登录不应该依赖课程配置存在
const ROOT = path.resolve(import.meta.dirname, '..');
const STATE = path.join(ROOT, 'state');
const COOKIES = path.join(STATE, 'cookies.json');

const all = process.argv.includes('--all') || process.argv.includes('-a');
const CAS = 'https://pass.hust.edu.cn/cas';

function remove(p) {
  if (!fs.existsSync(p)) return false;
  try {
    fs.rmSync(p);
    return true;
  } catch {
    return false;
  }
}

// ① 有会话就通知 CAS 注销（失败不影响本地清理）
try {
  const jar = new CookieJar();
  jar.load(JSON.parse(fs.readFileSync(COOKIES, 'utf8')));
  if (jar.toJSON && Object.keys(jar.toJSON()).length > 0) {
    const r = await follow(`${CAS}/logout`, jar);
    console.log(`已通知 CAS 注销（HTTP ${r.res.status}）`);
  }
} catch {
  // 没有 cookie 文件就跳过
}

// ② 删除本地登录态
const removed = [];
for (const [name, p] of [
  ['cookies.json', COOKIES],
  ['visitor.json', `${STATE}/visitor.json`],
]) {
  if (remove(p)) removed.push(name);
}

// ③ --all 连凭据一起清
if (all) {
  for (const [name, p] of [
    ['cred.enc.json', `${STATE}/cred.enc.json`],
    ['cred.txt', `${STATE}/cred.txt`],
  ]) {
    if (remove(p)) removed.push(name);
  }
}

if (removed.length === 0) {
  console.log('— 本来就没有登录态');
} else {
  console.log(`✔ 已退出登录，删除: ${removed.join(', ')}`);
  if (!all) console.log('  （加密凭据仍保留，下次直接 node src/login-pw.mjs；要一并清除用 --all）');
}
