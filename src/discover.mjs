// 登录后侦察：把课程页 / 章节列表 / 任务点卡片原样 dump，并抽出接口路径
import fs from 'node:fs';
import path from 'node:path';
import { CookieJar, follow } from './lib/http.mjs';
import { COURSE_URL, BASE, COURSE_ID, CLAZZ_ID, CPI, ENC } from './lib/const.mjs';

const ROOT = path.resolve(import.meta.dirname, '..');
const OUT = path.join(ROOT, 'probe', 'out');
fs.mkdirSync(OUT, { recursive: true });

const jar = new CookieJar();
jar.load(JSON.parse(fs.readFileSync(path.join(ROOT, 'state', 'cookies.json'), 'utf8')));

const Q = { courseid: COURSE_ID, clazzid: CLAZZ_ID, cpi: CPI, enc: ENC };

const targets = [
  ['course', COURSE_URL],
  ['studentcourse', `${BASE}/mooc2-ans/mycourse/studentcourse?courseid=${Q.courseid}&clazzid=${Q.clazzid}`],
  ['outline', `${BASE}/mooc2-ans/mycourse/studentcourse?courseid=${Q.courseid}&clazzid=${Q.clazzid}&enc=${Q.enc}`],
];

const saved = {};
for (const [name, url] of targets) {
  try {
    const { res, url: finalUrl, chain } = await follow(url, jar);
    const html = await res.text();
    fs.writeFileSync(path.join(OUT, name + '.html'), html);
    saved[name] = { url: finalUrl, status: res.status, len: html.length, chain: chain.map((c) => c.status) };
    console.log(name.padEnd(14), res.status, html.length, finalUrl.slice(0, 120));
  } catch (e) {
    console.log(name, 'FAIL', String(e).slice(0, 200));
  }
}

const html = saved.course ? fs.readFileSync(path.join(OUT, 'course.html'), 'utf8') : '';
const count = (re) => [...html.matchAll(re)].length;
console.log('\n--- 计数 ---');
console.log('chapterId', count(/chapterId=(\d+)/g), '| knowledgeid', count(/knowledgeid=(\d+)/gi), '| objectid', count(/objectid[=:"']+(\d{6,})/gi));

const uniq = (re) => [...new Set([...html.matchAll(re)].map((m) => m[1]))];
console.log('\n--- 章节/任务点相关链接 ---');
for (const h of uniq(/href="([^"]+)"/g).filter((h) => /chapter|knowledge|cards|work|exam/i.test(h)).slice(0, 50)) console.log(h);
console.log('\n--- iframe/src ---');
for (const h of uniq(/<iframe[^>]+src="([^"]+)"/gi).slice(0, 20)) console.log(h);
console.log('\n--- 外链脚本 ---');
for (const s of uniq(/<script[^>]*src="([^"]+)"/g).slice(0, 40)) console.log(s);
console.log('\n--- 接口路径候选 ---');
for (const p of uniq(/["'](\/mooc-smartcourse\/[a-zA-Z0-9_\-/.]+)/g).slice(0, 60)) console.log(p);
