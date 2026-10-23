// state/config.toml 的读写与默认值，Node / Go 两版共用同一份格式
import fs from 'node:fs';
import path from 'node:path';
import { parseTOML } from './toml.mjs';

const ROOT = path.resolve(import.meta.dirname, '..', '..');
export const CONFIG_PATH = path.join(ROOT, 'state', 'config.toml');

export const DEFAULT_CONFIG_TOML = `# hsc 配置
# 自动答题（quiz solve）使用 [llm] 里的接口，格式兼容 OpenAI

[llm]
# 改成 true 才会真正调用接口
enabled = false
base_url = "https://api.openai.com/v1"
api_key = ""
model = "gpt-4o-mini"
temperature = 0.2
max_tokens = 4096
timeout_seconds = 60

[quiz]
# solve 完成后是否直接交卷
auto_submit = false
# 参与自动作答的题型：choice=单选 multi=多选 judge=判断 fill=填空 essay=简答
types = ["choice", "multi", "judge", "fill"]
# 每题之间的间隔，避免触发限流
delay_ms = 300
# 单题失败重试次数
retries = 2
`;

/** 文件不存在就写一份默认配置；返回 { created } */
export function ensureConfig() {
  fs.mkdirSync(path.dirname(CONFIG_PATH), { recursive: true });
  if (fs.existsSync(CONFIG_PATH)) return { created: false };
  fs.writeFileSync(CONFIG_PATH, DEFAULT_CONFIG_TOML, { mode: 0o600 });
  return { created: true };
}

/** 读取配置并补默认值 */
export function loadConfig() {
  const { created } = ensureConfig();
  const raw = fs.readFileSync(CONFIG_PATH, 'utf8');
  const parsed = parseTOML(raw);

  const llm = parsed.llm || {};
  const quiz = parsed.quiz || {};

  const cfg = {
    llm: {
      enabled: llm.enabled === true,
      base_url: llm.base_url || 'https://api.openai.com/v1',
      api_key: llm.api_key || '',
      model: llm.model || 'gpt-4o-mini',
      temperature: typeof llm.temperature === 'number' ? llm.temperature : 0.2,
      max_tokens: llm.max_tokens || 4096,
      timeout_seconds: llm.timeout_seconds || 60,
    },
    quiz: {
      auto_submit: quiz.auto_submit === true,
      types: Array.isArray(quiz.types) && quiz.types.length ? quiz.types : ['choice', 'multi', 'judge', 'fill'],
      delay_ms: quiz.delay_ms || 300,
      retries: typeof quiz.retries === 'number' ? quiz.retries : 2,
    },
  };
  return { cfg, created };
}

export function maskKey(k) {
  if (!k) return '(未填写)';
  const s = String(k);
  return s.length <= 8 ? '****' : s.slice(0, 4) + '****' + s.slice(-4);
}
