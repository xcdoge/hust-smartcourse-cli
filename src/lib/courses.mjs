// 课程列表：抓取、缓存、按序号切换
import fs from 'node:fs';
import path from 'node:path';
import { CookieJar, follow } from './http.mjs';
import { STATE, COOKIES, SMART_ORIGIN } from './const.mjs';

const LIST_FILE = path.join(STATE, 'courses.json');
const TARGET_FILE = path.join(STATE, 'target.json');

function loadJar() {
  if (!fs.existsSync(COOKIES)) throw new Error('未登录，先执行 node src/login-qr.mjs 或 node src/login-pw.mjs');
  const jar = new CookieJar();
  jar.load(JSON.parse(fs.readFileSync(COOKIES, 'utf8')));
  return jar;
}

/** 抓课程列表（courseType=1 才有数据） */
export async function fetchCourseList(jar = loadJar()) {
  const url = `${SMART_ORIGIN}/mooc-smartcourse/mooc2-ans/visit/courselistdata?courseType=1`;
  const { res } = await follow(url, jar, {
    headers: { 'x-requested-with': 'XMLHttpRequest' },
  });
  const html = await res.text();
  if (res.status !== 200 || html.length < 500) {
    throw new Error(`课程列表返回异常（HTTP ${res.status}，${html.length} 字节）`);
  }

  const out = [];
  const seen = new Set();
  const starts = [];
  const re = /<div class="course clearfix/g;
  let m;
  while ((m = re.exec(html))) starts.push(m.index);

  for (let i = 0; i < starts.length; i++) {
    const block = html.slice(starts[i], i + 1 < starts.length ? starts[i + 1] : undefined);
    const idm = block.match(/id="c_(\d+)"/);
    if (!idm) continue;
    const courseId = idm[1];
    if (seen.has(courseId)) continue;

    const clazzId = (block.match(/class="clazzId"[^>]*value="(\d+)"/) || [])[1] || '';
    const cpi = (block.match(/class="curPersonId"[^>]*value="(\d+)"/) || [])[1] || '';
    if (!clazzId || !cpi) continue;

    const name = ((block.match(/class="course-name[^"]*"[^>]*>\s*([^<]{1,80})/) || [])[1] || '').trim();
    const teacher = ((block.match(/class="line2 color3"[^>]*>\s*([^<]{1,40})/) || [])[1] || '').trim();

    seen.add(courseId);
    out.push({ index: out.length + 1, name, teacher, courseId, clazzId, cpi });
  }

  if (!out.length) throw new Error('列表里没解析到课程，可能页面结构变了');
  return out;
}

/** 优先用缓存 */
export async function loadCourseList(refresh = false) {
  if (!refresh && fs.existsSync(LIST_FILE)) {
    try {
      const cached = JSON.parse(fs.readFileSync(LIST_FILE, 'utf8'));
      if (Array.isArray(cached) && cached.length) return cached;
    } catch {}
  }
  const list = await fetchCourseList();
  fs.writeFileSync(LIST_FILE, JSON.stringify(list, null, 2));
  return list;
}

/** 按序号切课程：写 target.json，并清掉不匹配的 course.json 快照 */
export async function switchCourse(id) {
  const list = await loadCourseList(false);
  const item = list[id - 1];
  if (!item) throw new Error(`序号 ${id} 超出范围（共 ${list.length} 门课）`);

  const target = { name: item.name, courseId: item.courseId, clazzId: item.clazzId, cpi: item.cpi, enc: '' };
  fs.writeFileSync(TARGET_FILE, JSON.stringify(target, null, 2));
  console.log(`已切换到 [${item.index}] ${item.name || item.courseId}`);

  const snapFile = path.join(STATE, 'course.json');
  if (fs.existsSync(snapFile)) {
    let stale = true;
    try {
      const snap = JSON.parse(fs.readFileSync(snapFile, 'utf8'));
      stale = (snap.target?.courseId || snap.courseId || '') !== item.courseId;
    } catch {}
    if (stale) fs.rmSync(snapFile);
  }
  return item;
}

/** 打印列表（中文按两格对齐） */
export function printCourseList(list, currentCourseId = '') {
  const width = (s) => [...s].reduce((w, ch) => w + (isWide(ch) ? 2 : 1), 0);
  const pad = (s, n, limit) => {
    let t = s;
    if (width(t) > n) {
      let out = '';
      let w = 0;
      for (const ch of t) {
        const cw = isWide(ch) ? 2 : 1;
        if (w + cw > n - 1) break;
        out += ch;
        w += cw;
      }
      t = out + '…';
    }
    return t + ' '.repeat(Math.max(0, n - width(t)));
  };
  const nameW = Math.min(40, Math.max(8, ...list.map((x) => width(x.name))));
  const teacherW = Math.min(16, Math.max(6, ...list.map((x) => width(x.teacher))));

  console.log(`${pad('序号', 6)}${pad('课程', nameW + 2)}${pad('教师', teacherW + 2)}状态`.trimEnd());
  for (const it of list) {
    const line =
      `${pad(String(it.index), 6)}${pad(it.name || `(未命名 ${it.courseId})`, nameW + 2)}${pad(it.teacher, teacherW + 2)}` +
      (it.courseId === currentCourseId ? '← 当前' : '');
    console.log(line.trimEnd());
  }
}

function isWide(ch) {
  const c = ch.codePointAt(0);
  return (
    (c >= 0x1100 && c <= 0x115f) ||
    (c >= 0x2e80 && c <= 0xa4cf) ||
    (c >= 0xac00 && c <= 0xd7a3) ||
    (c >= 0xf900 && c <= 0xfaff) ||
    (c >= 0xfe30 && c <= 0xfe6f) ||
    (c >= 0xff00 && c <= 0xff60) ||
    (c >= 0xffe0 && c <= 0xffe6)
  );
}
