// 视频任务点播放 CLI
//   node src/play.mjs --objectid=123456 --jobid=789 [--speed=1.5] [--tick=15] [--dry]
//   node src/play.mjs --all [--speed=1.5]
import fs from 'node:fs';
import { CookieJar } from './lib/http.mjs';
import { COOKIES, STATE, CLAZZ_ID, requireTarget, stateFile} from './lib/const.mjs';
import { playVideo, DEFAULT_BASE } from './lib/player.mjs';


// --id=N：先切课程再重放自身（const.mjs 在 import 时读 target，必须换进程）
import { maybeHelp } from './lib/help.mjs';
maybeHelp('play');

const __idArg = process.argv.slice(2).find((a) => a.startsWith('--id='));
if (__idArg) {
  const { switchCourse } = await import('./lib/courses.mjs');
  await switchCourse(Number(__idArg.slice(5)));
  const { spawnSync } = await import('node:child_process');
  const rest = process.argv.slice(2).filter((a) => !a.startsWith('--id='));
  const r = spawnSync(process.execPath, [process.argv[1], ...rest], { stdio: 'inherit' });
  process.exit(r.status ?? 0);
}


requireTarget();
const argv = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, v = 'true'] = a.replace(/^--/, '').split('=');
    return [k, v];
  })
);

const ts = () => new Date().toISOString().slice(11, 19);
const LOGFILE = `stateFile('play.log')`;
const log = (...a) => {
  const line = `[${ts()}] ${a.join(' ')}`;
  console.log(line);
  try {
    fs.appendFileSync(LOGFILE, line + String.fromCharCode(10));
  } catch {}
};

if (!fs.existsSync(COOKIES)) {
  console.log('没有 state/cookies.json，先跑 node src/import-cookies.mjs');
  process.exit(1);
}
const jar = new CookieJar();
jar.load(JSON.parse(fs.readFileSync(COOKIES, 'utf8')));

let points = [];
if (argv.all === 'true') {
  const f = `stateFile('course.json')`;
  if (!fs.existsSync(f)) {
    console.log('没有 state/course.json，先跑 node src/course.mjs');
    process.exit(1);
  }
  const c = JSON.parse(fs.readFileSync(f, 'utf8'));
  points = (c.points || []).filter((p) => (argv.force === 'true' ? true : !p.isPassed));
  if (points.length === 0) {
    console.log('没有待处理的任务点（全部已通过？加 --force 重刷）');
    process.exit(0);
  }
  if (argv.limit) points = points.slice(0, Number(argv.limit));
  const total = points.reduce((a, p) => a + (p.attDuration || 0), 0);
  log(`待处理 ${points.length} 个，合计 ${(total / 3600).toFixed(2)} 小时`);
} else if (argv.objectid) {
  // 允许直接从 course.json 里按 objectId 找完整参数
  let meta = { objectid: argv.objectid, jobid: argv.jobid };
  const f = `stateFile('course.json')`;
  if (fs.existsSync(f)) {
    const c = JSON.parse(fs.readFileSync(f, 'utf8'));
    const hit = (c.points || []).find((p) => p.objectId === argv.objectid);
    if (hit) meta = { ...hit, objectid: hit.objectId, objectidRaw: hit.objectId };
  }
  points = [{ ...meta, objectid: argv.objectid, jobid: argv.jobid || meta.jobid }];
}
if (points.length === 0) {
  console.log('用法: node src/play.mjs --objectid=xxx [--jobid=yyy] [--speed=1.5] [--dry] | --all');
  process.exit(1);
}

const opts = {
  base: process.env.CX_BASE || DEFAULT_BASE,
  clazzId: CLAZZ_ID,
  speed: Number(argv.speed || 1.5),
  tickSec: Number(argv.tick || 15),
  dry: argv.dry === 'true',
  jump: argv.jump === 'true',
  logger: log,
};

log(`共 ${points.length} 个任务点，倍速 ${opts.speed}，每 ${opts.tickSec}s 上报一次${opts.dry ? '（dry-run）' : ''}`);
const results = [];
for (const p of points) {
  try {
    results.push({ ...p, ...(await playVideo(jar, p, opts)) });
  } catch (e) {
    log('异常', String(e).slice(0, 200));
    results.push({ ...p, ok: false, reason: String(e).slice(0, 200) });
  }
}
log('汇总:', results.map((r) => `${r.objectId || r.objectid || '?'}:${r.ok ? 'ok' : 'fail'}`).join(' '));
const failed = results.filter((r) => !r.ok);
if (failed.length) {
  log('失败明细:');
  for (const f of failed) log(`  ${f.objectId || f.objectid} -> ${f.reason}`);
}
