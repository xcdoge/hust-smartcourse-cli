// 会话校验：用「章节列表页」判断（课程首页现在只是一个 JS 壳，长度不可靠）
import fs from 'node:fs';
import { CookieJar, follow } from './http.mjs';
import { COOKIES, BASE, COURSE_ID, CLAZZ_ID } from './const.mjs';

export async function verify(jar) {
  const url = `${BASE}/mooc2-ans/mycourse/studentcourse?courseid=${COURSE_ID}&clazzid=${CLAZZ_ID}`;
  const { res, url: finalUrl } = await follow(url, jar);
  let html = '';
  try {
    html = await res.text();
  } catch {}
  const toLogin = /passport-smartcourse\/login|pass\.hust\.edu\.cn\/cas|passport2\.chaoxing\.com/.test(finalUrl);
  const toLogout = /\/logout/.test(finalUrl);
  const chapters = (html.match(/toOld\(/g) || []).length;
  return {
    ok: !toLogin && !toLogout && res.status === 200 && chapters > 0,
    url: finalUrl,
    status: res.status,
    len: html.length,
    chapters,
    reason: toLogin
      ? '打回 CAS 登录'
      : toLogout
        ? '被门户判定已登出(/logout)'
        : chapters === 0
          ? '章节页无章节内容'
          : 'ok',
    html,
  };
}

export function loadJar() {
  const jar = new CookieJar();
  jar.load(JSON.parse(fs.readFileSync(COOKIES, 'utf8')));
  return jar;
}

export function saveJar(jar) {
  fs.writeFileSync(COOKIES, JSON.stringify(jar.toJSON(), null, 2));
}
