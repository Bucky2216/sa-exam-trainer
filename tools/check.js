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

  // —— 准确性检查（针对历史上真出现过的两类错误）——
  // 1) 选项内容重复或互相包含：会造成选项歧义
  // 注意：只去掉空格与中文标点，保留小数点和数字（否则 "8.76 小时" 与 "87.6 小时" 会被误判为相同）
  const opts = Object.keys(q.options || {}).map(L => ({ L, text: String(q.options[L]).replace(/\s|[（）()、，,。；;：:]/g, '') }));
  for(let a = 0; a < opts.length; a++){
    for(let b = a + 1; b < opts.length; b++){
      if(!opts[a].text || !opts[b].text) continue;
      if(opts[a].text === opts[b].text){
        console.error('❌ 选项内容完全相同：', tag, opts[a].L, opts[b].L); err++;
      }else if(opts[a].text.length >= 8 && opts[b].text.length >= 8){
        // 互相包含才提示；排除两类假包含：
        //   ① "不XXX" 包含 "XXX"（否定词）
        //   ② "-9.1万元" 包含 "9.1万元"（负号）
        // 同时要求较短文本足够长（短选项如"满足2NF"属于选项表述差异，不算歧义）
        const pair = [[opts[a].text, opts[b].text], [opts[b].text, opts[a].text]];
        const realInclude = pair.some(function(p){
          const i = p[0].indexOf(p[1]);
          if(i < 0) return false;
          const prev = p[0][i - 1];
          return prev !== '不' && prev !== '-' && prev !== '－';
        });
        if(realInclude) console.error('⚠️ 选项互相包含（需人工确认是否有歧义）：', tag, opts[a].L, opts[b].L);
      }
    }
  }
  // 2) 解析里写明的答案字母与 answer 字段是否一致
  const pick = String(q.explanation).match(/(?:应选|答案为|答案是|正确选项是|正确答案是|故选)\s*([A-D])/g);
  if(pick){
    pick.forEach(function(m){
      const letter = m.replace(/[^A-D]/g, '');
      if((q.answer || []).indexOf(letter) < 0){
        console.error('❌ 解析与答案矛盾：', tag, '解析提到 ' + letter + '，但 answer=' + q.answer.join(','));
        err++;
      }
    });
  }
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
