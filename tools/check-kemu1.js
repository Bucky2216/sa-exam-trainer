#!/usr/bin/env node
/**
 * 科一应用数据校验脚本。
 *
 * 重点检查会直接导致错误判分或页面白屏的问题：
 * - 题目 ID 是否唯一；
 * - 答案索引是否落在选项范围内；
 * - 判断题是否恰好两个选项；
 * - 多选题是否至少两个答案；
 * - 引用的本地图片是否存在；
 * - 题干、选项和解析是否为空。
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..', 'outputs', 'kemu1');
const dataFile = path.join(root, 'data.js');
const appFile = path.join(root, 'app.js');
const sandbox = { window: {} };
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(dataFile, 'utf8'), sandbox, { filename: 'data.js' });

const bank = sandbox.window.KEMU1_BANK;
const meta = sandbox.window.KEMU1_META;
if (!Array.isArray(bank) || !bank.length) {
  console.error('题库为空或 KEMU1_BANK 未定义');
  process.exit(1);
}

let errors = 0;
const ids = new Set();
const signatures = new Set();
const typeCounts = {};
const chapterCounts = {};
let imageCount = 0;

for (const [index, question] of bank.entries()) {
  const tag = question.id || `#${index + 1}`;
  if (!question.id || ids.has(question.id)) {
    console.error(`题目 ID 缺失或重复：${tag}`);
    errors += 1;
  }
  ids.add(question.id);

  if (!question.question || !question.chapter) {
    console.error(`题干或章节为空：${tag}`);
    errors += 1;
  }
  if (!Array.isArray(question.options) || question.options.length < 2) {
    console.error(`选项数量不足：${tag}`);
    errors += 1;
  }
  if (!Array.isArray(question.answer) || !question.answer.length) {
    console.error(`答案为空：${tag}`);
    errors += 1;
  }
  for (const answerIndex of question.answer || []) {
    if (!Number.isInteger(answerIndex) || answerIndex < 0 || answerIndex >= question.options.length) {
      console.error(`答案索引越界：${tag}`);
      errors += 1;
    }
  }
  if (['judge', 'single', 'multi'].includes(question.type) === false) {
    console.error(`题型异常：${tag}`);
    errors += 1;
  }
  if (question.type === 'judge' && question.options.length !== 2) {
    console.error(`判断题不是两个选项：${tag}`);
    errors += 1;
  }
  if (question.type === 'multi' && question.answer.length < 2) {
    console.error(`多选题答案少于两个：${tag}`);
    errors += 1;
  }
  if (question.type !== 'multi' && question.answer.length !== 1) {
    console.error(`单选/判断题答案数量不是 1：${tag}`);
    errors += 1;
  }

  const signature = [question.question, ...question.options].join('\u0000');
  if (signatures.has(signature)) {
    console.error(`题干和选项完全重复：${tag}`);
    errors += 1;
  }
  signatures.add(signature);

  if (question.image) {
    imageCount += 1;
    if (!fs.existsSync(path.join(root, question.image))) {
      console.error(`图片不存在：${tag} -> ${question.image}`);
      errors += 1;
    }
  }

  typeCounts[question.type] = (typeCounts[question.type] || 0) + 1;
  chapterCounts[question.chapter] = (chapterCounts[question.chapter] || 0) + 1;
}

const appSource = fs.readFileSync(appFile, 'utf8');
const referencedIds = new Set([...appSource.matchAll(/\$\('#([A-Za-z0-9_-]+)'\)/g)].map((match) => match[1]));
const htmlSource = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const htmlIds = new Set([...htmlSource.matchAll(/id="([A-Za-z0-9_-]+)"/g)].map((match) => match[1]));
const dynamicIds = new Set([
  'btnFavorite',
  'optionsList',
  'btnPrev',
  'btnSkip',
  'btnNext',
  'btnSubmitMulti',
  'btnRestartRound',
  'btnBackLast',
]);
for (const id of referencedIds) {
  if (!htmlIds.has(id) && !dynamicIds.has(id)) {
    console.error(`app.js 引用了不存在的元素：#${id}`);
    errors += 1;
  }
}

console.log(`题目总数：${bank.length}`);
console.log(`图片来源：${imageCount}`);
console.log(`题型分布：${JSON.stringify(typeCounts)}`);
console.log(`章节数量：${Object.keys(chapterCounts).length}`);
console.log(`题库版本：${meta.version}（${meta.region}）`);
console.log(errors ? `校验失败：${errors} 个问题` : '校验通过 ✅');
process.exit(errors ? 1 : 0);
