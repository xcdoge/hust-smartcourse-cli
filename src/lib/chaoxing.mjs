// 超星泛雅（HUST 部署）播放器协议客户端
// 协议来源：/ananas/modules/video/index.js + /ananas/videojs-ext/videojs-ext.min.js（已反混淆）
import crypto from 'node:crypto';
import { httpGet } from './http.mjs';

export const LOG_SALT = 'd_yHJ!$pdA~5';

export function md5(s) {
  return crypto.createHash('md5').update(String(s), 'utf8').digest('hex');
}

/** 宽松解析：服务端有时返回 `var d={...}` 而不是纯 JSON */
export function looseJson(text) {
  const t = String(text).trim();
  const tryParse = (s) => {
    try {
      return JSON.parse(s);
    } catch {
      return null;
    }
  };
  const direct = tryParse(t);
  if (direct) return direct;
  const i = t.indexOf('=');
  const j = t.indexOf('{');
  if (j >= 0) {
    const v = tryParse(t.slice(j));
    if (v) return v;
  }
  if (i >= 0) {
    const v = tryParse(t.slice(i + 1));
    if (v) return v;
  }
  return null;
}

/**
 * 视频任务点元信息
 * GET /ananas/status/{objectid}?k={fid}&flag=normal&ro=0
 * 返回 {status:'success', duration, dtoken, reportUrl, rt, filename, ...}
 */
export async function videoStatus(jar, base, objectid, fid = '') {
  const url = `${base}/ananas/status/${objectid}?k=${encodeURIComponent(fid)}&flag=normal&ro=0`;
  const res = await httpGet(url, jar, { headers: { 'x-requested-with': 'XMLHttpRequest' } });
  const text = await res.text();
  const data = looseJson(text);
  return { status: res.status, data, text };
}

/**
 * 组装播放日志上报 URL（与浏览器端逐字段一致）
 * enc = md5(`[clazzId][userid][jobid][objectId][playingTimeMs][salt][duration*1000][clipTime]`)
 */
export function buildLogUrl(p) {
  const {
    reportUrl,
    dtoken,
    clazzId,
    objectId,
    jobId = '',
    userId,
    duration, // 秒
    playingTime, // 秒（可为小数）
    clipTime, // `${startTime}_${endTime}`
    otherInfo = '',
    isdrag = 0,
    rt = 0.9,
    videoFaceCaptureEnc = '',
    attDuration = '',
    attDurationEnc = '',
    isEngineNode = false,
    dtype = 'Video',
    now = Date.now(),
  } = p;

  const playingMs = Math.round(Number(playingTime) * 1000);
  const encSrc =
    `[${clazzId}]` +
    `[${userId}]` +
    `[${jobId || ''}]` +
    `[${objectId}]` +
    `[${playingMs}]` +
    `[${LOG_SALT}]` +
    `[${Math.round(Number(duration) * 1000)}]` +
    `[${clipTime}]`;

  const qs =
    `?clazzId=${clazzId}` +
    `&playingTime=${playingTime}` +
    `&duration=${duration}` +
    `&clipTime=${encodeURIComponent(clipTime)}` +
    `&objectId=${objectId}` +
    `&otherInfo=${otherInfo}` +
    `&jobid=${jobId || ''}` +
    `&userid=${userId}` +
    `&isdrag=${isdrag}` +
    `&view=pc` +
    `&enc=${md5(encSrc)}` +
    `&rt=${rt}` +
    `&videoFaceCaptureEnc=${videoFaceCaptureEnc}` +
    `&dtype=${dtype}` +
    `&_t=${now}` +
    `&attDuration=${attDuration}` +
    `&attDurationEnc=${attDurationEnc}` +
    `&courseEngineInfo=${isEngineNode}`;

  return { url: `${reportUrl}/${dtoken}${qs}`, encSrc, enc: md5(encSrc) };
}

/** 上报一次播放进度，返回 {ok,isPassed,msg,raw} */
export async function reportLog(jar, params) {
  const { url } = buildLogUrl(params);
  const res = await httpGet(url, jar, {
    headers: {
      'x-requested-with': 'XMLHttpRequest',
      accept: '*/*',
      referer: params.referer || undefined,
    },
  });
  const text = await res.text();
  const data = looseJson(text);
  return {
    ok: res.status === 200 && !!(data && (data.isPassed !== undefined || data.status !== false)),
    status: res.status,
    isPassed: data?.isPassed,
    msg: data?.msg || data?.message || '',
    raw: text.slice(0, 300),
    url,
  };
}
