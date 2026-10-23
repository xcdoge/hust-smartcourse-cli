// 文档/图片任务点（insertdoc）批量完成
//   node src/doc.mjs          只处理未完成的
//   node src/doc.mjs --all    全部重刷一遍
//
// 完成接口（取自 /ananas/ueditor/documentJob.js 的 finishJob()）：
//   GET /mooc-ans/job/document?jobid=&knowledgeid=&courseid=&clazzid=&jtoken=&checkMicroTopic=true&microTopicId=&courseEngineInfo=false
import fs from 'node:fs';
import { CookieJar, follow } from './lib/http.mjs';
import { SMART_ORIGIN, COOKIES, STATE, CLAZZ_ID, CPI, requireTarget} from './lib/const.mjs';
import { braceMatch } from './lib/brace.mjs';


requireTarget();
const argv = process.argv.slice(2);
const FORCE = argv.includes('--all');

const jar = new CookieJar();
jar.load(JSON.parse(fs.readFileSync(COOKIES, 'utf8')));
const course = JSON.parse(fs.readFileSync(`${STATE}/course.json`, 'utf8'));
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ts = () => new Date().toISOString().slice(11, 19);
const log = (...a) => {
  const line = `[${ts()}] ${a.join(' ')}`;
  console.log(line);
  try {
    fs.appendFileSync(`${STATE}/doc.log`, line + String.fromCharCode(10));
  } catch {}
};

async function margOf(chapterId) {
  const url =
    `${SMART_ORIGIN}/mooc-ans/knowledge/cards?clazzid=${CLAZZ_ID}&courseid=${course.courseId}` +
    `&knowledgeid=${chapterId}&num=0&ut=s&cpi=${CPI}&v=2025-0424-1038-4&mooc2=1&isMicroCourse=false&editorPreview=0&crossId=`;
  const r = await follow(url, jar);
  const html = await r.res.text();
  const m = html.match(/mArg\s*=\s*\{/);
  if (!m) return null;
  const s = html.indexOf('{', m.index);
  const e = braceMatch(html, s);
  try {
    return JSON.parse(html.slice(s, e + 1));
  } catch {
    return null;
  }
}

const results = [];
let done = 0;
let skipped = 0;
let failed = 0;

for (let i = 0; i < course.chapters.length; i++) {
  const ch = course.chapters[i];
  const mArg = await margOf(ch.knowledgeId);
  if (!mArg) {
    log(`[${i + 1}/${course.chapters.length}] ${ch.knowledgeId} 无 mArg`);
    continue;
  }
  const docs = (mArg.attachments || []).filter((a) => a.type === 'document' || a.property?.module === 'insertdoc');
  for (const d of docs) {
    const name = d.property?.name || d.name || '';
    if (d.isPassed === true && !FORCE) {
      skipped++;
      continue;
    }
    const url =
      `${SMART_ORIGIN}/mooc-ans/job/document?jobid=${d.jobid}&knowledgeid=${ch.knowledgeId}` +
      `&courseid=${course.courseId}&clazzid=${CLAZZ_ID}&jtoken=${d.jtoken || ''}` +
      `&checkMicroTopic=true&microTopicId=&courseEngineInfo=false`;
    try {
      const r = await fetch(url, {
        headers: {
          cookie: jar.header(url),
          'user-agent': UA,
          'x-requested-with': 'XMLHttpRequest',
          accept: 'application/json, text/javascript, */*; q=0.01',
          referer: `${SMART_ORIGIN}/ananas/modules/doc/index.html`,
        },
      });
      const t = await r.text();
      let j = null;
      try {
        j = JSON.parse(t);
      } catch {}
      const ok = r.status === 200 && j?.status === true;
      if (ok) done++;
      else failed++;
      results.push({ chapter: ch.knowledgeId, name, status: r.status, ok, msg: j?.msg || t.slice(0, 80) });
      log(`${ok ? 'ok' : 'fail'} ${name.slice(0, 40)} -> ${j?.msg || r.status}`);
    } catch (e) {
      failed++;
      log(`fail ${name.slice(0, 40)} 异常 ${String(e).slice(0, 80)}`);
    }
    await sleep(250);
  }
}

log(`完成 ${done}，跳过(已完成) ${skipped}，失败 ${failed}`);
fs.writeFileSync(`${STATE}/doc-result.json`, JSON.stringify(results, null, 2));
