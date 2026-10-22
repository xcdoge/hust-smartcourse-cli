// 从 cards 页面里抽出 mArg（含 attachments 任务点数组）
import fs from 'node:fs';

export function braceMatch(text, startIdx) {
  let depth = 0;
  let i = startIdx;
  let inStr = null;
  while (i < text.length) {
    const c = text[i];
    if (inStr) {
      if (c === '\\') {
        i += 2;
        continue;
      }
      if (c === inStr) inStr = null;
      i++;
      continue;
    }
    if (c === '"' || c === "'") {
      inStr = c;
      i++;
      continue;
    }
    if (c === '{') depth++;
    else if (c === '}') {
      depth--;
      if (depth === 0) return i;
    }
    i++;
  }
  return -1;
}

export function extractMarg(html) {
  const m = html.match(/mArg\s*=\s*\{/);
  if (!m) return null;
  const start = html.indexOf('{', m.index);
  const end = braceMatch(html, start);
  if (end < 0) return null;
  let raw = html.slice(start, end + 1);
  // 页面里的 JSON 可能含未转义的控制字符，做一次宽松修正
  try {
    return JSON.parse(raw);
  } catch {
    raw = raw.replace(/[\u0000-\u001f]+/g, ' ');
    try {
      return JSON.parse(raw);
    } catch {
      return { __raw: raw.slice(0, 2000) };
    }
  }
}

if (process.argv[2]) {
  const html = fs.readFileSync(process.argv[2], 'utf8');
  const mArg = extractMarg(html);
  if (!mArg) {
    console.log('没找到 mArg');
  } else {
    console.log('顶层字段:', Object.keys(mArg).join(', '));
    for (const k of ['reportUrl', 'chapterCapture', 'startCapture', 'cpi', 'ut', 'defaults']) {
      if (mArg[k] !== undefined) console.log(' ', k, '=', JSON.stringify(mArg[k]).slice(0, 200));
    }
    const atts = mArg.attachments || [];
    console.log('\nattachments:', atts.length);
    for (const a of atts.slice(0, 5)) {
      console.log('  ', JSON.stringify({
        objectId: a.objectId || a.objectid,
        jobid: a.jobid || a._jobid,
        name: a.name,
        attDuration: a.attDuration,
        playTime: a.playTime,
        otherInfo: a.otherInfo,
        rt: a.rt,
        type: a.type,
        module: a.module,
        aid: a.aid,
      }));
    }
  }
}
