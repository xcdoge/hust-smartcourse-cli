// 凭据管理：加密保存 / 查看 / 迁移 / 清除
//
//   node src/cred.mjs save <学号> <密码>   # 加密保存（推荐）
//   node src/cred.mjs save                 # 从 state/cred.txt 读入并加密，然后删掉明文
//   node src/cred.mjs show                 # 解密查看（确认存对了）
//   node src/cred.mjs status               # 看有没有存、存在哪个文件
//   node src/cred.mjs forget               # 清除所有本地凭据
import fs from 'node:fs';
import { saveCreds, loadEncrypted, loadPlaintext, loadCreds, hasCreds, forget, migratePlaintext, CRED_FILES } from './lib/secret.mjs';

import { maybeHelp } from './lib/help.mjs';
maybeHelp('cred');

const [cmd, ...args] = process.argv.slice(2);

function status() {
  const enc = fs.existsSync(CRED_FILES.ENC_FILE);
  const plain = fs.existsSync(CRED_FILES.TXT_FILE);
  console.log('加密凭据 state/cred.enc.json :', enc ? '存在' : '无');
  console.log('明文凭据 state/cred.txt      :', plain ? '存在（建议迁移）' : '无');
  if (enc) {
    const j = JSON.parse(fs.readFileSync(CRED_FILES.ENC_FILE, 'utf8'));
    console.log(`  保存于 ${j.savedAt}  账号 ${j.user}`);
    console.log('  可解密 :', loadEncrypted() ? '本机可解开' : '解不开（换机器/换用户/被改过）');
  }
}

switch (cmd) {
  case 'save': {
    if (args.length >= 2) {
      const [u, p] = args;
      const f = saveCreds(u, p);
      console.log('已加密保存到', f);
      console.log('  账号:', u, '| 密码:', '*'.repeat(Math.min(p.length, 12)), `(${p.length} 位)`);
      break;
    }
    // 无参数：把明文迁移成加密
    const migrated = migratePlaintext();
    if (migrated) {
      console.log('已把 state/cred.txt 迁移为加密文件，并删除明文');
      status();
    } else {
      console.log('没有可迁移的明文 cred.txt');
      console.log('  用法: node src/cred.mjs save <学号> <密码>');
    }
    break;
  }
  case 'show': {
    const c = loadEncrypted() || loadPlaintext();
    if (!c) {
      console.log('没有保存的凭据');
      break;
    }
    console.log(`来源: ${c.source === 'enc' ? '加密文件' : '明文 cred.txt'}`);
    console.log('账号:', c.username);
    console.log('密码:', c.password);
    break;
  }
  case 'status':
  case undefined:
    status();
    break;
  case 'forget': {
    const removed = forget();
    console.log(removed.length ? '已删除: ' + removed.join(', ') : '无凭据文件');
    break;
  }
  default:
    console.log(`未知命令: ${cmd}`);
    console.log('可用: save [账号 密码] / show / status / forget');
    process.exit(1);
}
