// 章节测验：抓题 + 自动作答 + 交卷
//   node src/quiz.mjs dump        抓所有未完成测验的题目 -> state/quizzes.json / state/quiz-readable.txt
//   node src/quiz.mjs submit      读取 state/answers.json 并逐份交卷
//   node src/quiz.mjs submit --only=<index>   只交某一份
import fs from 'node:fs';
import { CookieJar, follow } from './lib/http.mjs';
import { SMART_ORIGIN, COOKIES, STATE, CLAZZ_ID, CPI, requireTarget} from './lib/const.mjs';
import { braceMatch } from './lib/brace.mjs';
import { parseQuiz } from './lib/quiz-parse.mjs';


// --id=N：先切课程再重放自身（const.mjs 在 import 时读 target，必须换进程）
import { maybeHelp } from './lib/help.mjs';
maybeHelp('quiz');

const __idArg = process.argv.slice(2).find((a) => a.startsWith('--id='));
if (__idArg) {
  const { switchCourse } = await import('./lib/courses.mjs');
  await switchCourse(Number(__idArg.slice(5)));
  const { spawnSync } = await import('node:child_process');
  const rest = process.argv.slice(2).filter((a) => !a.startsWith('--id='));
  const r = spawnSync(process.execPath, [process.argv[1], ...rest], { stdio: 'inherit' });
  process.exit(r.status ?? 0);
}


const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
export const BROWSER_HEADERS = {
  'user-agent': UA,
  accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
  'accept-language': 'zh-CN,zh;q=0.9',
  'sec-fetch-dest': 'iframe',
  'sec-fetch-mode': 'navigate',
  'sec-fetch-site': 'same-origin',
  'upgrade-insecure-requests': '1',
};

const argv = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, v = 'true'] = a.replace(/^--/, '').split('=');
    return [k, v];
  })
);
const mode = process.argv[2];

// 登录态与课程快照按需加载：solve 不需要它们，import 时不该因为文件缺失而崩
const jar = new CookieJar();
let _loaded = false;
function ensureSession() {
  if (_loaded) return;
  if (!fs.existsSync(COOKIES)) throw new Error('未登录，先执行 node src/login-qr.mjs 或 node src/login-pw.mjs');
  jar.load(JSON.parse(fs.readFileSync(COOKIES, 'utf8')));
  _loaded = true;
}
let _course = null;
function getCourse() {
  if (_course) return _course;
  if (!fs.existsSync(`${STATE}/course.json`)) throw new Error('缺少 state/course.json，先执行 node src/course.mjs');
  _course = JSON.parse(fs.readFileSync(`${STATE}/course.json`, 'utf8'));
  return _course;
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function abs(url) {
  return url.startsWith('http') ? url : SMART_ORIGIN + (url.startsWith('/') ? url : '/' + url);
}

async function getText(url, referer) {
  const r = await fetch(abs(url), {
    headers: { ...BROWSER_HEADERS, cookie: jar.header(abs(url)), ...(referer ? { referer } : {}) },
    redirect: 'follow',
  });
  return { status: r.status, text: await r.text(), url: r.url };
}

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

async function ktokenOf(chapterId) {
  const url =
    `${SMART_ORIGIN}/mooc-ans/knowledge/cards?clazzid=${CLAZZ_ID}&courseid=${getCourse().courseId}` +
    `&knowledgeid=${chapterId}&num=0&ut=s&cpi=${CPI}&v=2025-0424-1038-4&mooc2=1&isMicroCourse=false&editorPreview=0&crossId=`;
  const { text } = await getText(url);
  return margOf(text)?.defaults?.ktoken || '';
}

async function utEnc() {
  const ch = getCourse().chapters[0];
  const url =
    `${SMART_ORIGIN}/mycourse/studentstudy?chapterId=${ch.knowledgeId}&courseId=${getCourse().courseId}` +
    `&clazzid=${CLAZZ_ID}&cpi=${CPI}&enc=${getCourse().studyEnc}&mooc2=1&hidetype=0`;
  const { text } = await getText(url);
  return (text.match(/utEnc\s*=\s*"([0-9a-f]{32})"/) || [])[1] || '';
}

function workUrl(w, ktoken, ut) {
  const q =
    'api=1&workId=' + w.workId + '&jobid=' + encodeURIComponent(w.jobid) + '&originJobId=' + encodeURIComponent(w.jobid) +
    '&needRedirect=true&skipHeader=true&knowledgeid=' + w.chapterId + '&ktoken=' + ktoken + '&cpi=' + CPI +
    '&ut=s&clazzId=' + CLAZZ_ID + '&type=&enc=' + w.enc + '&utenc=' + ut + '&mooc2=1&courseid=' + getCourse().courseId;
  return `${SMART_ORIGIN}/mooc-ans/api/work?${q}`;
}

// ---------------- dump ----------------
async function peek(idx) {
  const ut = await utEnc();
  const w = getCourse().works[Math.min(idx, getCourse().works.length - 1)];
  const kt = await ktokenOf(w.chapterId);
  const { status, text } = await getText(workUrl(w, kt, ut), `${SMART_ORIGIN}/ananas/modules/work/index.html?v=1`);
  const f = `${STATE}/quiz-page-${idx}.html`;
  fs.writeFileSync(f, text);
  console.log('HTTP', status, '写入', f, text.length, '字节 |', w.title);
}

async function dump() {
  const ut = await utEnc();
  console.log('utEnc =', ut ? ut.slice(0, 8) + '…' : '(未拿到)');
  const works = getCourse().works || [];
  const out = [];
  for (let i = 0; i < works.length; i++) {
    const w = works[i];
    const kt = await ktokenOf(w.chapterId);
    const pageUrl = workUrl(w, kt, ut);
    const { status, text } = await getText(pageUrl, `${SMART_ORIGIN}/ananas/modules/work/index.html?v=1`);
    if (status !== 200) {
      console.log(`${i + 1}/${works.length} HTTP${status} ${w.title}`);
      continue;
    }
    const title = (text.match(/<title>([^<]*)<\/title>/) || [])[1] || '';
    if (/已批阅/.test(title)) {
      console.log(`${i + 1}/${works.length} 已完成，跳过 ${w.title.slice(0, 20)}`);
      continue;
    }
    const questions = parseQuiz(text);
    const formTag = (text.match(/<form[^>]*id="form1"[^>]*>/i) || text.match(/<form[^>]*name="form1"[^>]*>/i) || [])[0] || '';
    const action = (formTag.match(/action="([^"]+)"/i) || [])[1] || '';
    const hidden = {};
    for (const hm of text.matchAll(/<input[^>]*type="hidden"[^>]*>/g)) {
      const nm = (hm[0].match(/name="([^"]+)"/) || [])[1];
      const vl = (hm[0].match(/value="([^"]*)"/) || [])[1] ?? '';
      if (nm) hidden[nm] = vl.replace(/&amp;/g, '&');
    }
    out.push({ index: out.length, work: w, action, pageUrl, hidden, questions });
    console.log(`${i + 1}/${works.length} ${questions.length}题 ${w.title.slice(0, 24)}`);
    await sleep(200);
  }
  fs.writeFileSync(`${STATE}/quizzes.json`, JSON.stringify(out, null, 2));
  // 可读版
  const lines = [];
  for (const q of out) {
    lines.push(`\n===== [${q.index}] ${q.work.title}（${q.questions.length}题）=====`);
    for (const x of q.questions) {
      lines.push(`\n${x.stem}  [${x.typeLabel} qid=${x.qid} ${x.score}分]`);
      x.options.forEach((o) => lines.push(`  ${o.value}. ${o.text}`));
    }
  }
  fs.writeFileSync(`${STATE}/quiz-readable.txt`, lines.join('\n'));
  console.log(`\n共 ${out.length} 份未完成测验，题目总数 ${out.reduce((a, q) => a + q.questions.length, 0)}`);
  console.log('已写 state/quizzes.json / state/quiz-readable.txt');
}

// ---------------- submit ----------------
async function submit() {
  const quizzes = JSON.parse(fs.readFileSync(`${STATE}/quizzes.json`, 'utf8'));
  const answersFile = `${STATE}/answers.json`;
  if (!fs.existsSync(answersFile)) {
    console.log('缺 state/answers.json（格式：{"<index>": {"<qid>": "A"}}）');
    return;
  }
  const answers = JSON.parse(fs.readFileSync(answersFile, 'utf8'));
  const only = argv.only !== undefined ? Number(argv.only) : null;
  const targets = only === null ? quizzes : quizzes.filter((q) => q.index === only);
  const results = [];
  for (const q of targets) {
    const ans = answers[q.index] || answers[String(q.index)];
    if (!ans || Object.keys(ans).length === 0) {
      console.log(`[${q.index}] 没有可作答题，跳过 ${q.work.title}`);
      results.push({ index: q.index, ok: false, reason: '无答案' });
      continue;
    }
    // 交出前先调 /work/validate（浏览器同款），拿 submitted enc
    let vEnc = '';
    try {
      const vu =
        `${SMART_ORIGIN}/mooc-ans/work/validate?classId=${CLAZZ_ID}&courseId=${getCourse().courseId}` +
        `&knowledgeId=${q.work.chapterId}&cpi=${CPI}`;
      const vr = await fetch(vu, {
        headers: { ...BROWSER_HEADERS, cookie: jar.header(vu), referer: q.pageUrl, 'x-requested-with': 'XMLHttpRequest' },
      });
      const vt = await vr.text();
      let vj = null;
      try { vj = JSON.parse(vt); } catch {}
      if (vj && vj.status === 1) { console.log(`[${q.index}] 账号异常，跳过`); continue; }
      vEnc = Array.isArray(vj) ? String(vj[0] ?? '') : '';
    } catch {}

    const body = new URLSearchParams();
    for (const [k, v] of Object.entries(q.hidden)) body.set(k, v);
    body.set('enc', vEnc);
    body.set('pyFlag', '');
    body.set('answerwqbid', q.questions.map((x) => x.qid).filter(Boolean).join(',') + ',');
    let filled = 0;
    for (const x of q.questions) {
      const v = ans[x.qid] ?? ans[String(x.qid)];
      if (v === undefined || v === null || v === '') continue;
      // 填空题（answertype=2）：浏览器端把每空内容拼成
      //   [{"content":"...","name":"1"},{"content":"...","name":"2"}]
      // 再写进 #answer<qid>；单写文本会导致「我的答案」空白、得 0 分
      if (x.qtype === 2 || x.typeLabel.includes('填空')) {
        const parts = Array.isArray(v) ? v : String(v).split(/\|\|/);
        const arr = parts.map((c, i) => ({ content: String(c), name: String(i + 1) }));
        body.set('answer' + x.qid, JSON.stringify(arr));
        parts.forEach((c, i) => body.set('answerEditor' + x.qid + (i + 1), String(c)));
      } else {
        body.set('answer' + x.qid, Array.isArray(v) ? v.join('') : String(v));
      }
      // 关键：answertype 必须沿用页面里的隐藏域（填空=2、单选=0、多选=1、判断=3），
      // 不能用自己的题型推断覆盖，否则服务端会按错误题型解析答案
      if (!body.has('answertype' + x.qid)) body.set('answertype' + x.qid, String(x.qtype));
      filled++;
    }
    let url = q.pageUrl ? new URL(q.action, q.pageUrl).toString() : abs(q.action);
    // 页面里 action 是相对路径，浏览器由 version() 修正到 /mooc-ans/work/ 下
    url = url.replace('/mooc-ans/api/addStudentWorkNewWeb', '/mooc-ans/work/addStudentWorkNewWeb');
    url += '&ua=pc&formType=post&saveStatus=1&pos=&version=1';
    let resp;
    try {
      const r = await fetch(url, {
        method: 'POST',
        headers: {
          ...BROWSER_HEADERS,
          cookie: jar.header(url),
          'content-type': 'application/x-www-form-urlencoded; charset=UTF-8',
          'x-requested-with': 'XMLHttpRequest',
          referer: q.pageUrl || `${SMART_ORIGIN}/ananas/modules/work/index.html?v=1`,
          origin: SMART_ORIGIN,
        },
        body: body.toString(),
      });
      const text = await r.text();
      let data = null;
      try {
        data = JSON.parse(text);
      } catch {}
      resp = { status: r.status, data, text: text.slice(0, 200) };
    } catch (e) {
      resp = { status: -1, err: String(e).slice(0, 120) };
    }
    const ok = resp.data?.status === true;
    console.log(`[${q.index}] 填 ${filled}/${q.questions.length} 题 -> HTTP${resp.status} status=${resp.data?.status} msg=${resp.data?.msg || ''}`);
    results.push({ index: q.index, ok, filled, resp });
    await sleep(1500);
  }
  fs.writeFileSync(`${STATE}/quiz-submit-result.json`, JSON.stringify(results, null, 2));
  console.log(`\n提交 ${results.filter((r) => r.ok).length}/${results.length} 成功`);
}

import path from 'node:path';
import { pathToFileURL } from 'node:url';
const isMain = process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url;
if (isMain) {
  if (mode === 'dump') { requireTarget(); ensureSession(); await dump(); }
  else if (mode === 'submit') { requireTarget(); ensureSession(); await submit(); }
  else if (mode === 'peek') { requireTarget(); ensureSession(); await peek(Number(argv.only || 0)); }
  else if (mode === 'bank') {
    const { loadBank, saveBank, BANK_FILE_PATH } = await import('./lib/bank.mjs');
    if (argv.clear !== undefined || process.argv.includes('--clear') || process.argv.includes('-c')) {
      saveBank({});
      console.log('题库缓存已清空');
    } else {
      const b = loadBank();
      const n = Object.keys(b).length;
      if (!n) {
        console.log('题库为空，跑 node src/quiz.mjs solve 会自动积累');
      } else {
        const count = {};
        for (const e of Object.values(b)) count[e.kind] = (count[e.kind] || 0) + 1;
        console.log(`题库共 ${n} 题  ${BANK_FILE_PATH}`);
        for (const k of ['choice', 'multi', 'judge', 'fill', 'essay']) {
          if (count[k]) console.log(`  ${k.padEnd(7)} ${count[k]}`);
        }
        console.log('');
        console.log('清空: node src/quiz.mjs bank --clear    跳过缓存: node src/quiz.mjs solve --no-cache');
      }
    }
  }
  else if (mode === 'solve') {
    const { runSolve } = await import('./solve.mjs');
    try {
      await runSolve();
    } catch (e) {
      console.error('hsc:', e.message || e);
      process.exit(1);
    }
  } else console.log('用法: node src/quiz.mjs dump | solve | submit [--only=N] | peek --only=N | bank [--clear]');
}
