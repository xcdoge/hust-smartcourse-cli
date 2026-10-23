// 查看 / 生成 state/config.toml
//   node src/config.mjs          查看当前配置（api_key 打码）
//   node src/config.mjs init     重新生成默认配置
import fs from 'node:fs';
import { loadConfig, maskKey, CONFIG_PATH, DEFAULT_CONFIG_TOML } from './lib/config.mjs';

import { maybeHelp } from './lib/help.mjs';
maybeHelp('config');
if (process.argv.length <= 2) {
  const { HELP } = await import('./lib/help.mjs');
  console.log(HELP.config);
  process.exit(0);
}

const sub = process.argv[2] || 'show';

if (sub === 'init' || sub === 'reset') {
  fs.writeFileSync(CONFIG_PATH, DEFAULT_CONFIG_TOML, { mode: 0o600 });
  console.log(`已生成 ${CONFIG_PATH}`);
} else {
  const { cfg, created } = loadConfig();
  if (created) console.log(`首次运行，已生成默认配置 ${CONFIG_PATH}\n`);
  console.log(`配置文件: ${CONFIG_PATH}\n`);
  console.log('[llm]');
  console.log(`  enabled     = ${cfg.llm.enabled}`);
  console.log(`  base_url    = ${cfg.llm.base_url}`);
  console.log(`  api_key     = ${maskKey(cfg.llm.api_key)}`);
  console.log(`  model       = ${cfg.llm.model}`);
  console.log(`  temperature = ${cfg.llm.temperature}`);
  console.log(`  max_tokens  = ${cfg.llm.max_tokens}`);
  console.log('\n[quiz]');
  console.log(`  auto_submit = ${cfg.quiz.auto_submit}`);
  console.log(`  types       = ${cfg.quiz.types.join(', ')}`);
  console.log(`  delay_ms    = ${cfg.quiz.delay_ms}`);
  if (!cfg.llm.enabled || !cfg.llm.api_key) {
    console.log('\n自动答题未启用：把 [llm] 里的 enabled 改成 true 并填好 api_key');
  }
}
