// 批量抓取 CAS 验证码，用于重建数字码本
//   node probe/harvest-captcha.mjs [数量]
import fs from 'node:fs';
import { CookieJar, httpGet, follow } from '../src/lib/http.mjs';

const CAS = 'https://pass.hust.edu.cn/cas';
const N = Number(process.argv[2] || 40);
const DIR = 'state/captchas';
fs.mkdirSync(DIR, { recursive: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let ok = 0;
for (let i = 0; i < N; i++) {
  try {
    const jar = new CookieJar();
    await follow(`${CAS}/login`, jar); // 建会话
    const cap = await httpGet(`${CAS}/code`, jar);
    const buf = Buffer.from(await cap.arrayBuffer());
    const isGif = buf.slice(0, 3).toString('ascii') === 'GIF';
    if (!isGif || buf.length < 500) {
      console.log(`  ${i + 1}/${N} 非 GIF (${buf.length} 字节)`);
      continue;
    }
    fs.writeFileSync(`${DIR}/cap-${String(i + 1).padStart(3, '0')}.gif`, buf);
    ok++;
  } catch (e) {
    console.log(`  ${i + 1}/${N} 异常 ${String(e).slice(0, 60)}`);
  }
  if ((i + 1) % 10 === 0) console.log(`  已抓 ${i + 1}/${N}`);
  await sleep(250);
}
console.log(`完成：${ok}/${N} 张 -> ${DIR}`);
