// 共享常量与状态目录（无顶层副作用，可被任意模块安全 import）
import path from 'node:path';
import fs from 'node:fs';

export const ROOT = path.resolve(import.meta.dirname, '..', '..');
export const STATE = path.join(ROOT, 'state');
export const COOKIES = path.join(STATE, 'cookies.json');

export const SMART_ORIGIN = 'https://smartcourse.hust.edu.cn';
export const BASE = `${SMART_ORIGIN}/mooc-smartcourse`;

// 目标课程从 state/target.json 读取（示例见 config/target.example.json）
const targetFile = path.join(STATE, 'target.json');
if (!fs.existsSync(targetFile)) {
  console.error(`缺少课程配置：${targetFile}`);
  console.error('请复制 config/target.example.json 到 state/target.json 并填入 courseId / clazzId');
  process.exit(2);
}
const target = JSON.parse(fs.readFileSync(targetFile, 'utf8'));

export const TARGET = target;
export const COURSE_ID = String(target.courseId);
export const CLAZZ_ID = String(target.clazzId);
export const CPI = String(target.cpi || '');
export const ENC = String(target.enc || '');

export const COURSE_URL =
  `${SMART_ORIGIN}/mooc-smartcourse/mooc2-ans/mooc2-ans/mycourse/stu` +
  `?courseid=${COURSE_ID}&clazzid=${CLAZZ_ID}&cpi=${CPI}&enc=${ENC}` +
  `&pageHeader=1&v=0&hideHead=0`;

export function ensureState() {
  fs.mkdirSync(STATE, { recursive: true });
}
