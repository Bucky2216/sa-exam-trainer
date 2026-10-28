#!/usr/bin/env node
/**
 * 驾考题库构建脚本（科目一 + 科目四）
 *
 * 作用：
 * 1. 从公开的 2026 驾考题库 JSON 中分别筛选 subject=ke1 / ke4 的数据；
 * 2. 将题库中的 HTML 解析文本转换成纯文本，避免网页直接渲染第三方 HTML；
 * 3. 对“题干 + 选项”完全相同的重复题去重，同时保留源题库 ID 方便追溯；
 * 4. 只复制网页实际引用的题目图片和视频，避免把标志库等无关资源一起打包；
 * 5. 分别输出 KEMU1_BANK / KEMU4_BANK，方便页面按科目独立统计进度。
 *
 * ID 兼容策略：
 * 科目一沿用原来的题号，保证已经保存的科一学习记录不丢失；
 * 科目四统一加 k4- 前缀，规避两科源题号重叠导致的记录串题。
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

const SUBJECTS = [
  { key: 'ke1', variable: 'KEMU1', exam: '科目一', idPrefix: '' },
  { key: 'ke4', variable: 'KEMU4', exam: '科目四', idPrefix: 'k4-' },
];

/**
 * 同一科目内，题干和选项完全相同时才视为重复。
 * 科目一、科目四即使题干相同，也可能属于不同考试，因此不能跨科目去重。
 */
function buildSubject(subject) {
  const bySignature = new Map();
  for (const source of sourceQuestions) {
    if (!source || source.subject !== subject.key || !source.question || !source.options) continue;

    const options = source.options.map(htmlToText).filter(Boolean);
    if (options.length < 2) continue;

    const answer = answerToIndexes(source.answer);
    if (!answer.length || answer.some((index) => index >= options.length)) continue;

    const signature = [htmlToText(source.question), ...options].join('\u0000');
    const image = source.image ? path.basename(source.image) : '';
    const sourceId = source.qid ? String(source.qid) : String(source.id);
    const normalized = {
      id: `${subject.idPrefix}${sourceId}`,
      sourceIds: [String(source.id)],
      subject: subject.key,
      subjectName: subject.exam,
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
  return [...bySignature.values()];
}

const subjectBanks = Object.fromEntries(
  SUBJECTS.map((subject) => [subject.key, buildSubject(subject)]),
);

const copiedImages = new Set();
for (const questions of Object.values(subjectBanks)) {
  for (const question of questions) {
    if (!question.image) continue;
    const filename = path.basename(question.image);
    const sourceImage = path.join(sourceImageRoot, 'questions', filename);
    if (!fs.existsSync(sourceImage)) {
      console.warn(`媒体缺失，已移除引用：${filename}`);
      question.image = '';
      continue;
    }
    if (!copiedImages.has(filename)) {
      fs.copyFileSync(sourceImage, path.join(imageOutputRoot, filename));
      copiedImages.add(filename);
    }
  }
}

const metas = Object.fromEntries(
  SUBJECTS.map((subject) => {
    const questions = subjectBanks[subject.key];
    const chapters = [...new Set(questions.map((question) => question.chapter))].sort((a, b) =>
      a.localeCompare(b, 'zh-CN'),
    );
    return [
      subject.key,
      {
        title: `厦门${subject.exam}快刷题库`,
        version: '2026.10',
        exam: subject.exam,
        region: '厦门考区适用',
        source: `公开 2026 ${subject.exam}题库（题型整理，非官方实时接口）`,
        sourceRepository: 'https://github.com/xfhxly/KeMuONEXueKao',
        generatedAt: new Date().toISOString(),
        questionCount: questions.length,
        mediaCount: questions.filter((question) => question.image).length,
        chapters,
      },
    ];
  }),
);

const output = [
  '/* 自动生成文件，请运行 tools/build-kemu1-data.js 更新。 */',
  ...SUBJECTS.flatMap((subject) => [
    `window.${subject.variable}_META = ${JSON.stringify(metas[subject.key])};`,
    `window.${subject.variable}_BANK = ${JSON.stringify(subjectBanks[subject.key])};`,
  ]),
  '',
].join('\n');

fs.writeFileSync(path.join(outputRoot, 'data.js'), output);

const summary = SUBJECTS.map((subject) => {
  const meta = metas[subject.key];
  return `${subject.exam} ${meta.questionCount} 题 / ${meta.chapters.length} 章`;
}).join('，');
console.log(`已生成 ${summary}，共 ${copiedImages.size} 个媒体文件：${path.join(outputRoot, 'data.js')}`);
