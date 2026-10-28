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

const subjects = [
  {
    key: 'ke1',
    name: '科目一',
    bank: sandbox.window.KEMU1_BANK,
    meta: sandbox.window.KEMU1_META,
  },
  {
    key: 'ke4',
    name: '科目四',
    bank: sandbox.window.KEMU4_BANK,
    meta: sandbox.window.KEMU4_META,
  },
];
if (subjects.some((subject) => !Array.isArray(subject.bank) || !subject.bank.length)) {
  console.error('题库为空：KEMU1_BANK 或 KEMU4_BANK 未定义');
  process.exit(1);
}

let errors = 0;
const ids = new Set();
const signatures = new Set();
for (const subject of subjects) {
  const typeCounts = {};
  const chapterCounts = {};
  let mediaCount = 0;

  for (const [index, question] of subject.bank.entries()) {
    const tag = question.id || `${subject.key}#${index + 1}`;
    if (!question.id || ids.has(question.id)) {
      console.error(`题目 ID 缺失或重复：${tag}`);
      errors += 1;
    }
    ids.add(question.id);

    if (question.subject !== subject.key) {
      console.error(`题目科目标记错误：${tag}`);
      errors += 1;
    }
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
      if (
        !Number.isInteger(answerIndex) ||
        answerIndex < 0 ||
        answerIndex >= question.options.length
      ) {
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

    const signature = [subject.key, question.question, ...question.options].join('\u0000');
    if (signatures.has(signature)) {
      console.error(`同科题干和选项完全重复：${tag}`);
      errors += 1;
    }
    signatures.add(signature);

    if (question.image) {
      mediaCount += 1;
      if (!fs.existsSync(path.join(root, question.image))) {
        console.error(`媒体不存在：${tag} -> ${question.image}`);
        errors += 1;
      }
    }

    typeCounts[question.type] = (typeCounts[question.type] || 0) + 1;
    chapterCounts[question.chapter] = (chapterCounts[question.chapter] || 0) + 1;
  }

  console.log(
    `${subject.name}：${subject.bank.length} 题，${mediaCount} 个媒体文件，版本 ${subject.meta.version}`,
  );
  console.log(`  题型：${JSON.stringify(typeCounts)}`);
  console.log(`  章节：${Object.keys(chapterCounts).length}`);
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

console.log(`题目总数：${subjects.reduce((sum, subject) => sum + subject.bank.length, 0)}`);
console.log(
  `版本：${subjects.map((subject) => `${subject.name} ${subject.meta.version}`).join(' / ')}`,
);
console.log(errors ? `校验失败：${errors} 个问题` : '校验通过 ✅');
process.exit(errors ? 1 : 0);
