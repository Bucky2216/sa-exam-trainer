#!/usr/bin/env node
/**
 * 科一题库构建脚本
 *
 * 作用：
 * 1. 从公开的 2026 科目一题库 JSON 中筛选 subject=ke1 的数据；
 * 2. 将题库中的 HTML 解析文本转换成纯文本，避免网页直接渲染第三方 HTML；
 * 3. 对“题干 + 选项”完全相同的重复题去重，同时保留源题库 ID 方便追溯；
 * 4. 只复制网页实际引用的题目图片，防止把科目四和标志库的无关资源一起打包；
 * 5. 生成浏览器可直接加载的 data.js，不依赖网络或构建工具。
 *
 * 用法：
 *   node tools/build-kemu1-data.js /path/to/questions.json
 */
const fs = require('fs');
const path = require('path');

const projectRoot = path.resolve(__dirname, '..');
const sourceRoot = path.resolve(process.argv[2] || '');
const outputRoot = path.join(projectRoot, 'outputs', 'kemu1');
const imageOutputRoot = path.join(outputRoot, 'questions');

if (!process.argv[2] || !fs.existsSync(sourceRoot)) {
  console.error('请传入存在的题库 JSON 路径');
  process.exit(1);
}

const raw = JSON.parse(fs.readFileSync(sourceRoot, 'utf8'));
const sourceQuestions = Array.isArray(raw) ? raw : raw.questions;
if (!Array.isArray(sourceQuestions)) {
  console.error('题库格式不正确：未找到题目数组');
  process.exit(1);
}

const sourceImageRoot = path.join(
  path.dirname(sourceRoot),
  '..',
  '..',
  'public',
  'images',
);

fs.mkdirSync(imageOutputRoot, { recursive: true });

/** 把第三方题库里的简单 HTML 转成纯文本，页面采用 textContent 渲染，避免 XSS。 */
function htmlToText(value) {
  return String(value || '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\r/g, '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** 统一把单答案、多答案都转换为从 0 开始的数字索引数组。 */
function answerToIndexes(answer) {
  const values = Array.isArray(answer) ? answer : [answer];
  return values
    .map((item) => Number(item))
    .filter((item) => Number.isInteger(item) && item >= 0)
    .sort((a, b) => a - b);
}

/**
 * 同一题干配上同一组选项时，重复记录对练习没有价值。
 * 去重后把源 ID 合并进 sourceIds，后续仍能追溯题目来源。
 */
const bySignature = new Map();
for (const source of sourceQuestions) {
  if (!source || source.subject !== 'ke1' || !source.question || !source.options) continue;

  const options = source.options.map(htmlToText).filter(Boolean);
  if (options.length < 2) continue;

  const answer = answerToIndexes(source.answer);
  if (!answer.length || answer.some((index) => index >= options.length)) continue;

  const signature = [htmlToText(source.question), ...options].join('\u0000');
  const image = source.image ? path.basename(source.image) : '';
  const normalized = {
    id: source.qid ? String(source.qid) : String(source.id),
    sourceIds: [String(source.id)],
    type: source.type === 'multi' ? 'multi' : source.type === 'judge' ? 'judge' : 'single',
    chapter: htmlToText(source.chapter_name || '其他'),
    question: htmlToText(source.question),
    options,
    answer,
    analysis: htmlToText(source.analysis),
    mnemonic: htmlToText(source.mnemonic),
    concise: htmlToText(source.concise_analysis),
    image: image ? `questions/${image}` : '',
  };

  const existing = bySignature.get(signature);
  if (existing) {
    existing.sourceIds.push(String(source.id));
    continue;
  }
  bySignature.set(signature, normalized);
}

const questions = [...bySignature.values()];
const copiedImages = new Set();
for (const question of questions) {
  if (!question.image) continue;
  const filename = path.basename(question.image);
  const sourceImage = path.join(sourceImageRoot, 'questions', filename);
  if (!fs.existsSync(sourceImage)) {
    console.warn(`图片缺失，已移除引用：${filename}`);
    question.image = '';
    continue;
  }
  if (!copiedImages.has(filename)) {
    fs.copyFileSync(sourceImage, path.join(imageOutputRoot, filename));
    copiedImages.add(filename);
  }
}

const chapters = [...new Set(questions.map((question) => question.chapter))].sort((a, b) =>
  a.localeCompare(b, 'zh-CN'),
);

const meta = {
  title: '厦门科目一快刷题库',
  version: '2026.10',
  exam: '科目一',
  region: '厦门考区适用',
  source: '公开 2026 科目一题库（题型整理，非官方实时接口）',
  sourceRepository: 'https://github.com/xfhxly/KeMuONEXueKao',
  generatedAt: new Date().toISOString(),
  questionCount: questions.length,
  imageCount: copiedImages.size,
  chapters,
};

const output = [
  '/* 自动生成文件，请运行 tools/build-kemu1-data.js 更新。 */',
  `window.KEMU1_META = ${JSON.stringify(meta)};`,
  `window.KEMU1_BANK = ${JSON.stringify(questions)};`,
  '',
].join('\n');

fs.writeFileSync(path.join(outputRoot, 'data.js'), output);

console.log(
  `已生成 ${questions.length} 题、${copiedImages.size} 张图片、${chapters.length} 个章节：${path.join(outputRoot, 'data.js')}`,
);
