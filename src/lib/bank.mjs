// 题库缓存：按 qid 记住答过的题
//
// 选项类题存「选中选项的文本」，复用时按文本反查当前字母，
// 即使老师开了选项乱序也不会答错。题干指纹防止 qid 复用到别的题。
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const ROOT = path.resolve(import.meta.dirname, '..', '..');
const STATE = path.join(ROOT, 'state');
const BANK_FILE = path.join(STATE, 'qbank.json');

function stemFingerprint(stem) {
  const norm = String(stem || '')
    .toLowerCase()
    .replace(/\s+/g, '');
  return crypto.createHash('md5').update(norm, 'utf8').digest('hex');
}

const normOption = (s) =>
  String(s || '')
    .toLowerCase()
    .replace(/\s+/g, '');

function letterOfText(q, text) {
  const want = normOption(text);
  for (const o of q.options || []) {
    if (normOption(o.text) === want) return o.value;
  }
  return null;
}

export function loadBank() {
  try {
    return JSON.parse(fs.readFileSync(BANK_FILE, 'utf8')) || {};
  } catch {
    return {};
  }
}

export function saveBank(bank) {
  fs.mkdirSync(STATE, { recursive: true });
  fs.writeFileSync(BANK_FILE, JSON.stringify(bank, null, 2));
}

/** 命中返回答案，否则 null */
export function answerFromBank(bank, q, kind) {
  const e = bank[q.qid];
  if (!e || e.kind !== kind) return null;
  if (e.stem && e.stem !== stemFingerprint(q.stem)) return null;

  switch (kind) {
    case 'choice': {
      if (!e.texts?.length) return null;
      return letterOfText(q, e.texts[0]) || null;
    }
    case 'multi': {
      if (!e.texts?.length) return null;
      const letters = [];
      for (const t of e.texts) {
        const l = letterOfText(q, t);
        if (!l) return null; // 有一个对不上就不用
        letters.push(l);
      }
      return [...new Set(letters)].sort().join('');
    }
    case 'judge':
      return e.answer || null;
    case 'fill':
      return e.texts?.length ? [...e.texts] : null;
    default:
      return e.answer || null;
  }
}

/** 作答后写回题库 */
export function storeAnswer(bank, q, kind, ans) {
  const e = { kind, stem: stemFingerprint(q.stem) };

  if (Array.isArray(ans)) {
    e.texts = [...ans];
  } else if (kind === 'choice' || kind === 'multi') {
    const letters = String(ans).split('');
    const texts = [];
    for (const l of letters) {
      const o = (q.options || []).find((x) => x.value === l);
      if (!o) return; // 字母对不上选项，不存
      texts.push(o.text);
    }
    e.texts = texts;
    e.answer = String(ans);
  } else {
    e.answer = String(ans);
  }
  bank[q.qid] = e;
}

export const BANK_FILE_PATH = BANK_FILE;
