// 共享常量与状态目录（无顶层副作用，可被任意模块安全 import）
import path from 'node:path';
import fs from 'node:fs';

export const ROOT = path.resolve(import.meta.dirname, '..', '..');
export const STATE = path.join(ROOT, 'state');
export const COOKIES = path.join(STATE, 'cookies.json');

export const SMART_ORIGIN = 'https://smartcourse.hust.edu.cn';
export const BASE = `${SMART_ORIGIN}/mooc-smartcourse`;

// 目标课程从 state/target.json 读取（示例见 config/target.example.json）
// 注意：这里**不再直接退出进程** —— 登录、退出登录等操作并不需要课程配置。
// 需要课程的脚本请调用 requireTarget()。
const targetFile = path.join(STATE, 'target.json');
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
  console.error(`缺少课程配置：${targetFile}`);
  console.error('请复制 config/target.example.json 到 state/target.json 并填入 courseId / clazzId');
  process.exit(2);
}

export function ensureState() {
  fs.mkdirSync(STATE, { recursive: true });
}
