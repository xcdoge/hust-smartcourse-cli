// 账密登录（全自动）：CAS 不带 service 登录 → 拿会话 → 单独换超星 ticket
//
// 验证码用自带 OCR（src/lib/captcha.mjs，模型 data/captcha-model.json）；
// 识别不准或服务端判错时自动换一张重试。
//
//   node src/login-pw.mjs            # 全自动（默认）
//   node src/login-pw.mjs --manual   # 只取验证码，人工看后自己 --code=
//   node src/login-pw.mjs --code=1234
import fs from 'node:fs';
import crypto from 'node:crypto';
import { CookieJar, httpGet, follow } from './lib/http.mjs';
import { STATE, COOKIES, SMART_ORIGIN, COURSE_ID, CLAZZ_ID } from './lib/const.mjs';
import { recognize } from './lib/captcha.mjs';
import { loadCreds, saveCreds } from './lib/secret.mjs';

import { maybeHelp } from './lib/help.mjs';
maybeHelp('login-pw');

const CAS = 'https://pass.hust.edu.cn/cas';
const SERVICE = 'http://smartcourse.hust.edu.cn/fyportal-smartcourse/sso/hust';
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36';
const MAX_ATTEMPTS = 4;
const MIN_CONF = 0.05;

const argv = process.argv.slice(2);
const manual = argv.includes('--manual');
const codeArg = (argv.find((a) => a.startsWith('--code=')) || '').split('=')[1] || '';
const wantSave = argv.includes('--save');

function rsaEncrypt(b64Key, text) {
  const key = crypto.createPublicKey({ key: Buffer.from(b64Key, 'base64'), format: 'der', type: 'spki' });
  return crypto
    .publicEncrypt({ key, padding: crypto.constants.RSA_PKCS1_PADDING }, Buffer.from(text, 'utf8'))
    .toString('base64');
}

const UA_JSON = JSON.stringify({
  ua: UA,
  browser: { name: 'Chrome', version: '135.0.0.0', major: '135' },
  cpu: { architecture: 'amd64' },
  device: {},
  engine: { name: 'Blink', version: '135.0.0.0' },
  os: { name: 'Windows', version: '10' },
});

// 凭据来自 src/lib/secret.mjs：优先加密文件，其次旧版明文 cred.txt

function visitorId() {
  const f = `${STATE}/visitor.json`;
  try {
    const v = JSON.parse(fs.readFileSync(f, 'utf8')).visitorId;
    if (v) return v;
  } catch {}
  const v = crypto.randomBytes(16).toString('hex');
  fs.writeFileSync(f, JSON.stringify({ visitorId: v }, null, 2));
  return v;
}

async function freshCaptcha() {
  const jar = new CookieJar();
  const lp = await follow(`${CAS}/login`, jar);
  const html = await lp.res.text();
  const lt = (html.match(/name="lt"\s+value="([^"]*)"/) || [])[1] || '';
  const execution = (html.match(/name="execution"\s+value="([^"]*)"/) || [])[1] || '';
  const cap = await httpGet(`${CAS}/code`, jar);
  const buf = Buffer.from(await cap.arrayBuffer());
  const ext = buf.slice(0, 3).toString('ascii') === 'GIF' ? 'gif' : 'png';
  fs.writeFileSync(`${STATE}/login-captcha.${ext}`, buf);
  return { jar, lt, execution, captcha: buf };
}

async function submit(jar, lt, execution, code) {
  const { username, password } = loadCreds();
  const rk = await httpGet(`${CAS}/rsa`, jar, { method: 'POST' });
  const publicKey = JSON.parse(await rk.text()).publicKey;

  const form = new URLSearchParams();
  form.set('ua', UA_JSON);
  form.set('visitorId', visitorId());
  form.set('rsa', '');
  form.set('ul', rsaEncrypt(publicKey, username));
  form.set('pl', rsaEncrypt(publicKey, password));
  form.set('code', code);
  form.set('phoneCode', '');
  form.set('lt', lt);
  form.set('execution', execution);
  form.set('_eventId', 'submit');

  const res = await httpGet(`${CAS}/login`, jar, {
    method: 'POST',
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      origin: 'https://pass.hust.edu.cn',
      referer: `${CAS}/login`,
      accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    },
    body: form.toString(),
  });
  const loc = res.headers.get('location') || '';
  if (res.status >= 300 && res.status < 400) {
    const lr = await follow(loc.startsWith('http') ? loc : `https://pass.hust.edu.cn${loc}`, jar);
    return { ok: /one\.hust\.edu\.cn/.test(lr.url) || /one\.hust\.edu\.cn/.test(loc), msg: 'redirect' };
  }
  const body = await res.text();
  const err = (body.match(/id="errormsghide">([^<]*)</) || [])[1] || '';
  if (/id="phoneCode"/.test(body)) return { ok: false, msg: '需要企业微信验证码(2FA)' };
  return { ok: false, msg: err || '未知错误' };
}

async function verifySite(jar) {
  const site = await follow(
    `${SMART_ORIGIN}/mooc-smartcourse/mooc2-ans/mycourse/studentcourse?courseid=${COURSE_ID}&clazzid=${CLAZZ_ID}`,
    jar,
  );
  const html = await site.res.text();
  return { chapters: (html.match(/toOld\(/g) || []).length, len: html.length };
}

function exchange(jar) {
  return follow(`${CAS}/login?service=${encodeURIComponent(SERVICE)}`, jar);
}

// ---------- 手工模式 ----------
if (manual) {
  const { jar, lt, execution } = await freshCaptcha();
  fs.writeFileSync(`${STATE}/login-pending.json`, JSON.stringify({ lt, execution, jar: jar.toJSON() }, null, 2));
  console.log(`验证码已存 state/login-captcha.gif | lt=${lt.slice(0, 14)}…`);
  process.exit(0);
}
if (codeArg) {
  const pending = JSON.parse(fs.readFileSync(`${STATE}/login-pending.json`, 'utf8'));
  const jar = new CookieJar();
  jar.load(pending.jar);
  const r = await submit(jar, pending.lt, pending.execution, codeArg);
  console.log('提交:', r.ok ? '成功' : '' + r.msg);
  if (!r.ok) process.exit(2);
  const sso = await exchange(jar);
  const site = await verifySite(jar);
  fs.writeFileSync(COOKIES, JSON.stringify(jar.toJSON(), null, 2));
  console.log(`换票: ${sso.res.status} | 章节 ${site.chapters} | cookie 已写`);
  process.exit(site.chapters > 0 ? 0 : 3);
}

// ---------- 全自动 ----------
for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
  const { jar, lt, execution, captcha } = await freshCaptcha();
  let code = '';
  let conf = 0;
  try {
    const r = recognize(captcha);
    code = r.code;
    conf = r.conf;
    console.log(`第 ${attempt} 次 | 识别 ${code || '(空)'} conf=${conf} 位数=${r.count}`);
  } catch (e) {
    console.log(`第 ${attempt} 次 | 识别失败: ${String(e).slice(0, 60)}`);
    continue;
  }
  if (code.length !== 4 || conf < MIN_CONF) {
    console.log('   置信度/位数不足，换一张');
    continue;
  }
  const res = await submit(jar, lt, execution, code);
  if (!res.ok) {
    console.log('   服务端拒绝:', res.msg);
    if (/2FA/.test(res.msg)) break;
    continue;
  }
  const sso = await exchange(jar);
  const site = await verifySite(jar);
  fs.writeFileSync(COOKIES, JSON.stringify(jar.toJSON(), null, 2));
  if (site.chapters > 0) {
    console.log(`登录成功，cookie 已写入 ${COOKIES}`);
  } else {
    console.log(`登录成功，cookie 已写入 ${COOKIES}`);
    console.log('课程未配置，先执行: node src/init.mjs "<课程链接>"');
  }
  if (wantSave) {
    const c = loadCreds();
    const f = saveCreds(c.username, c.password);
    console.log(`凭据已加密保存到 ${f}`);
  }
  process.exit(site.chapters > 0 ? 0 : 3);
}

console.log('多次尝试未成功');
process.exit(1);
