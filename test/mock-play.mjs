// 端到端 mock 测试：本地假服务端模拟 /ananas/status 与日志上报，验证播放核心能正确推进到 isPassed
//   node test/mock-play.mjs
import http from 'node:http';
import { CookieJar } from '../src/lib/http.mjs';
import { playVideo } from '../src/lib/player.mjs';
import { md5, LOG_SALT } from '../src/lib/chaoxing.mjs';

const DURATION = 60;
const CLAZZ = '10000000000001';
const OBJ = '999888777';
const JOB = '666555';
const UID = '10000001';
const DTOKEN = 'DT-test-token';

const received = [];
let passed = false;

const server = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://127.0.0.1');
  if (u.pathname.startsWith('/ananas/status/')) {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(
      JSON.stringify({
        status: 'success',
        duration: DURATION,
        dtoken: DTOKEN,
        reportUrl: `http://127.0.0.1:${port}/multimedia/log/a`,
        rt: 0.9,
        isPassed: false,
      })
    );
    return;
  }
  if (u.pathname === `/multimedia/log/a/${DTOKEN}`) {
    const q = u.searchParams;
    received.push(Object.fromEntries(q));
    // 校验 enc 签名
    const playingMs = Math.round(Number(q.get('playingTime')) * 1000);
    const expect = md5(
      `[${q.get('clazzId')}][${q.get('userid')}][${q.get('jobid')}][${q.get('objectId')}][${playingMs}][${LOG_SALT}][${Math.round(DURATION * 1000)}][${q.get('clipTime')}]`
    );
    const encOk = expect === q.get('enc');
    if (!encOk) {
      res.writeHead(200, { 'content-type': 'text/plain' });
      res.end('var d={"isPassed":false,"msg":"bad enc"}');
      return;
    }
    if (Number(q.get('playingTime')) >= DURATION * 0.95) passed = true;
    res.writeHead(200, { 'content-type': 'text/plain' });
    res.end(`var d={"isPassed":${passed},"msg":"${passed ? 'success' : 'ok'}"}`);
    return;
  }
  res.writeHead(404);
  res.end('no');
});

const port = await new Promise((r) => {
  server.listen(0, '127.0.0.1', () => r(server.address().port));
});
console.log('mock 服务端端口', port);

const jar = new CookieJar();
jar.load({ 'smartcourse.hust.edu.cn': { _uid: UID, fid: '1731' } });

const t0 = Date.now();
const ret = await playVideo(jar, { objectid: OBJ, jobid: JOB }, {
  base: `http://127.0.0.1:${port}`,
  clazzId: CLAZZ,
  speed: 20,
  tickSec: 0.02,
  logger: (m) => console.log('  ', m),
});
const ms = Date.now() - t0;
server.close();

console.log('\n结果:', JSON.stringify(ret));
console.log('上报次数:', received.length, '耗时', ms, 'ms');
console.log('首次上报参数:', JSON.stringify(received[0]));
console.log('末次上报参数:', JSON.stringify(received.at(-1)));

const ok =
  ret.ok === true &&
  received.length > 0 &&
  received.every((q) => q.dtype === 'Video' && q.view === 'pc' && q.isdrag === '0' && q.enc) &&
  received.at(-1).playingTime === String(DURATION * 0.95 > DURATION ? DURATION : DURATION) ||
  Number(received.at(-1).playingTime) >= DURATION * 0.95;
console.log(ok ? '\n✔ mock 测试通过' : '\n✘ mock 测试失败');
process.exit(ok ? 0 : 1);
