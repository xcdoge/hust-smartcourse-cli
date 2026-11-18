// 统一登录入口
//   node src/login.mjs            扫码（默认）
//   node src/login.mjs --qr       扫码
//   node src/login.mjs --pw       账号密码
//   node src/login.mjs --pw --manual [--code=NNNN]
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { maybeHelp } from './lib/help.mjs';

maybeHelp('login');

const args = process.argv.slice(2);
const pw = args.includes('--pw') || args.includes('-p') || args.includes('--password');
const qr = args.includes('--qr') || args.includes('-q');

if (pw && qr) {
  console.error('hsc: --pw 和 --qr 只能选一个');
  process.exit(1);
}

const script = pw ? 'login-pw.mjs' : 'login-qr.mjs';
const r = spawnSync(process.execPath, [path.join(import.meta.dirname, script), ...args], { stdio: 'inherit' });
process.exit(r.status ?? 0);
