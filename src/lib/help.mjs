// 各脚本的 --help 文本。node src/xxx.mjs --help 打印对应内容。
export const HELP = {
  'login-qr': `用法: node src/login-qr.mjs

扫码登录。二维码写到 state/login-qr.png，用企业微信扫。
登录成功后 cookie 存到 state/cookies.json。

选项:
  -h, --help   显示本帮助`,

  'login-pw': `用法: node src/login-pw.mjs [--manual] [--code=NNNN]

账号密码登录。需要先用 node src/cred.mjs save 存过凭据，或在 state/cred.txt 写两行。
验证码由内置模型识别，失败会自动换图重试。

选项:
  --manual        不自动识别，只取验证码图
  --code=NNNN     指定验证码后提交
  -h, --help      显示本帮助`,

  check: `用法: node src/probe-session.mjs

逐个请求关键页面，检查会话是否有效。

选项:
  -h, --help   显示本帮助`,

  logout: `用法: node src/logout.mjs [--all]

清除登录态，并通知 CAS 注销。默认保留加密凭据。

选项:
  --all, -a    同时删除 state/cred.enc.json 和 cred.txt
  -h, --help   显示本帮助`,

  cred: `用法: node src/cred.mjs <子命令>

账号密码加密管理（AES-256-GCM + scrypt，密钥绑机器）。

子命令:
  save <学号> <密码>   加密保存到 state/cred.enc.json
  show                显示已保存的账号
  status              查看凭据状态、能否解密
  forget              删除已保存的凭据

选项:
  -h, --help   显示本帮助`,

  config: `用法: node src/config.mjs [show|init]

查看或生成 state/config.toml（自动答题的接口配置）。

子命令:
  show   显示当前配置，api_key 打码（默认）
  init   重新生成默认配置

选项:
  -h, --help   显示本帮助`,

  init: `用法: node src/init.mjs [序号|课程链接] [--refresh]

选课。不带参数时列出账号下的所有课程。

参数:
  序号          选第 N 门课
  课程链接      从 URL 里解析 courseid / clazzid / cpi

选项:
  --refresh, -r   强制重新拉课程列表
  -h, --help      显示本帮助`,

  course: `用法: node src/course.mjs

抓取当前课程的章节与任务点，写入 state/course.json。

选项:
  -h, --help   显示本帮助`,

  scan: `用法: node src/scan.mjs

扫描每个章节的全部 tab，结果写到 state/scan.json。

选项:
  -h, --help   显示本帮助`,

  play: `用法: node src/play.mjs [--all] [--id=N] [--objectid=X] [--speed=N] [--tick=N] [--dry]

刷视频任务点。每次上报推进 speed*tick 秒，间隔 tick 秒。

选项:
  --all           处理全部未通过的视频
  --id=N          临时切换到第 N 门课
  --objectid=X    只处理指定视频
  --speed=N       倍速，默认 1
  --tick=N        上报间隔秒数，默认 10
  --dry           只打印计划，不实际上报
  -h, --help      显示本帮助`,

  doc: `用法: node src/doc.mjs [--all] [--id=N]

完成文档和图片任务点。

选项:
  --all         处理全部未完成的文档
  --id=N        临时切换到第 N 门课
  -h, --help    显示本帮助`,

  quiz: `用法: node src/quiz.mjs <dump|solve|submit|peek> [--id=N] [--only=N]

测验与练习题。

子命令:
  dump      抓题，写 state/quizzes.json
  solve     调 [llm] 配置的接口自动作答
  submit    按 answers.json 交卷
  peek      查看批阅结果

选项:
  --id=N      临时切换到第 N 门课
  --only=N    只处理第 N 份测验
  -h, --help  显示本帮助`,

  'solve.mjs': `用法: node src/solve.mjs [--only=N] [--types=choice,judge]

自动答题。读 state/quizzes.json，调 state/config.toml 里 [llm] 的接口，
结果写入 state/answers.json。

选项:
  --only=N            只做第 N 份测验
  --types=a,b,c       限定题型 choice/multi/judge/fill/essay
  -h, --help          显示本帮助`,
};

/** 参数里出现 -h/--help 就打印帮助并退出 */
export function maybeHelp(name) {
  const argv = process.argv.slice(2);
  if (!argv.includes('-h') && !argv.includes('--help')) return;
  const text = HELP[name];
  if (text) {
    console.log(text);
    process.exit(0);
  }
}
