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
  console.log('✔ 已生成 state/target.json（还是空的，需要你填）\n');
  console.log('两种填法：');
  console.log('  ① 直接把课程链接丢给它，自动解析：');
  console.log('     node src/init.mjs "https://smartcourse.hust.edu.cn/...?courseid=...&clazzid=...&cpi=..."');
  console.log('  ② 手动编辑 state/target.json');
  console.log('\n这些参数都在浏览器打开课程时的地址栏里。');
} else {
  console.log('✔ 已写入 state/target.json');
  console.log(`  courseId = ${target.courseId}`);
  console.log(`  clazzId  = ${target.clazzId}`);
  console.log(`  cpi      = ${target.cpi || '(空)'}`);
  console.log('\n下一步：node src/course.mjs  然后 node src/scan.mjs');
}
