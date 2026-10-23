// 登录：微信扫码（华中大微校园）走 CAS 的 qyQrLogin 轮询，不接触账号密码。
//   node src/login.mjs --qr      一步到位：生成二维码 -> 写 state/qr.png -> 轮询 -> 落盘 cookies
//   node src/login.mjs --check   用已保存的 cookie 验证会话是否还有效
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import QRCode from 'qrcode';
import { CookieJar, follow } from './lib/http.mjs';
import { SSO_SERVICE } from './lib/cas.mjs';
import { COURSE_URL, STATE, COOKIES, stateFile} from './lib/const.mjs';
import { verify as verifySession } from './lib/verify.mjs';

const QR_PNG = stateFile('qr.png');
const LOG = stateFile('login.log');
const PENDING = stateFile('pending.json');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function log(...a) {
  const line = `[${new Date().toISOString()}] ${a.join(' ')}`;
  console.log(line);
  try {
    fs.mkdirSync(STATE, { recursive: true });
    fs.appendFileSync(LOG, line + '\n');
  } catch {}
}

function newJar() {
  const jar = new CookieJar();
  return jar;
}

async function checkScan(jar, uuid) {
  const u =
    'https://pass.hust.edu.cn/cas/checkQRCodeScan?random=' +
    Math.random() +
    '&uuid=' +
    encodeURIComponent(uuid);
  const res = await fetch(u, {
    redirect: 'manual',
    headers: {
      accept: 'application/json, text/javascript, */*; q=0.01',
      'x-requested-with': 'XMLHttpRequest',
      referer: 'https://pass.hust.edu.cn/cas/login',
      cookie: jar.header(u),
    },
  });
  const text = await res.text();
  let data = null;
  try {
    data = JSON.parse(text);
  } catch {}
  return { status: res.status, text, redirect: data?.redirect_url ?? data?.redirectUrl ?? data?.url ?? null };
}

async function qr() {
  fs.mkdirSync(STATE, { recursive: true });
  const jar = newJar();
  // 先建立 CAS 会话（拿 JSESSIONID），扫码状态与它绑定
  await follow('https://pass.hust.edu.cn/cas/login?service=' + encodeURIComponent(SSO_SERVICE), jar);

  const uuid = crypto.randomUUID();
  const qrUrl =
    'https://pass.hust.edu.cn/cas/qyQrLogin?uuid=' +
    encodeURIComponent(uuid) +
    '&service=' +
    encodeURIComponent(SSO_SERVICE);
  await QRCode.toFile(QR_PNG, qrUrl, { width: 480, margin: 2, errorCorrectionLevel: 'M' });
  // 同时写一份唯一文件名的副本，避免前端缓存导致用户扫到旧码
  const uniqName = path.join(STATE, `qr-${uuid.slice(0, 8)}.png`);
  await QRCode.toFile(uniqName, qrUrl, { width: 480, margin: 2, errorCorrectionLevel: 'M' });
  log('二维码文件', uniqName);
  fs.writeFileSync(
    PENDING,
    JSON.stringify({ uuid, qrUrl, jar: jar.toJSON(), createdAt: Date.now() }, null, 2)
  );
  log('二维码已生成，uuid=', uuid);

  const deadline = Date.now() + 12 * 60 * 1000;
  let attempt = 0;
  const seen = new Set();
  let redirect = null;

  while (Date.now() < deadline) {
    attempt++;
    let st;
    try {
      st = await checkScan(jar, uuid);
    } catch (e) {
      log('轮询异常', String(e));
      await sleep(2500);
      continue;
    }
    if (!seen.has(st.text)) {
      seen.add(st.text);
      log('状态变化', st.status, st.text.slice(0, 300));
    }
    if (attempt % 20 === 1) log('轮询心跳', attempt, 'status', st.status, 'len', st.text.length, redirect ? 'redirect=' + redirect : '');
    if (st.redirect) redirect = st.redirect;

    // 只有拿到带 ticket 的地址才落脚；裸 service 地址是「刚扫中」的中间态，继续轮询等授权完成
    if (redirect && /ticket=/i.test(redirect)) {
      let landed = false;
      for (let k = 0; k < 3 && !landed; k++) {
        try {
          const { res, url, chain } = await follow(redirect, jar);
          const html = await res.text();
          landed = /smartcourse\.hust\.edu\.cn/.test(url) && !/pass\.hust\.edu\.cn/.test(url);
          log('落脚', url, 'status', res.status, 'len', html.length, landed ? '成功' : '仍是登录页');
          log('  链', chain.map((c) => c.status).join('>'));
        } catch (e) {
          log('落脚异常', String(e));
        }
        if (!landed) await sleep(3000);
      }
      if (landed) {
        fs.writeFileSync(COOKIES, JSON.stringify(jar.toJSON(), null, 2));
        const ok = await verify(jar);
        log(ok ? '会话校验通过' : '会话校验失败');
        console.log(ok ? 'LOGIN_OK' : 'LOGIN_BAD');
        return;
      }
    }
    await sleep(2500);
  }
  log('轮询超时');
  console.log('LOGIN_TIMEOUT');
}

async function verify(jar) {
  const r = await verifySession(jar);
  return r.ok;
}

async function check() {
  if (!fs.existsSync(COOKIES)) return console.log('NO_COOKIES');
  const jar = new CookieJar();
  jar.load(JSON.parse(fs.readFileSync(COOKIES, 'utf8')));
  console.log((await verify(jar)) ? 'SESSION_OK' : 'SESSION_EXPIRED');
}

// 第一步：开一个 CAS 会话并取图形验证码，会话状态存盘供下一步复用
async function cap() {
  const { CasSession } = await import('./lib/cas.mjs');
  const s = new CasSession();
  await s.open();
  const { buffer, contentType } = await s.captcha();
  const p = stateFile('captcha.png');
  fs.writeFileSync(p, buffer);
  fs.writeFileSync(
    stateFile('cas-pending.json'),
    JSON.stringify({ page: s.page, jar: s.jar.toJSON(), at: Date.now() }, null, 2)
  );
  log('验证码已保存', p, contentType, buffer.length, 'bytes');
  console.log('CAPTCHA_SAVED ' + p);
}

// 密码模式（fallback）：从 state/cred.txt 读账号密码，密码不打印、不入日志
async function pw() {
  const { CasSession } = await import('./lib/cas.mjs');
  const f = stateFile('cred.txt');
  if (!fs.existsSync(f)) {
    console.log('NO_CRED_FILE  请把学号、密码分两行写进 state/cred.txt');
    return;
  }
  const lines = fs
    .readFileSync(f, 'utf8')
    .replace(/^\uFEFF/, '')
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter(Boolean);
  const [username, password] = lines;
  if (!username || !password) {
    console.log('CRED_INCOMPLETE  需要两行：第一行学号，第二行密码');
    return;
  }
  const capArg = (process.argv.find((a) => a.startsWith('--captcha=')) || '').split('=')[1] || '';

  const s = new CasSession();
  const pendFile = stateFile('cas-pending.json');
  // 若刚取过验证码，复用同会话（lt/execution/JSESSIONID 必须一致）
  let reused = false;
  if (capArg && fs.existsSync(pendFile)) {
    try {
      const pend = JSON.parse(fs.readFileSync(pendFile, 'utf8'));
      if (Date.now() - pend.at < 4 * 60 * 1000) {
        s.jar.load(pend.jar);
        s.page = pend.page;
        reused = true;
      }
    } catch {}
  }
  if (!reused) await s.open();

  const r = await s.submit({ username, password, captcha: capArg });
  if (!r.ok) {
    log('登录失败:', r.message);
    if (r.html) {
      const dump = stateFile('last-login-fail.html');
      fs.writeFileSync(dump, r.html);
      log('失败页已存:', dump, '长度', r.html.length);
    }
    console.log('PW_FAIL ' + r.message);
    return;
  }
  log('CAS ticket 到手');
  await s.completeSso(r.ticket);
  fs.writeFileSync(COOKIES, JSON.stringify(s.jar.toJSON(), null, 2));
  const ok = await verify(s.jar);
  log(ok ? '会话校验通过' : '会话校验失败');
  if (ok) {
    for (const g of [f, pendFile]) {
      try {
        fs.unlinkSync(g);
      } catch {}
    }
    log('已清理 cred.txt / cas-pending.json');
  }
  console.log(ok ? 'LOGIN_OK' : 'LOGIN_BAD');
}

const mode = process.argv[2] || '--qr';
if (mode === '--qr') await qr();
else if (mode === '--pw') await pw();
else if (mode === '--cap') await cap();
else if (mode === '--check') await check();
else console.log('用法: node src/login.mjs [--qr|--pw|--cap|--check]');
