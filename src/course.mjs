// 抓课程结构：章节 -> 任务点（含视频所需的上报参数）
// 输出 state/course.json
//
// 链路：
//   1) /mooc-smartcourse/mooc2-ans/mycourse/studentcourse?courseid=&clazzid=  -> 章节目录
//      每章 onclick="toOld('courseid','knowledgeId','clazzid',0)"
//   2) /mooc-ans/knowledge/cards?clazzid=&courseid=&knowledgeid=&num=0&ut=s&cpi=&...  -> mArg
//      mArg.defaults.reportUrl + mArg.attachments[]（type=video 的带 objectId/jobid/otherInfo/...）
import fs from 'node:fs';
import path from 'node:path';
import { CookieJar, follow } from './lib/http.mjs';
import { SMART_ORIGIN, BASE, COURSE_ID, CLAZZ_ID, CPI, COOKIES, STATE, requireTarget} from './lib/const.mjs';
import { braceMatch } from './lib/brace.mjs';


requireTarget();
const OUT = path.resolve(import.meta.dirname, '..', 'probe', 'out');
fs.mkdirSync(OUT, { recursive: true });

const jar = new CookieJar();
jar.load(JSON.parse(fs.readFileSync(COOKIES, 'utf8')));
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.log(...a);

function extractMarg(html) {
  const m = html.match(/mArg\s*=\s*\{/);
  if (!m) return null;
  const start = html.indexOf('{', m.index);
  const end = braceMatch(html, start);
  if (end < 0) return null;
  let raw = html.slice(start, end + 1);
  try {
    return JSON.parse(raw);
  } catch {
    try {
      return JSON.parse(raw.replace(/[\u0000-\u001f]+/g, ' '));
    } catch {
      return null;
    }
  }
}

// ---------- 1) 章节目录 ----------
const listUrl = `${BASE}/mooc2-ans/mycourse/studentcourse?courseid=${COURSE_ID}&clazzid=${CLAZZ_ID}`;
const { res: listRes, url: listFinal } = await follow(listUrl, jar);
const listHtml = await listRes.text();
fs.writeFileSync(path.join(OUT, 'studentcourse.html'), listHtml);
log(`章节目录 ${listRes.status} ${listHtml.length} 字节`);

const studyEnc = (listHtml.match(/var enc = "([0-9a-f]{32})"/) || [])[1] || '';
log('studentstudy enc =', studyEnc || '(未找到)');

const chapters = [];
const reToOld = /<div class="chapter_item"[^>]*id="cur(\d+)"[^>]*onclick="toOld\('(\d+)',\s*'(\d+)',\s*'(\d+)'/g;
for (const m of listHtml.matchAll(reToOld)) {
  const idx = m.index;
  const tail = listHtml.slice(idx, idx + 1200);
  const title = (tail.match(/title="([^"]*)"/) || [])[1] || '';
  chapters.push({ knowledgeId: m[3], courseId: m[2], clazzId: m[4], title });
}
// 兜底：直接扫 toOld 调用
if (chapters.length === 0) {
  for (const m of listHtml.matchAll(/toOld\('(\d+)',\s*'(\d+)',\s*'(\d+)'/g)) {
    chapters.push({ courseId: m[1], knowledgeId: m[2], clazzId: m[3], title: '' });
  }
}
log(`章节点 ${chapters.length} 个`);

// ---------- 2) 逐章取任务点 ----------
const points = [];
const works = [];
let reportUrlGlobal = '';
for (let i = 0; i < chapters.length; i++) {
  const c = chapters[i];
  const cardsUrl =
    `${SMART_ORIGIN}/mooc-ans/knowledge/cards?clazzid=${c.clazzId}&courseid=${c.courseId}` +
    `&knowledgeid=${c.knowledgeId}&num=0&ut=s&cpi=${CPI}&v=2025-0424-1038-4&mooc2=1&isMicroCourse=false&editorPreview=0&crossId=`;
  let html = '';
  try {
    const r = await follow(cardsUrl, jar);
    html = await r.res.text();
  } catch (e) {
    log(`  [${i + 1}/${chapters.length}] ${c.knowledgeId} 请求失败 ${String(e).slice(0, 80)}`);
    continue;
  }
  const mArg = extractMarg(html);
  if (!mArg) {
    log(`  [${i + 1}/${chapters.length}] ${c.knowledgeId} 无 mArg（${html.length} 字节）`);
    continue;
  }
  if (!reportUrlGlobal && mArg.defaults?.reportUrl) reportUrlGlobal = mArg.defaults.reportUrl;
  const atts = mArg.attachments || [];
  let vids = 0;
  for (const a of atts) {
    const prop = a.property || {};
    const objectId = a.objectId || a.objectid || prop.objectid;
    const type = a.type || '';
    const isVideo = type === 'video' || prop.module === 'insertvideo';
    const isWork = type === 'workid' || type === 'work' || prop.module === 'work';
    if (isWork) {
      works.push({
        chapterId: c.knowledgeId,
        chapterTitle: c.title,
        title: prop.title || a.title || '',
        workId: a.workid || prop.workid || '',
        jobid: a.jobid || '',
        worktype: a.worktype || prop.worktype || '',
        mid: prop.mid || a.mid || '',
        enc: a.enc || '',
        workExtInfoEnc: a.workExtInfoEnc || '',
        oriNodeId: a.oriNodeId || '',
        isPassed: a.isPassed === true,
      });
      continue;
    }
    if (!isVideo || !objectId) continue;
    vids++;
    points.push({
      chapterId: c.knowledgeId,
      chapterTitle: c.title,
      name: prop.name || a.name || '',
      objectId,
      jobid: a.jobid || prop.jobid || prop._jobid || '',
      attDuration: a.attDuration ?? 0,
      begins: a.begins ?? 0,
      ends: a.ends ?? 0,
      otherInfo: a.otherInfo || '',
      attDurationEnc: a.attDurationEnc || '',
      videoFaceCaptureEnc: a.videoFaceCaptureEnc || '',
      isPassed: a.isPassed === true,
      reportUrl: mArg.defaults?.reportUrl || '',
    });
  }
  if (vids) log(`  [${i + 1}/${chapters.length}] ${c.knowledgeId} ${(c.title || '').slice(0, 24)} -> ${vids} 个视频`);
  await sleep(120);
}

log(`\n视频任务点合计 ${points.length} 个（已通过 ${points.filter((p) => p.isPassed).length} 个）`);
for (const p of points) {
  log(`  ${p.isPassed ? '✔' : '▶'} ${(p.name || '').slice(0, 30)} | objectId=${p.objectId} jobid=${p.jobid} ${p.attDuration ? p.attDuration + 's' : ''}`);
}

if (chapters.length === 0 || points.length === 0) {
  log('✘ 抓不到章节/视频（会话可能已过期），保留原有 state/course.json 不覆盖');
  process.exit(2);
}

fs.writeFileSync(
  `${STATE}/course.json`,
  JSON.stringify(
    { fetchedAt: new Date().toISOString(), courseId: COURSE_ID, clazzId: CLAZZ_ID, reportUrl: reportUrlGlobal, studyEnc, chapters, points, works },
    null,
    2
  )
);
log('\n已写 state/course.json');
