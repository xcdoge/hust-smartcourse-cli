// 生成 state/target.json
//   node src/init.mjs                     写模板，提示手动填
//   node src/init.mjs "<课程链接>"        从 URL 自动解析
//   node src/init.mjs --courseid=X --clazzid=Y --cpi=Z [--enc=W]
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const STATE = path.join(ROOT, 'state');
fs.mkdirSync(STATE, { recursive: true });

const target = { name: '', courseId: '', clazzId: '', cpi: '', enc: '' };

for (const a of process.argv.slice(2)) {
  if (a.startsWith('http://') || a.startsWith('https://')) {
    const q = new URL(a).searchParams;
    target.courseId = q.get('courseid') || q.get('courseId') || '';
    target.clazzId = q.get('clazzid') || q.get('clazzId') || '';
    target.cpi = q.get('cpi') || '';
    target.enc = q.get('enc') || '';
    continue;
  }
  for (const [prefix, field] of [
    ['--courseid=', 'courseId'],
    ['--clazzid=', 'clazzId'],
    ['--cpi=', 'cpi'],
    ['--enc=', 'enc'],
    ['--name=', 'name'],
  ]) {
    if (a.startsWith(prefix)) target[field] = a.slice(prefix.length);
  }
}

fs.writeFileSync(path.join(STATE, 'target.json'), JSON.stringify(target, null, 2));

if (!target.courseId || !target.clazzId) {
  console.log('state/target.json 已生成，courseId / clazzId 为空\n');
  console.log('补全方式：');
  console.log('  node src/init.mjs "<课程链接>"');
  console.log('  node src/init.mjs --courseid=... --clazzid=... --cpi=... --enc=...');
  console.log('\n参数取自浏览器地址栏。');
} else {
  console.log('state/target.json 已写入');
  console.log(`  courseId = ${target.courseId}`);
  console.log(`  clazzId  = ${target.clazzId}`);
  console.log(`  cpi      = ${target.cpi || '(空)'}`);
  console.log('\n下一步：node src/course.mjs  然后 node src/scan.mjs');
}
