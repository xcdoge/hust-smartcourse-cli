// 自动答题：读 state/quizzes.json，调 OpenAI 兼容接口，写 state/answers.json
//
//   node src/solve.mjs                 全部待答题目
//   node src/solve.mjs --only=3        只做第 3 份
//   node src/solve.mjs --types=choice,judge
import fs from 'node:fs';
import path from 'node:path';
import { loadConfig, maskKey, CONFIG_PATH } from './lib/config.mjs';
import { loadBank, saveBank, answerFromBank, storeAnswer } from './lib/bank.mjs';

import { maybeHelp } from './lib/help.mjs';
maybeHelp('solve.mjs');

const ROOT = path.resolve(import.meta.dirname, '..');
const STATE = path.join(ROOT, 'state');

const SYSTEM_PROMPT = `你在完成一份课程测验。只输出答案本身，不要解释，不要加引号或标点。
单选：输出一个大写字母，如 B
多选：输出连续字母，如 ABD
判断：输出 true 或 false
填空：输出 JSON 数组，每个空一项，如 ["word1","word2"]
简答：输出一段不超过 80 字的回答`;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** 题型归一：choice / multi / judge / fill / essay */
export function questionKind(q) {
  const label = q.typeLabel || '';
  if (label.includes('多选')) return 'multi';
  if (label.includes('单选')) return 'choice';
  if (label.includes('判断')) return 'judge';
  if (label.includes('填空')) return 'fill';
  if (label.includes('简答') || label.includes('问答')) return 'essay';
  switch (q.qtype) {
    case 0:
      return 'choice';
    case 1:
      return 'multi';
    case 2:
      return 'fill';
    case 3:
      return 'judge';
  }
  return 'essay';
}

export function buildPrompt(q, kind) {
  const lines = [];
  const kindName = {
    choice: '单选题',
    multi: '多选题（可能有多个正确答案）',
    judge: '判断题',
    fill: `填空题（${Math.max(1, q.blankCount || 1)} 个空）`,
    essay: '简答题',
  }[kind];
  lines.push(`题型：${kindName}`);
  lines.push(`题目：${q.stem}`);
  if (q.options && q.options.length) {
    lines.push('选项：');
    for (const o of q.options) lines.push(`${o.value}. ${o.text}`);
  }
  return lines.join('\n');
}

export function parseAnswer(raw, kind) {
  let s = String(raw ?? '').trim();
  if (!s) throw new Error('模型返回空');
  s = s.replace(/^[`"'\s]+|[`"'\s]+$/g, '');
  if (kind !== 'fill') {
    const nl = s.indexOf('\n');
    if (nl > 0) s = s.slice(0, nl).trim();
  }

  switch (kind) {
    case 'choice': {
      const m = s.match(/[A-Z]/);
      if (!m) throw new Error(`无法解析单选项: ${s.slice(0, 40)}`);
      return m[0];
    }
    case 'multi': {
      const letters = s.match(/[A-Z]/g) || [];
      if (!letters.length) throw new Error(`无法解析多选项: ${s.slice(0, 40)}`);
      return [...new Set(letters)].sort().join('');
    }
    case 'judge': {
      const low = s.toLowerCase();
      if (/true|对|正确/.test(low)) return 'true';
      if (/false|错|错误/.test(low)) return 'false';
      throw new Error(`无法解析判断项: ${s.slice(0, 40)}`);
    }
    case 'fill': {
      const m = s.match(/\[[\s\S]*\]/);
      if (m) {
        try {
          const arr = JSON.parse(m[0]);
          if (Array.isArray(arr) && arr.length) return arr.map(String);
        } catch {}
      }
      const parts = s
        .split(/[,，;；|\n]/)
        .map((x) => x.trim())
        .filter(Boolean);
      if (!parts.length) throw new Error(`无法解析填空项: ${s.slice(0, 40)}`);
      return parts;
    }
    default:
      return s;
  }
}

async function callLLM(llm, system, user) {
  const url = llm.base_url.replace(/\/+$/, '') + '/chat/completions';
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${llm.api_key}` },
    body: JSON.stringify({
      model: llm.model,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
      temperature: llm.temperature,
      max_tokens: llm.max_tokens,
    }),
    signal: AbortSignal.timeout(llm.timeout_seconds * 1000),
  });
  const text = await res.text();
  let j = null;
  try {
    j = JSON.parse(text);
  } catch {
    throw new Error(`接口返回不是 JSON (HTTP ${res.status}): ${text.slice(0, 120)}`);
  }
  if (j.error && j.error.message) throw new Error(`接口报错: ${j.error.message}`);
  if (res.status !== 200) throw new Error(`接口返回 HTTP ${res.status}: ${text.slice(0, 120)}`);
  if (!j.choices || !j.choices.length) throw new Error('接口没有返回 choices');
  return j.choices[0].message.content;
}

async function solveOne(cfg, q, kind) {
  const prompt = buildPrompt(q, kind);
  const attempts = Math.max(1, (cfg.quiz.retries || 0) + 1);
  let lastErr = null;
  for (let i = 0; i < attempts; i++) {
    try {
      const out = await callLLM(cfg.llm, SYSTEM_PROMPT, prompt);
      return parseAnswer(out, kind);
    } catch (e) {
      lastErr = e;
      await sleep(1000);
    }
  }
  throw lastErr;
}

export async function runSolve() {
  const args = process.argv.slice(2);
  let only = -1;
  let noCache = false;
  const types = new Set();
  for (const a of args) {
    if (a === '--no-cache') noCache = true;
    if (a.startsWith('--only=')) only = Number(a.slice(7));
    if (a.startsWith('--types=')) a.slice(8).split(',').forEach((t) => t.trim() && types.add(t.trim()));
  }

  const { cfg, created } = loadConfig();
  if (created) console.log(`已生成默认配置 ${CONFIG_PATH}`);
  if (!cfg.llm.enabled) throw new Error(`[llm] enabled = false，改 ${CONFIG_PATH} 后重试`);
  if (!cfg.llm.api_key) throw new Error(`[llm] api_key 为空，填在 ${CONFIG_PATH} 里`);

  const quizzesFile = path.join(STATE, 'quizzes.json');
  if (!fs.existsSync(quizzesFile)) throw new Error('缺少 state/quizzes.json，先执行 node src/quiz.mjs dump');
  const quizzes = JSON.parse(fs.readFileSync(quizzesFile, 'utf8'));

  const answersFile = path.join(STATE, 'answers.json');
  const answers = fs.existsSync(answersFile) ? JSON.parse(fs.readFileSync(answersFile, 'utf8')) : {};
  const bank = loadBank();

  const allowed = (kind) => (types.size ? types.has(kind) : cfg.quiz.types.includes(kind));

  let total = 0;
  let ok = 0;
  let failed = 0;
  let hits = 0;
  for (const q of quizzes) {
    if (only >= 0 && q.index !== only) continue;
    const key = String(q.index);
    answers[key] = answers[key] || {};
    console.log(`[${q.index}] ${q.title}`);
    for (const qq of q.questions) {
      const kind = questionKind(qq);
      if (!allowed(kind)) continue;
      total++;

      if (!noCache) {
        const cached = answerFromBank(bank, qq, kind);
        if (cached !== null) {
          hits++;
          answers[key][qq.qid] = cached;
          ok++;
          console.log(`  ${qq.qid} ${kind} -> ${Array.isArray(cached) ? JSON.stringify(cached) : cached}（题库）`);
          continue;
        }
      }

      try {
        const ans = await solveOne(cfg, qq, kind);
        answers[key][qq.qid] = ans;
        storeAnswer(bank, qq, kind, ans);
        ok++;
        console.log(`  ${qq.qid} ${kind} -> ${Array.isArray(ans) ? JSON.stringify(ans) : ans}`);
      } catch (e) {
        failed++;
        console.log(`  ${qq.qid} ${String(e.message || e).slice(0, 80)}`);
      }
      await sleep(cfg.quiz.delay_ms);
    }
  }

  fs.writeFileSync(answersFile, JSON.stringify(answers, null, 2));
  saveBank(bank);
  console.log(`\n作答 ${total} 题，成功 ${ok}（题库命中 ${hits}），失败 ${failed}，已写 state/answers.json`);
  if (ok > 0) console.log('下一步：node src/quiz.mjs submit  （检查一下 answers.json 再交）');
}

const isMain = process.argv[1] && process.argv[1].endsWith('solve.mjs');
if (isMain) {
  runSolve().catch((e) => {
    console.error('hsc:', e.message || e);
    process.exit(1);
  });
}

export { maskKey };
