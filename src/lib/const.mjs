// 共享常量与状态目录（无顶层副作用，可被任意模块安全 import）
import path from 'node:path';
import fs from 'node:fs';

export const ROOT = path.resolve(import.meta.dirname, '..', '..');
export const STATE = path.join(ROOT, 'state');

// state/ 下按用途分子目录，避免十几个文件平铺
const LAYOUT = {
  'cookies.json': 'auth',
  'cred.enc.json': 'auth',
  'cred.txt': 'auth',
  'visitor.json': 'auth',
  'login-qr.png': 'auth',
  'target.json': 'course',
  'courses.json': 'course',
  'course.json': 'course',
  'scan.json': 'course',
  'quizzes.json': 'quiz',
  'answers.json': 'quiz',
  'qbank.json': 'quiz',
  'quiz-readable.txt': 'quiz',
  'play.log': 'logs',
  'config.toml': '',
};

/** state 下某个文件的完整路径（自动落到子目录） */
export function stateFile(name) {
  const sub = LAYOUT[name] || '';
  return sub ? path.join(STATE, sub, name) : path.join(STATE, name);
}

// 把旧版平铺的文件搬进子目录
try {
  for (const [name, sub] of Object.entries(LAYOUT)) {
    if (!sub) continue;
    const oldPath = path.join(STATE, name);
    const newPath = path.join(STATE, sub, name);
    if (fs.existsSync(oldPath) && !fs.existsSync(newPath)) {
      fs.mkdirSync(path.join(STATE, sub), { recursive: true });
      fs.renameSync(oldPath, newPath);
    }
  }
} catch {}

export const COOKIES = stateFile('cookies.json');

export const SMART_ORIGIN = 'https://smartcourse.hust.edu.cn';
export const BASE = `${SMART_ORIGIN}/mooc-smartcourse`;

// 目标课程从 state/target.json 读取（示例见 config/target.example.json）
// 注意：这里**不再直接退出进程** —— 登录、退出登录等操作并不需要课程配置。
// 需要课程的脚本请调用 requireTarget()。
const targetFile = stateFile('target.json');
let target = {};
try {
  target = JSON.parse(fs.readFileSync(targetFile, 'utf8'));
} catch {
  target = {};
}

export const HAS_TARGET = Boolean(target && target.courseId && target.clazzId);
export const TARGET = target;
export const COURSE_ID = String(target.courseId || '');
export const CLAZZ_ID = String(target.clazzId || '');
export const CPI = String(target.cpi || '');
export const ENC = String(target.enc || '');

export const COURSE_URL =
  `${SMART_ORIGIN}/mooc-smartcourse/mooc2-ans/mooc2-ans/mycourse/stu` +
  `?courseid=${COURSE_ID}&clazzid=${CLAZZ_ID}&cpi=${CPI}&enc=${ENC}` +
  `&pageHeader=1&v=0&hideHead=0`;

/** 需要课程配置的脚本在开头调这个 */
export function requireTarget() {
  if (HAS_TARGET) return TARGET;

  console.error('未配置课程，先执行: node src/init.mjs "<课程链接>"');
  process.exit(2);
}

export function ensureState() {
  fs.mkdirSync(STATE, { recursive: true });
}
