// 用 40 张已标注验证码验证 Node 端识别器（留一：剔除自身同源样本后再匹配）
import fs from 'node:fs';
import path from 'node:path';
import { recognize, loadModel } from '../src/lib/captcha.mjs';

const LABELS = {
  'cap-001': '6339',
  'cap-002': '3335',
  'cap-003': '2916',
  'cap-004': '4711',
  'cap-005': '0511',
  'cap-006': '2809',
  'cap-007': '6772',
  'cap-008': '7835',
  'cap-009': '0266',
  'cap-010': '8442',
  'cap-011': '3558',
  'cap-012': '9665',
  'cap-013': '1140',
  'cap-014': '2910',
  'cap-015': '8777',
  'cap-016': '7634',
  'cap-017': '8202',
  'cap-018': '4527',
  'cap-019': '7717',
  'cap-020': '3043',
  'cap-021': '0931',
  'cap-022': '2743',
  'cap-023': '8520',
  'cap-024': '2577',
  'cap-025': '1740',
  'cap-026': '1978',
  'cap-027': '0807',
  'cap-028': '9766',
  'cap-029': '2161',
  'cap-030': '2925',
  'cap-031': '9722',
  'cap-032': '8551',
  'cap-033': '2894',
  'cap-034': '6644',
  'cap-035': '3697',
  'cap-036': '0794',
  'cap-037': '1103',
  'cap-038': '2895',
  'cap-039': '1558',
  'cap-040': '6644',
  'cap-041': '8139',
  'cap-042': '1346',
  'cap-043': '9876',
  'cap-044': '9325',
  'cap-045': '2487',
  'cap-046': '8134',
  'cap-047': '3914',
  'cap-048': '0138',
  'cap-049': '0515',
  'cap-050': '5526',
  'cap-051': '1304',
  'cap-052': '0816',
  'cap-053': '7191',
  'cap-054': '1666',
  'cap-055': '2794',
  'cap-056': '6557',
  'cap-057': '0073',
  'cap-058': '3794',
  'cap-059': '9514',
  'cap-060': '0663',
  'cap-061': '9056',
  'cap-062': '1269',
  'cap-063': '1958',
  'cap-064': '7085',
  'cap-065': '1386',
  'cap-066': '2829',
  'cap-067': '9449',
  'cap-068': '2480',
  'cap-069': '1057',
  'cap-070': '3346',
  'cap-071': '9927',
  'cap-072': '5476',
  'cap-073': '7799',
  'cap-074': '5510',
  'cap-075': '6462',
  'cap-076': '7023',
  'cap-077': '8446',
  'cap-078': '5311',
  'cap-079': '9373',
  'cap-080': '7126'
};

const model = loadModel();
const dir = 'state/captchas';
const files = fs.readdirSync(dir).filter((f) => f.endsWith('.gif')).sort();
let labeled = 0;

let whole = 0;
let digitRight = 0;
let digitTotal = 0;
const wrong = [];
const lowConf = [];

for (const f of files) {
  const key = path.basename(f, '.gif');
  const label = LABELS[key];
  if (!label) continue;
  labeled++;
  const buf = fs.readFileSync(path.join(dir, f));
  // 留一：剔除来自同一张验证码的样本
  const loo = { ...model, samples: model.samples.filter((s) => s[2] !== key) };
  const r = recognize(buf, { model: loo });
  digitTotal += label.length;
  if (r.code === label) {
    whole++;
    digitRight += label.length;
  } else {
    wrong.push(`${key} 期望 ${label} 得 ${r.code || '(空)'} conf=${r.conf}`);
    for (let i = 0; i < label.length; i++) if (r.code[i] === label[i]) digitRight++;
  }
  if (r.conf < 0.15) lowConf.push(`${key}:${r.code} conf=${r.conf}`);
}

console.log(`完整命中: ${whole}/${labeled}`);
console.log(`单字准确率: ${digitRight}/${digitTotal} = ${((digitRight / digitTotal) * 100).toFixed(1)}%`);
console.log(`整张准确率: ${((whole / labeled) * 100).toFixed(1)}%`);
if (wrong.length) {
  console.log('错误样本:');
  wrong.forEach((w) => console.log('  ' + w));
}
console.log(`低置信(<0.15) 的: ${lowConf.length} 张`);
