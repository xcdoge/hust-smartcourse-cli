// 选课
//   node src/init.mjs            列出账号下所有课程
//   node src/init.mjs <序号>      选第 N 门课
//   node src/init.mjs "<课程链接>" 从 URL 解析参数
//   node src/init.mjs --refresh  强制重新拉课程列表
import fs from 'node:fs';
import path from 'node:path';
import { loadCourseList, switchCourse, printCourseList } from './lib/courses.mjs';

import { maybeHelp } from './lib/help.mjs';
maybeHelp('init');

const ROOT = path.resolve(import.meta.dirname, '..');
const STATE = path.join(ROOT, 'state');
fs.mkdirSync(STATE, { recursive: true });

const args = process.argv.slice(2);
const refresh = args.includes('--refresh') || args.includes('-r');
const positional = args.filter((a) => !a.startsWith('-'));

function currentCourseId() {
  try {
    return JSON.parse(fs.readFileSync(path.join(STATE, 'target.json'), 'utf8')).courseId || '';
  } catch {
    return '';
  }
}

const first = positional[0];

if (first && (first.startsWith('http://') || first.startsWith('https://'))) {
  const q = new URL(first).searchParams;
  const target = {
    name: '',
    courseId: q.get('courseid') || q.get('courseId') || '',
    clazzId: q.get('clazzid') || q.get('clazzId') || '',
    cpi: q.get('cpi') || '',
    enc: q.get('enc') || '',
  };
  if (!target.courseId || !target.clazzId) throw new Error('链接里没有 courseid / clazzid');
  fs.writeFileSync(path.join(STATE, 'target.json'), JSON.stringify(target, null, 2));
  console.log(`已选择课程\n  courseId = ${target.courseId}\n  clazzId  = ${target.clazzId}\n  cpi      = ${target.cpi || '-'}`);
  console.log('\n接下来: node src/course.mjs');
} else if (first) {
  const n = Number(first);
  if (!Number.isInteger(n) || n < 1) throw new Error(`参数 ${first} 既不是序号也不是课程链接`);
  await switchCourse(n);
  // 切完课顺手抓结构 + 扫描，免得用户忘了跑 scan 导致后续拿到 403
  const { spawnSync } = await import('node:child_process');
  const run = (script) => {
    const r = spawnSync(process.execPath, [path.join(import.meta.dirname, script)], { stdio: 'inherit' });
    return r.status === 0;
  };
  run('course.mjs');
  if (!args.includes('--no-scan')) run('scan.mjs');
} else {
  // 现拉：缓存顺序可能过期，紧接着选课会刷新，两边不一致就会切错课
  const list = await loadCourseList(true);
  void refresh;
  console.log(`共 ${list.length} 门课程\n`);
  printCourseList(list, currentCourseId());
  console.log('\n选课: node src/init.mjs <序号>    重新拉列表: node src/init.mjs --refresh');
}
