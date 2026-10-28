#!/usr/bin/env node
/**
 * 摩托车 D 照科目一题库校验脚本。
 *
 * 检查会直接导致判题错误或页面运行失败的问题：
 * - 题目 ID 是否唯一；
 * - 是否混入多选题；
 * - 答案下标是否越界；
 * - 判断题是否正好两个选项；
 * - 题干、解析和章节是否完整；
 * - 引用的媒体文件是否存在。
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..', 'outputs', 'kemu1');
const sandbox = { window: {} };
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(path.join(root, 'data.js'), 'utf8'), sandbox, {
  filename: 'data.js',
});

const bank = sandbox.window.MOTO_D_BANK;
const meta = sandbox.window.MOTO_D_META;
if (!Array.isArray(bank) || !bank.length) {
  console.error('题库为空或 MOTO_D_BANK 未定义');
  process.exit(1);
}

let errors = 0;
const mediaFiles = new Set();
const ids = new Set();
const signatures = new Set();
const typeCounts = {};
const chapterCounts = {};

for (const [index, question] of bank.entries()) {
  const tag = question.id || `#${index + 1}`;
  if (!question.id || ids.has(question.id)) {
    console.error(`题目 ID 缺失或重复：${tag}`);
    errors += 1;
  }
  ids.add(question.id);

  if (question.subject !== 'moto-d') {
    console.error(`题目科目标记错误：${tag}`);
    errors += 1;
  }
  if (!question.question || !question.chapter || !question.analysis) {
    console.error(`题干、章节或解析为空：${tag}`);
    errors += 1;
  }
  if (!Array.isArray(question.options) || question.options.length < 2) {
    console.error(`选项数量不足：${tag}`);
    errors += 1;
  }
  if (!Array.isArray(question.answer) || question.answer.length !== 1) {
    console.error(`D 照科一应只有一个正确答案：${tag}`);
    errors += 1;
  }
  if (!['judge', 'single'].includes(question.type)) {
    console.error(`D 照科一不应包含此题型：${tag} -> ${question.type}`);
    errors += 1;
  }
  if (question.type === 'judge' && question.options.length !== 2) {
    console.error(`判断题不是两个选项：${tag}`);
    errors += 1;
  }
  for (const answerIndex of question.answer || []) {
    if (
      !Number.isInteger(answerIndex) ||
      answerIndex < 0 ||
      answerIndex >= question.options.length
    ) {
      console.error(`答案索引越界：${tag}`);
      errors += 1;
    }
  }

  const signature = [question.question, ...question.options].join('\u0000');
  if (signatures.has(signature)) {
    console.error(`题干和选项完全重复：${tag}`);
    errors += 1;
  }
  signatures.add(signature);

  if (question.image) {
    mediaFiles.add(question.image);
    if (!fs.existsSync(path.join(root, question.image))) {
      console.error(`媒体不存在：${tag} -> ${question.image}`);
      errors += 1;
    }
  }

  typeCounts[question.type] = (typeCounts[question.type] || 0) + 1;
  chapterCounts[question.chapter] = (chapterCounts[question.chapter] || 0) + 1;
}

// 检查 app.js 引用的静态元素 ID 是否都存在于 HTML。
const appSource = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
const htmlSource = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const referencedIds = new Set(
  [...appSource.matchAll(/\$\('#([A-Za-z0-9_-]+)'\)/g)].map((match) => match[1]),
);
const htmlIds = new Set(
  [...htmlSource.matchAll(/id="([A-Za-z0-9_-]+)"/g)].map((match) => match[1]),
);
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

console.log(`D 照科一题目：${bank.length}`);
console.log(`媒体文件：${mediaFiles.size}（关联 ${bank.filter((question) => question.image).length} 道题）`);
console.log(`题型分布：${JSON.stringify(typeCounts)}`);
console.log(`章节数量：${Object.keys(chapterCounts).length}`);
console.log(`题库版本：${meta.version}（${meta.region}）`);
console.log(errors ? `校验失败：${errors} 个问题` : '校验通过 ✅');
process.exit(errors ? 1 : 0);
