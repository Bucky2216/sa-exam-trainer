// 校验脚本：提取 index.html 中的内联 JS，检查语法与题库结构（仅开发时使用，不参与交付）
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const file = path.join(__dirname, '..', 'outputs', 'index.html');   // 校验目标：应用本体
const html = fs.readFileSync(file, 'utf8');
const m = html.match(/<script>([\s\S]*)<\/script>/);
if(!m){ console.error('未找到 script 块'); process.exit(1); }
let js = m[1];

// 去掉启动调用，避免在 node 中触碰 DOM
js = js.replace(/\ninit\(\);\s*$/, '\n');

// 极简桩：localStorage / console
const store = {};
const sandbox = {
  console,
  localStorage:{ getItem:k => (k in store ? store[k] : null), setItem:(k,v) => { store[k] = String(v); }, removeItem:k => { delete store[k]; } },
  setTimeout, clearTimeout, Date, Math, JSON, Set, Map, Array, Object, String, Number, RegExp, Error
};
sandbox.globalThis = sandbox;

let out;
try{
  vm.createContext(sandbox);
  out = vm.runInContext(js + '\n;({ QB:QUESTION_BANK, CB:CASE_BANK, MODULES:MODULES, state:state });', sandbox, { filename:'inline.js' });
}catch(e){
  console.error('语法/运行错误：', e.message);
  console.error(e.stack.split('\n').slice(0, 5).join('\n'));
  process.exit(1);
}

const QB = out.QB, CB = out.CB;
console.log('选择题总数：', QB.length);
console.log('案例题总数：', CB.length);

const byMod = {};
QB.forEach(q => { byMod[q.module] = (byMod[q.module] || 0) + 1; });
console.log('\n模块配比：');
Object.keys(byMod).forEach(k => console.log('  ' + k + '：' + byMod[k]));

const byType = {};
QB.forEach(q => { byType[q.type] = (byType[q.type] || 0) + 1; });
console.log('\n题型：', JSON.stringify(byType));

const byDiff = {};
QB.forEach(q => { byDiff[q.difficulty] = (byDiff[q.difficulty] || 0) + 1; });
console.log('难度分布：', JSON.stringify(byDiff));

let err = 0;
const ids = new Set();
QB.forEach((q, i) => {
  const tag = q.id || ('#' + i);
  if(!q.id || !q.stem || !q.explanation || !q.module) { console.error('❌ 字段缺失：', tag); err++; }
  if(ids.has(q.id)) { console.error('❌ id 重复：', tag); err++; }
  ids.add(q.id);
  if(!q.answer || !q.answer.length) { console.error('❌ 无答案：', tag); err++; }
  (q.answer || []).forEach(a => { if(!q.options || !(a in q.options)) { console.error('❌ 答案不在选项中：', tag, a); err++; } });
  if(Object.keys(q.options || {}).length !== 4) { console.error('❌ 选项不是 4 个：', tag); err++; }
  if(q.type === 'single' && q.answer.length !== 1) { console.error('❌ 单选题多答案：', tag); err++; }
  if(q.type === 'multi' && q.answer.length < 2) { console.error('❌ 多选题答案过少：', tag); err++; }
  if(!(q.difficulty >= 1 && q.difficulty <= 5)) { console.error('❌ 难度越界：', tag); err++; }
  if(['高频','中频','低频'].indexOf(q.frequency) < 0) { console.error('❌ 考频异常：', tag); err++; }
});

const cids = new Set();
CB.forEach((c, i) => {
  const tag = c.id || ('case#' + i);
  if(cids.has(c.id)) { console.error('❌ 案例 id 重复：', tag); err++; }
  cids.add(c.id);
  if(!c.scenario || !c.module) { console.error('❌ 案例字段缺失：', tag); err++; }
  if(!Array.isArray(c.questions) || !c.questions.length) { console.error('❌ 案例无小题：', tag); err++; }
  (c.questions || []).forEach((q, j) => {
    if(!q.q || !q.answer || !q.scoring || !(q.points > 0)) { console.error('❌ 案例小题字段缺失：', tag + '#' + (j + 1)); err++; }
  });
});

// 计算题解析是否给出公式/过程（简单启发式）
const calcIds = ['SA-001','SA-004','SA-005','SA-006','SA-010','SA-012','SA-050','SA-086','SA-089','SA-090','SA-096','SA-097','SA-098','SA-099'];
calcIds.forEach(id => {
  const q = QB.find(x => x.id === id);
  if(!q){ console.error('❌ 缺失计算题：', id); err++; return; }
  const hasFormula = /[=＝]/.test(q.explanation) && /(公式|代入|计算|判定|步骤|×|\/)/.test(q.explanation);
  if(!hasFormula) { console.error('⚠️ 计算题缺少过程：', id); }
});

// 检查页面元素 id 是否与 JS 引用一致
const htmlIds = new Set([...html.matchAll(/id="([^"]+)"/g)].map(x => x[1]));
const refs = new Set([...js.matchAll(/\$\('#([A-Za-z0-9_-]+)'\)/g)].map(x => x[1]));
const missing = [...refs].filter(r => {
  // 动态创建（渲染后才有）的元素允许缺失
  const dynamic = ['btnExamStart','btnExamResume','btnExamAgain','btnExamBack','btnCopyReport','btnExport2','btnExportRecords','btnImport2','btnClearRecords'];
  if(dynamic.includes(r)) return false;
  return !htmlIds.has(r) && !html.includes('id="' + r + '"');
});
if(missing.length){ console.error('❌ JS 引用但页面不存在的 id：', missing.join(', ')); err++; }

console.log('\n检查结果：' + (err ? ('发现 ' + err + ' 个问题') : '全部通过 ✅'));
process.exit(err ? 1 : 0);
