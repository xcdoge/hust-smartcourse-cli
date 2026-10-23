// 一键跑：会话体检 -> 抓课程 -> 播所有视频
//   node src/run.mjs [--speed=1.5] [--tick=15] [--dry] [--max=20]
import fs from 'node:fs';
import { CookieJar } from './lib/http.mjs';
import { COOKIES, STATE, COURSE_URL, BASE, COURSE_ID, CLAZZ_ID, CPI, ENC, stateFile} from './lib/const.mjs';
import { verify } from './lib/verify.mjs';
import { follow } from './lib/http.mjs';
import { playVideo, DEFAULT_BASE } from './lib/player.mjs';

const argv = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, v = 'true'] = a.replace(/^--/, '').split('=');
    return [k, v];
  })
);
const ts = () => new Date().toISOString().slice(11, 19);
const log = (...a) => console.log(`[${ts()}]`, ...a);

// ---------- 1) 会话 ----------
if (!fs.existsSync(COOKIES)) {
  console.log('没有 state/cookies.json，先登录');
  console.log('  请先在浏览器登录课程页，F12 → 网络 → 复制任一 mooc 请求为 cURL，粘进 state/cookies.txt，再跑 node src/import-cookies.mjs');
  process.exit(2);
}
const jar = new CookieJar();
jar.load(JSON.parse(fs.readFileSync(COOKIES, 'utf8')));
const v = await verify(jar);
log(`会话: ${v.ok ? '有效 ' + v.len + ' 字节' : '无效 ' + v.reason}`);
if (!v.ok) process.exit(2);

// ---------- 2) 抓课程 ----------
async function fetchPage(url, name) {
  const { res, url: finalUrl } = await follow(url, jar);
  const html = await res.text();
  fs.writeFileSync(`${STATE}/${name}.html`, html);
  return { status: res.status, finalUrl, html };
}

const pages = [];
for (const [name, url] of [
  ['course', COURSE_URL],
  ['studentcourse', `${BASE}/mooc2-ans/mycourse/studentcourse?courseid=${COURSE_ID}&clazzid=${CLAZZ_ID}`],
  ['studentcourse_enc', `${BASE}/mooc2-ans/mycourse/studentcourse?courseid=${COURSE_ID}&clazzid=${CLAZZ_ID}&enc=${ENC}`],
]) {
  try {
    const p = await fetchPage(url, name);
    pages.push({ name, ...p });
    log(`抓取 ${name.padEnd(18)} ${p.status} ${p.html.length} 字节`);
  } catch (e) {
    log(`抓取 ${name} 失败: ${String(e).slice(0, 120)}`);
  }
}

// ---------- 3) 抽任务点 ----------
const TYPES = [
  ['视频', /icon[_-]?(video|Video)|视频/],
  ['文档', /icon[_-]?(doc|Doc|ppt|PPT)|文档/],
  ['测验', /icon[_-]?(work|Work|quiz|exam)|测验|作业/],
  ['讨论', /icon[_-]?(discuss)|讨论/],
];
function classify(chunk) {
  for (const [t, re] of TYPES) if (re.test(chunk)) return t;
  return '未知';
}

const all = pages.map((p) => p.html).join('\n');
const points = [];
// 四元组形态：('chapterId','knowledgeid','objectid','jobid')
const tupleRe = /\((['"])(\d{4,})\1\s*,\s*(['"])(\d{4,})\3\s*,\s*(['"])(\d{4,})\5(?:\s*,\s*(['"])(\d{4,})\7)?\)/g;
for (const m of all.matchAll(tupleRe)) {
  const chunk = all.slice(Math.max(0, m.index - 400), m.index + 400);
  points.push({ chapterId: m[2], knowledgeId: m[4], objectid: m[6], jobid: m[8] || '', type: classify(chunk) });
}
// 兜底：单独的 objectid
if (points.length === 0) {
  for (const m of all.matchAll(/objectid['"\s:=]+(\d{6,})/gi)) {
    const chunk = all.slice(Math.max(0, m.index - 400), m.index + 400);
    points.push({ objectid: m[1], jobid: '', type: classify(chunk) });
  }
}
const seen = new Set();
const uniq = points.filter((p) => (seen.has(p.objectid) ? false : (seen.add(p.objectid), true)));

log(`任务点: ${uniq.length} 个（视频 ${uniq.filter((p) => p.type === '视频').length} / 文档 ${uniq.filter((p) => p.type === '文档').length} / 测验 ${uniq.filter((p) => p.type === '测验').length}）`);
uniq.slice(0, 20).forEach((p) => log(`  [${p.type}] objectid=${p.objectid} jobid=${p.jobid} knowledge=${p.knowledgeId || '-'}`));

fs.writeFileSync(
  `stateFile('course.json')`,
  JSON.stringify({ fetchedAt: new Date().toISOString(), courseId: COURSE_ID, clazzId: CLAZZ_ID, points: uniq }, null, 2)
);
if (uniq.length === 0) {
  log('没抽到任务点，页面已存 state/course.html / studentcourse.html，结构需要人工确认');
  process.exit(3);
}

// ---------- 4) 播放 ----------
const onlyVideo = uniq.filter((p) => p.type === '视频');
const targets = (onlyVideo.length ? onlyVideo : uniq).slice(0, Number(argv.max || 999));
log(`开始处理 ${targets.length} 个任务点（倍速 ${argv.speed || 1.5}）`);
const results = [];
for (const p of targets) {
  try {
    results.push({ ...p, ...(await playVideo(jar, p, {
      base: process.env.CX_BASE || DEFAULT_BASE,
      clazzId: CLAZZ_ID,
      speed: Number(argv.speed || 1.5),
      tickSec: Number(argv.tick || 15),
      dry: argv.dry === 'true',
      jump: argv.jump === 'true',
      logger: log,
    })) });
  } catch (e) {
    log('异常', String(e).slice(0, 160));
    results.push({ ...p, ok: false, reason: String(e).slice(0, 160) });
  }
}
const ok = results.filter((r) => r.ok).length;
log(`完成 ${ok}/${results.length}`);
for (const r of results) log(`  ${r.ok ? 'ok' : 'fail'} ${r.objectid} ${r.type} ${r.reason || ''}`);
