// 视频任务点播放核心（可注入 base，便于用 mock 服务端测试）
import { videoStatus, reportLog, buildLogUrl } from './chaoxing.mjs';

export const DEFAULT_BASE = 'https://smartcourse.hust.edu.cn/mooc-smartcourse';

export function fidFromJar(jar) {
  for (const m of Object.values(jar.toJSON())) if (m.fid) return m.fid;
  return '';
}

export function uidFromJar(jar) {
  for (const m of Object.values(jar.toJSON())) {
    if (m._uid) return m._uid;
    if (m.UID) return m.UID;
    if (m.uid) return m.uid;
  }
  return '';
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * 播一个任务点。
 * @param jar CookieJar
 * @param point {objectid, jobid}
 * @param opts {base, clazzId, speed, tickSec, dry, logger, maxRounds}
 * @returns {ok, reason, rounds, duration}
 */
export async function playVideo(jar, point, opts = {}) {
  const base = opts.base || DEFAULT_BASE;
  const clazzId = opts.clazzId;
  const speed = Number(opts.speed ?? 1.5);
  const tickSec = Number(opts.tickSec ?? 15);
  const dry = !!opts.dry;
  const maxRounds = Number(opts.maxRounds ?? 20000);
  const log = opts.logger || (() => {});

  const objectId = String(point.objectid ?? point.objectId ?? '');
  const jobId = String(point.jobid ?? point.jobId ?? '');
  const userId = uidFromJar(jar);
  if (!objectId) return { ok: false, reason: '缺少 objectid' };

  log(`objectid=${objectId} jobid=${jobId || '-'} uid=${userId}`);
  const st = await videoStatus(jar, base, objectId, fidFromJar(jar));
  log(`  status ${st.status} ${JSON.stringify(st.data ?? st.text).slice(0, 240)}`);
  if (!st.data || st.data.status === 'fail') return { ok: false, reason: '拿不到视频信息', status: st.status };

  const duration = Number(st.data.duration || point.attDuration || 0);
  const dtoken = st.data.dtoken;
  // reportUrl 来自卡片页 mArg.defaults.reportUrl；status 里没有
  const reportUrl = point.reportUrl || st.data.reportUrl;
  if (!reportUrl || !dtoken || !duration) {
    return { ok: false, reason: `缺少字段 reportUrl=${!!reportUrl} dtoken=${!!dtoken} duration=${duration}` };
  }
  log(`  时长 ${duration}s reportUrl=${reportUrl} dtoken=${String(dtoken).slice(0, 14)}…`);
  if (st.data.isPassed === true || point.isPassed === true) return { ok: true, reason: '服务端已通过', duration };

  const begins = Number(point.begins ?? 0);
  const ends = Number(point.ends ?? 0);
  const common = {
    reportUrl,
    dtoken,
    clazzId: st.data.clazzId || clazzId,
    objectId,
    jobId,
    userId,
    duration,
    clipTime: `${begins}_${ends || duration}`,
    otherInfo: point.otherInfo ?? '',
    // rt 必须与课程一致：otherInfo 里的 rt_d = 默认 0.9，rt_1 = 1 倍速课程（不一致会被判 403 code=6）
    rt: (() => {
      const mm = /rt_([0-9.]+|d)/.exec(point.otherInfo || '');
      if (mm) return mm[1] === 'd' ? 0.9 : Number(mm[1]);
      return st.data.rt ?? point.rt ?? 0.9;
    })(),
    videoFaceCaptureEnc: point.videoFaceCaptureEnc ?? '',
    attDuration: point.attDuration ?? '',
    attDurationEnc: point.attDurationEnc ?? '',
  };

  if (dry) {
    log('  [dry] ' + buildLogUrl({ ...common, playingTime: 0 }).url.slice(0, 240));
    return { ok: false, reason: 'dry-run', duration };
  }

  // --jump：直接报到 95%（服务端不校验节奏，但学校的播放行为分析可能标记异常）
  if (opts.jump) {
    const t = Math.round(duration * 0.95);
    const r = await reportLog(jar, { ...common, playingTime: t });
    log(`  [jump] playingTime=${t}/${duration}s -> ${r.status} isPassed=${r.isPassed}`);
    return { ok: r.isPassed === true, reason: r.isPassed ? 'jump isPassed' : 'jump 未通过', duration, rounds: 1 };
  }

  // 超星只在 90%~98% 区间判「完成」，报满 100% 会被判无效，所以终点钳在 95%
  // 经验值：报到 `duration-2` 判过；报满 100% 反而判无效
  const target = Math.max(1, duration > 6 ? duration - 2 : Math.ceil(duration * 0.95));
  let playing = 0;
  for (let round = 1; round <= maxRounds; round++) {
    playing = Math.min(target, playing + tickSec * speed);
    const rounded = Math.round(playing * 10) / 10;
    let r;
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        r = await reportLog(jar, { ...common, playingTime: rounded });
        break;
      } catch (e) {
        log(`  上报异常(第${attempt}次) ${String(e).slice(0, 100)}`);
        if (attempt === 3) throw e;
        await sleep(3000);
      }
    }
    log(`  第${round}次 playingTime=${rounded}/${duration}s -> ${r.status} isPassed=${r.isPassed} ${r.msg || ''}`);
    if (r.isPassed === true) return { ok: true, reason: 'isPassed', duration, rounds: round };
    if (playing >= target) {
      // 边界可能差 1~2 秒，逐档补报
      for (const frac of [0.95, 0.96, 0.97, 0.98]) {
        const t = Math.min(duration - 2, Math.ceil(duration * frac));
        if (t >= duration) continue;
        const rr = await reportLog(jar, { ...common, playingTime: t });
        log(`  补报 ${t}/${duration}s（${Math.round(frac * 100)}%） -> isPassed=${rr.isPassed} ${rr.msg || ''}`);
        if (rr.isPassed === true) return { ok: true, reason: 'isPassed(补报)', duration, rounds: round };
        await sleep(1200);
      }
      // 同一 dtoken 连跳会被限流：换新 token、间隔重试
      for (let k = 0; k < 4; k++) {
        await sleep(4000);
        try {
          const st2 = await videoStatus(jar, base, objectId, fidFromJar(jar));
          if (st2.data?.isPassed === true) return { ok: true, reason: 'isPassed(新token)', duration, rounds: round };
          if (!st2.data?.dtoken) continue;
          const t = Math.ceil(duration * 0.97);
          const rr = await reportLog(jar, { ...common, dtoken: st2.data.dtoken, playingTime: t });
          log(`  换token重报 ${t}/${duration}s -> isPassed=${rr.isPassed}`);
          if (rr.isPassed === true) return { ok: true, reason: 'isPassed(换token)', duration, rounds: round };
        } catch (e) {
          log('  重试异常', String(e).slice(0, 80));
        }
      }
      return { ok: false, reason: '多档补报+换token仍未通过', duration, rounds: round };
    }
    await sleep(tickSec * 1000);
  }
  return { ok: false, reason: '超过最大轮数', duration };
}
