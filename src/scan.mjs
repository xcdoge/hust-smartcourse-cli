// 全量扫描：章节 x 卡片页（num=0 学习材料 / num=1 练习题 / num=2 …）
//   node src/scan.mjs
//
// 超星一个章节可以有多个卡片页，每页的 <title> 就是 tab 名（学习材料/练习题/…）。
// 每页里都有一个 mArg，attachments 就是该 tab 下的任务点。
import fs from 'node:fs';
import { CookieJar, follow } from './lib/http.mjs';
import { SMART_ORIGIN, COOKIES, STATE, COURSE_ID, CLAZZ_ID, CPI } from './lib/const.mjs';
import { braceMatch } from './lib/brace.mjs';

const jar = new CookieJar();
jar.load(JSON.parse(fs.readFileSync(COOKIES, 'utf8')));

const listUrl = `${SMART_ORIGIN}/mooc-smartcourse/mooc2-ans/mycourse/studentcourse?courseid=${COURSE_ID}&clazzid=${CLAZZ_ID}`;
const lr = await follow(listUrl, jar);
const listHtml = await lr.res.text();

const chapters = [];
for (const m of listHtml.matchAll(/<div class="chapter_item"[^>]*id="cur(\d+)"[^>]*onclick="toOld\('(\d+)',\s*'(\d+)'/g)) {
  const tail = listHtml.slice(m.index, m.index + 1200);
  const title = (tail.match(/title="([^"]*)"/) || [])[1] || '';
  chapters.push({ knowledgeId: m[3], title });
}
console.log(`章节 ${chapters.length} 个`);

function margOf(html) {
  const m = html.match(/mArg\s*=\s*\{/);
  if (!m) return null;
  const s = html.indexOf('{', m.index);
  const e = braceMatch(html, s);
  if (e < 0) return null;
  try {
    return JSON.parse(html.slice(s, e + 1));
  } catch {
    return null;
  }
}

const rows = [];
const typeCount = {};
const pageTitles = {};
let emptyPages = 0;

for (let i = 0; i < chapters.length; i++) {
  const ch = chapters[i];
  for (let num = 0; num < 4; num++) {
    const url =
      `${SMART_ORIGIN}/mooc-ans/knowledge/cards?clazzid=${CLAZZ_ID}&courseid=${COURSE_ID}` +
      `&knowledgeid=${ch.knowledgeId}&num=${num}&ut=s&cpi=${CPI}&v=2025-0424-1038-4&mooc2=1&isMicroCourse=false&editorPreview=0&crossId=`;
    let html = '';
    try {
      const r = await follow(url, jar);
      html = await r.res.text();
    } catch {
      break;
    }
    const title = (html.match(/<title>([^<]*)<\/title>/) || [])[1] || '';
    const mArg = margOf(html);
    if (!mArg) break;
    pageTitles[`${num}:${title}`] = (pageTitles[`${num}:${title}`] || 0) + 1;
    const atts = mArg.attachments || [];
    if (atts.length === 0) emptyPages++;
    for (const a of atts) {
      const module = a.property?.module || a.module || '?';
      const type = a.type || '?';
      const key = `${module}/${type}`;
      typeCount[key] = (typeCount[key] || 0) + 1;
      rows.push({
        chapter: ch.knowledgeId,
        chapterTitle: ch.title,
        page: num,
        pageTitle: title,
        module,
        type,
        worktype: a.property?.worktype || '',
        title: a.property?.title || a.property?.name || a.title || '',
        jobid: a.jobid || '',
        workid: a.property?.workid || '',
        isPassed: a.isPassed,
        enc: a.enc || '',
        jtoken: a.jtoken || '',
        otherInfo: a.otherInfo || '',
      });
    }
  }
  if ((i + 1) % 10 === 0) console.log(`  已扫 ${i + 1}/${chapters.length}`);
}

console.log('\n=== 卡片页标题分布 ===');
for (const [k, v] of Object.entries(pageTitles).sort((a, b) => b[1] - a[1])) console.log(`  ${k}: ${v}`);

console.log('\n=== 附件类型统计 ===');
for (const [k, v] of Object.entries(typeCount).sort((a, b) => b[1] - a[1])) console.log(`  ${k}: ${v}`);

console.log('\n=== 非视频/文档附件（重点） ===');
for (const r of rows.filter((x) => !/insertvideo|insertdoc/.test(x.module))) {
  console.log(`  [${r.chapter} p${r.page} ${r.pageTitle}] ${r.module}/${r.type} ${r.worktype} ${r.title.slice(0, 40)} passed=${r.isPassed}`);
}

fs.writeFileSync(`${STATE}/scan.json`, JSON.stringify({ chapters: chapters.length, typeCount, pageTitles, rows }, null, 2));
console.log(`\n共 ${rows.length} 个附件，空页 ${emptyPages}，已写 state/scan.json`);
