// 极简 TOML 解析器：只覆盖本项目 config.toml 用到的语法
//   [section]       分节
//   key = "字符串"   / 数字 / true|false / ["a", "b"] 数组
// 不支持多行值、内联表、日期等（用不到）
export function parseTOML(text) {
  const out = {};
  let cur = out;

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;

    const sec = line.match(/^\[([^\]]+)\]$/);
    if (sec) {
      const name = sec[1].trim();
      if (!out[name] || typeof out[name] !== 'object') out[name] = {};
      cur = out[name];
      continue;
    }

    const eq = line.indexOf('=');
    if (eq < 0) continue;
    const key = line.slice(0, eq).trim();
    let val = line.slice(eq + 1).trim();

    // 去掉行尾注释（引号内的 # 不算）
    let inStr = false;
    for (let i = 0; i < val.length; i++) {
      const c = val[i];
      if (c === '"' && val[i - 1] !== '\\') inStr = !inStr;
      if (c === '#' && !inStr) {
        val = val.slice(0, i).trim();
        break;
      }
    }

    cur[key] = parseValue(val);
  }
  return out;
}

function parseValue(v) {
  if (v === 'true') return true;
  if (v === 'false') return false;

  if (v.startsWith('"') && v.endsWith('"')) {
    return v.slice(1, -1).replace(/\\"/g, '"').replace(/\\n/g, '\n');
  }
  if (v.startsWith("'") && v.endsWith("'")) {
    return v.slice(1, -1);
  }
  if (v.startsWith('[') && v.endsWith(']')) {
    const inner = v.slice(1, -1).trim();
    if (!inner) return [];
    return inner.split(',').map((s) => parseValue(s.trim()));
  }
  const n = Number(v);
  return Number.isNaN(n) ? v : n;
}
