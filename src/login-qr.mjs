// 扫码登录（hust-cli 思路）：先拿 CAS 会话，再换 service ticket
//
// 关键区别：二维码里的 service 留空 —— 只要 pass.hust.edu.cn 自己的 CAS 会话；
// 有了会话再单独 GET /cas/login?service=<超星> ，CAS 会免密 302 带 ticket。
//   node src/login-qr2.mjs
import fs from 'node:fs';
import crypto from 'node:crypto';
import QRCode from 'qrcode';
import { CookieJar, follow } from './lib/http.mjs';
import { STATE, COOKIES, SMART_ORIGIN, COURSE_ID, CLAZZ_ID } from './lib/const.mjs';

const CAS = 'https://pass.hust.edu.cn/cas';
const SERVICE = 'http://smartcourse.hust.edu.cn/fyportal-smartcourse/sso/hust';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.log(...a);

const uuid = crypto.randomBytes(16).toString('hex');
const qrContent = `${CAS}/qyQrLogin?uuid=${uuid}&service=`;
const qrPath = `${STATE}/login-qr.png`;
await QRCode.toFile(qrPath, qrContent, { width: 320, margin: 1 });
log('二维码已生成:', qrPath);
log('内容:', qrContent);
log('请用「企业微信 / 华中大微校园」扫码…（最多等 3 分钟）');

const jar = new CookieJar();
let redirectUrl = '';

for (let i = 1; i <= 60; i++) {
  const url = `${CAS}/checkQRCodeScan?random=${(Date.now() / 1e15).toFixed(15)}&uuid=${uuid}`;
  let body = '';
  try {
    // 必须走 follow()：它会保存服务端下发的 Set-Cookie（CASTGC 就是这一步种的）
    const rr = await follow(url, jar, {
      headers: {
        'x-requested-with': 'XMLHttpRequest',
        accept: 'application/json, text/javascript, */*; q=0.01',
        referer: `${CAS}/login`,
      },
    });
    body = (await rr.res.text()).trim();
    const sc = rr.res.headers.getSetCookie?.() || [];
    if (sc.length) log(`  [cookie] 第 ${i} 次收到: ${sc.map((c) => c.split('=')[0]).join(',')}`);
  } catch (e) {
    log(`  第 ${i} 次请求异常: ${String(e).slice(0, 60)}`);
  }
  if (body) {
    let j = null;
    try {
      j = JSON.parse(body);
    } catch {}
    const ru = j?.redirect_url || '';
    log(`  第 ${i} 次: ${body.slice(0, 140)}`);
    if (ru) {
      redirectUrl = ru;
      break;
    }
  } else if (i % 5 === 0) {
    log(`  第 ${i} 次: 等待扫码…`);
  }
  await sleep(3000);
}

if (!redirectUrl) {
  log('✘ 3 分钟内没等到扫码结果');
  process.exit(1);
}

log('\n拿到 redirect_url:', redirectUrl);
// 用同一个 jar 兑一次，种下 CAS 会话
const r1 = await follow(redirectUrl, jar);
log('兑票后:', r1.res.status, r1.url.slice(0, 100));

// 有了 CAS 会话，再单独换超星的 service ticket（应当免密直接 302）
const ssoUrl = `${CAS}/login?service=${encodeURIComponent(SERVICE)}`;
const r2 = await follow(ssoUrl, jar);
log('换票:', r2.res.status, r2.url.slice(0, 120));

// 跟到超星，拿业务 cookie
const r3 = await follow(`${SMART_ORIGIN}/mooc-smartcourse/mooc2-ans/mycourse/studentcourse?courseid=${COURSE_ID}&clazzid=${CLAZZ_ID}`, jar);
const html = await r3.res.text();
const chapters = (html.match(/toOld\(/g) || []).length;
log('超星章节页:', r3.res.status, html.length, '字节 | 章节', chapters);

fs.writeFileSync(COOKIES, JSON.stringify(jar.toJSON(), null, 2));
log('cookie 已写', COOKIES, '共', Object.keys(jar.toJSON()).length, '个域');
process.exit(chapters > 0 ? 0 : 2);
