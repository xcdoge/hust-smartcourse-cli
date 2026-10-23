// 凭据本地加密存储（AES-256-GCM + scrypt 派生密钥）
//
// 设计取舍：
//   - 密钥由「机器指纹（主机名 + 用户名）+ 盐」派生，文件换台机器/换个用户就解不开
//   - 可选 HUST_CLI_KEY 环境变量再叠一层口令（不设也能用）
//   - 这不是"防得住有权限的攻击者"，而是防住"文件被顺手拷走/同步到网盘被别人打开"
//
//   state/cred.enc.json  加密凭据（推荐）
//   state/cred.txt       旧版明文，仍兼容读取；用 cred save 后建议删掉
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { STATE, stateFile} from './const.mjs';

const ENC_FILE = stateFile('cred.enc.json');
const TXT_FILE = stateFile('cred.txt');
const VERSION = 1;

function mask(s) {
  if (!s) return '';
  return s.length <= 4 ? s[0] + '***' : s.slice(0, 4) + '***';
}

/** 机器指纹：换机器 / 换用户即失效 */
function machineMaterial() {
  const host = os.hostname();
  const user = (os.userInfo().username || '').toLowerCase();
  const extra = process.env.HUST_CLI_KEY || '';
  return `${host}|${user}|${extra}`;
}

function deriveKey(salt) {
  return crypto.scryptSync(machineMaterial(), salt, 32, { N: 16384, r: 8, p: 1 });
}

/** 加密保存账号密码 */
export function saveCreds(username, password) {
  fs.mkdirSync(STATE, { recursive: true });
  const salt = crypto.randomBytes(16);
  const iv = crypto.randomBytes(12);
  const key = deriveKey(salt);
  const payload = JSON.stringify({ u: username, p: password, t: Date.now() });
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const ct = Buffer.concat([cipher.update(payload, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  const out = {
    v: VERSION,
    alg: 'aes-256-gcm',
    kdf: 'scrypt',
    salt: salt.toString('base64'),
    iv: iv.toString('base64'),
    tag: tag.toString('base64'),
    data: ct.toString('base64'),
    // 仅用于提示，不参与解密
    savedAt: new Date().toISOString(),
    // 只存打码后的账号，避免不解密就能看出是谁
    user: mask(username),
  };
  fs.writeFileSync(ENC_FILE, JSON.stringify(out, null, 2), { mode: 0o600 });
  return ENC_FILE;
}

/** 读取加密凭据；返回 {username, password} 或 null */
export function loadEncrypted() {
  if (!fs.existsSync(ENC_FILE)) return null;
  let j;
  try {
    j = JSON.parse(fs.readFileSync(ENC_FILE, 'utf8'));
  } catch {
    return null;
  }
  try {
    const salt = Buffer.from(j.salt, 'base64');
    const iv = Buffer.from(j.iv, 'base64');
    const tag = Buffer.from(j.tag, 'base64');
    const key = deriveKey(salt);
    const d = crypto.createDecipheriv('aes-256-gcm', key, iv);
    d.setAuthTag(tag);
    const pt = Buffer.concat([d.update(Buffer.from(j.data, 'base64')), d.final()]).toString('utf8');
    const { u, p } = JSON.parse(pt);
    if (!u || !p) return null;
    return { username: u, password: p, source: 'enc' };
  } catch {
    return null; // 换机器/换用户/篡改 → 解不开
  }
}

/** 兼容旧版明文 cred.txt */
export function loadPlaintext() {
  if (!fs.existsSync(TXT_FILE)) return null;
  const [username, password] = fs
    .readFileSync(TXT_FILE, 'utf8')
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter(Boolean);
  if (!username || !password) return null;
  return { username, password, source: 'plain' };
}

/** 统一入口：优先加密文件，其次明文 */
export function loadCreds() {
  const enc = loadEncrypted();
  if (enc) return enc;
  const plain = loadPlaintext();
  if (plain) return plain;
  throw new Error('没有可用凭据。执行 node src/cred.mjs save <学号> <密码>，或在 state/cred.txt 写两行');
}

export function hasCreds() {
  return fs.existsSync(ENC_FILE) || fs.existsSync(TXT_FILE);
}

export function forget() {
  let removed = [];
  for (const f of [ENC_FILE, TXT_FILE]) {
    if (fs.existsSync(f)) {
      fs.rmSync(f);
      removed.push(path.basename(f));
    }
  }
  return removed;
}

/** 把明文迁移成加密文件，并删除明文 */
export function migratePlaintext() {
  const plain = loadPlaintext();
  if (!plain) return null;
  saveCreds(plain.username, plain.password);
  fs.rmSync(TXT_FILE);
  return ENC_FILE;
}

export const CRED_FILES = { ENC_FILE, TXT_FILE };
