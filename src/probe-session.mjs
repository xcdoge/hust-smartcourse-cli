// 会话体检：用当前 state/cookies.json 打一组入口，看哪条能进
//   node src/probe-session.mjs
import fs from 'node:fs';
import { CookieJar, httpGet } from './lib/http.mjs';
import { BASE, COURSE_URL, SMART_ORIGIN, COURSE_ID, CLAZZ_ID, CPI, ENC, COOKIES, STATE } from './lib/const.mjs';

const jar = new CookieJar();
jar.load(JSON.parse(fs.readFileSync(COOKIES, 'utf8')));

const targets = [
  ['portal', `${SMART_ORIGIN}/mh-smartcourse/`],
  ['course', COURSE_URL],
  ['studentcourse', `${BASE}/mooc2-ans/mycourse/studentcourse?courseid=${COURSE_ID}&clazzid=${CLAZZ_ID}`],
  ['stu-hideHead', `${BASE}/mooc2-ans/mooc2-ans/mycourse/stu?courseid=${COURSE_ID}&clazzid=${CLAZZ_ID}&cpi=${CPI}&enc=${ENC}&pageHeader=0&hideHead=1`],
  ['sso', `${SMART_ORIGIN}/fyportal-smartcourse/sso/hust`],
];

const rows = [];
for (const [name, url] of targets) {
  try {
    // 手动跟随，最多 6 跳
    let cur = url;
    let status = 0;
    let loc = '';
    let html = '';
    for (let i = 0; i < 6; i++) {
      const r = await httpGet(cur, jar);
      status = r.status;
      loc = r.headers.get('location') || '';
      if (status >= 300 && status < 400 && loc) {
        await r.arrayBuffer().catch(() => {});
        cur = new URL(loc, cur).toString();
        continue;
      }
      html = (await r.text().catch(() => '')) || '';
      break;
    }
    const verdict = /\/logout/.test(cur)
      ? '登出'
      : /pass\.hust\.edu\.cn\/cas|passport/.test(cur)
        ? '未登录'
        : html.length > 2000
          ? '可用'
          : '? 页面过小';
    rows.push({ name, status, final: cur.slice(0, 110), len: html.length, verdict });
  } catch (e) {
    rows.push({ name, status: -1, final: String(e).slice(0, 80), len: 0, verdict: '异常' });
  }
}

for (const r of rows) {
  console.log(`${r.name.padEnd(16)} ${String(r.status).padEnd(4)} len=${String(r.len).padEnd(6)} ${r.verdict}  ${r.final}`);
}

const anyOk = rows.some((r) => r.verdict === '可用');
if (!anyOk) {
  const dump = rows.map((r) => `${r.name} ${r.status} ${r.final}`).join('\n');
  fs.writeFileSync(`${STATE}/probe-session.log`, dump + '\n');
}
console.log(anyOk ? '\n结论：会话可用' : '\n结论：会话不可用，需要重新抓 cookie');
