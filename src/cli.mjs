// 交互模式：连续敲命令，不用每次都 node src/xxx.mjs
//
//   node src/cli.mjs            进入 hsc> 提示符
//   node src/cli.mjs play --all 直接执行一条命令后退出
//
// 和 Go 版的行为对齐：支持引号、出错不退出、q 退出。
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { spawnSync } from 'node:child_process';

const ROOT = path.resolve(import.meta.dirname, '..');
const SRC = path.join(ROOT, 'src');
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));

// 命令 → 脚本；参数原样透传
const COMMANDS = {
  'login-qr': 'login-qr.mjs',
  'login-pw': 'login-pw.mjs',
  check: 'probe-session.mjs',
  logout: 'logout.mjs',
  cred: 'cred.mjs',
  config: 'config.mjs',
  init: 'init.mjs',
  course: 'course.mjs',
  scan: 'scan.mjs',
  play: 'play.mjs',
  doc: 'doc.mjs',
  quiz: 'quiz.mjs',
  solve: 'solve.mjs',
  import: 'import-cookies.mjs',
};

const USAGE = `hsc-node ${pkg.version}

用法: node src/cli.mjs [命令] [参数]

登录
  login-qr              扫码登录，二维码写入 state/auth/login-qr.png
  login-pw [--manual]   账密登录，自动识别验证码
  check                 检查当前会话是否有效
  logout [--all]        清除登录态；--all 同时删除已存凭据
  cred <save|show|status|forget>
  config <show|init>    查看/生成 state/config.toml

课程
  init [序号|课程链接]   列出课程并按序号选课（自动抓结构 + 扫描）
  course                抓取课程结构
  scan                  扫描每章全部 tab，包含练习题

任务点
  play [--all] [--id=N] [--speed=N] [--tick=N] [--only=N] [--dry]
  doc  [--all] [--id=N]
  quiz <dump|solve|submit|peek|bank> [--id=N] [--only=N]

其他
  help                  显示本帮助
  version
  q                     退出

每个命令都支持 --help，例如 quiz --help
`;

// 和 Go 版 parseArgs 一致：支持单引号、双引号、不加引号三种写法
export function parseArgs(line) {
  const out = [];
  let cur = '';
  let inSingle = false;
  let inDouble = false;
  let has = false;

  const flush = () => {
    if (has) {
      out.push(cur);
      cur = '';
      has = false;
    }
  };

  for (const ch of line) {
    if (ch === "'" && !inDouble) {
      inSingle = !inSingle;
      has = true;
    } else if (ch === '"' && !inSingle) {
      inDouble = !inDouble;
      has = true;
    } else if (/\s/.test(ch) && !inSingle && !inDouble) {
      flush();
    } else {
      cur += ch;
      has = true;
    }
  }
  flush();
  return out;
}

/** 执行一条命令；返回 { quit, code } */
export function runOne(argv) {
  const done = (code = 0, quit = false) => ({ quit, code });
  if (!argv.length) return done();

  const cmd = argv[0];
  const rest = argv.slice(1);

  if (cmd === 'q' || cmd === 'quit' || cmd === 'exit') return done(0, true);
  if (cmd === 'help' || cmd === '?') {
    process.stdout.write(USAGE);
    return done();
  }
  if (cmd === 'version' || cmd === '-v' || cmd === '--version') {
    console.log(`hsc-node ${pkg.version}`);
    return done();
  }

  const script = COMMANDS[cmd];
  if (!script) {
    console.error(`hsc: 未知命令 "${cmd}"，输入 help 看用法`);
    return done(1);
  }

  const file = path.join(SRC, script);
  if (!fs.existsSync(file)) {
    console.error(`hsc: 找不到 ${file}`);
    return done(1);
  }

  const r = spawnSync(process.execPath, [file, ...rest], { stdio: 'inherit' });
  if (r.error) {
    console.error(`hsc: ${r.error.message}`);
    return done(1);
  }
  return done(r.status ?? 0);
}

function main() {
  // 带参数 = 一次性执行，和 Go 版 `hsc <命令>` 一致
  const argv = process.argv.slice(2);
  if (argv.length) {
    process.exit(runOne(argv).code);
  }

  process.stdout.write(`hsc-node ${pkg.version}\n\n`);
  process.stdout.write(USAGE);

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout, prompt: '\nhsc> ' });
  rl.prompt();
  rl.on('line', (line) => {
    const text = line.trim();
    if (text) {
      try {
        const r = runOne(parseArgs(text));
        if (r.quit) {
          rl.close();
          return;
        }
      } catch (e) {
        console.error(`hsc: ${e.message || e}`);
      }
    }
    rl.prompt();
  });
  rl.on('close', () => {
    process.stdout.write('\n');
  });
}

const isMain = process.argv[1] && path.basename(process.argv[1]) === 'cli.mjs';
if (isMain) main();
