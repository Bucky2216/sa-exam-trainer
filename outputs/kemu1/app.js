/* global MOTO_D_BANK, MOTO_D_META */

/**
 * 厦门摩托车 D 照科目一快刷应用
 *
 * 数据流：
 *   data.js（题库） -> state（筛选、题单、答题记录） -> render（DOM）
 *
 * 设计取舍：
 * 1. 不引入框架，页面可以直接通过任意静态服务器打开，也可以离线使用；
 * 2. 所有题库文本都通过 escapeHtml 后再写入 innerHTML，避免第三方题目注入脚本；
 * 3. 学习记录只存 localStorage，不上传任何服务器；
 * 4. 题单一经生成就固定，避免答题过程中因为排序变化而“原地换题”；
 * 5. 跳过不等于做过，只有真正提交答案才会更新“已做”记录。
 */

(() => {
  'use strict';

  const STATE_KEY = 'MOTO_D_XIAMEN_STATE_V1';
  const LETTERS = ['A', 'B', 'C', 'D', 'E', 'F'];
  const AUTO_NEXT_DELAY = 850;
  const SUBJECT_CONFIG = {
    ke1: {
      key: 'ke1',
      name: '摩托车 D 照科目一',
      shortName: 'D照科一',
      idPrefix: 'moto-',
      bank: typeof MOTO_D_BANK !== 'undefined' ? MOTO_D_BANK : [],
      meta: typeof MOTO_D_META !== 'undefined' ? MOTO_D_META : {},
      importedKey: 'MOTO_D_XIAMEN_IMPORTED_BANK_V1',
    },
  };

  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));

  let toastTimer = 0;
  let autoNextTimer = 0;
  let activeSubject = 'ke1';
  let activeBank = [];
  let activeMeta = {};

  /**
   * HTML 转义是本应用唯一的文本安全入口。
   * 题库、导入文件和用户收藏都可能包含特殊字符，因此在拼接 innerHTML 前统一处理。
   */
  function escapeHtml(value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function todayKey(date = new Date()) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  function shuffle(list) {
    const result = list.slice();
    for (let index = result.length - 1; index > 0; index -= 1) {
      const randomIndex = Math.floor(Math.random() * (index + 1));
      [result[index], result[randomIndex]] = [result[randomIndex], result[index]];
    }
    return result;
  }

  function answerKey(answer) {
    return (Array.isArray(answer) ? answer : []).slice().sort((a, b) => a - b).join(',');
  }

  function showToast(message) {
    const toast = $('#toast');
    toast.textContent = message;
    toast.classList.add('show');
    window.clearTimeout(toastTimer);
    toastTimer = window.setTimeout(() => toast.classList.remove('show'), 2200);
  }

  function defaultState() {
    return {
      records: {},
      wrong: {},
      favorites: {},
      daily: {},
      session: {
        subject: 'ke1',
        queue: [],
        position: 0,
        selected: [],
        submitted: false,
        roundComplete: false,
        roundAnswered: 0,
        roundCorrect: 0,
        filters: {
          chapter: '',
          onlyUnseen: false,
          onlyWrong: false,
          onlyFavorite: false,
        },
      },
      settings: {
        autoNext: true,
      },
    };
  }

  /** 合并旧版本状态，保证新增字段不会因为 localStorage 里缺少字段而报错。 */
  function loadState() {
    const base = defaultState();
    try {
      const raw = localStorage.getItem(STATE_KEY);
      if (!raw) return base;
      const saved = JSON.parse(raw);
      return {
        ...base,
        ...saved,
        records: saved.records && typeof saved.records === 'object' ? saved.records : {},
        wrong: saved.wrong && typeof saved.wrong === 'object' ? saved.wrong : {},
        favorites: saved.favorites && typeof saved.favorites === 'object' ? saved.favorites : {},
        daily: saved.daily && typeof saved.daily === 'object' ? saved.daily : {},
        session: {
          ...base.session,
          ...(saved.session || {}),
          filters: {
            ...base.session.filters,
            ...((saved.session && saved.session.filters) || {}),
          },
        },
        settings: {
          ...base.settings,
          ...(saved.settings || {}),
        },
      };
    } catch (error) {
      console.warn('读取本地状态失败，已使用空记录。', error);
      return base;
    }
  }

  const state = loadState();

  function saveState() {
    try {
      localStorage.setItem(STATE_KEY, JSON.stringify(state));
    } catch (error) {
      console.warn('保存学习记录失败。', error);
      showToast('本地存储失败，请检查浏览器存储权限或空间');
    }
  }

  function findQuestion(id) {
    return activeBank.find((question) => question.id === id) || null;
  }

  function currentQuestion() {
    return findQuestion(state.session.queue[state.session.position]);
  }

  function isAnswered(id) {
    return Boolean(state.records[id]);
  }

  function isWrong(id) {
    return Boolean(state.wrong[id]);
  }

  /**
   * 从导入文件里兼容多种常见题库字段：
   * - options 可以是数组，也可以是 { A: "…", B: "…" }；
   * - answer 可以是数字、数组，也可以是 "A"、"A,C"、"13"；
   * - 解析常见键名包括 analysis、explanation、remark、bestanswer。
   *
   * 导入数据会被规范化成与内置题库相同的结构，渲染层因此不需要写第二套分支。
   */
  function normalizeAnswer(rawAnswer, optionsLength) {
    const convertToken = (token) => {
      const text = String(token).trim().toUpperCase();
      if (/^[A-F]$/.test(text)) return text.charCodeAt(0) - 65;
      const number = Number(text);
      if (!Number.isInteger(number)) return -1;
      // 题库里常见“1=A、2=B”的答案编号；0 则按数组下标处理。
      return number >= 1 && number <= optionsLength ? number - 1 : number;
    };

    let tokens;
    if (Array.isArray(rawAnswer)) {
      tokens = rawAnswer;
    } else if (typeof rawAnswer === 'string' && rawAnswer.includes(',')) {
      tokens = rawAnswer.split(',');
    } else if (typeof rawAnswer === 'string' && /^[A-F]{2,}$/i.test(rawAnswer)) {
      tokens = rawAnswer.split('');
    } else if (typeof rawAnswer === 'string' && /^\d{2,}$/.test(rawAnswer)) {
      tokens = rawAnswer.split('');
    } else {
      tokens = [rawAnswer];
    }

    return [...new Set(tokens.map(convertToken))]
      .filter((index) => index >= 0 && index < optionsLength)
      .sort((a, b) => a - b);
  }

  function normalizeOptions(rawOptions) {
    if (Array.isArray(rawOptions)) {
      return rawOptions.map((item) => String(item).trim()).filter(Boolean);
    }
    if (rawOptions && typeof rawOptions === 'object') {
      return Object.keys(rawOptions)
        .sort()
        .map((key) => String(rawOptions[key]).trim())
        .filter(Boolean);
    }
    if (typeof rawOptions === 'string') {
      return rawOptions
        .split(/[,，|]/)
        .map((item) => item.replace(/^[A-FＡ-Ｆ]\s*[:：.]?\s*/i, '').trim())
        .filter(Boolean);
    }
    return [];
  }

  function normalizeImportedBank(payload, subject = 'ke1') {
    const subjectConfig = SUBJECT_CONFIG[subject] || SUBJECT_CONFIG.ke1;
    const source = Array.isArray(payload)
      ? payload
      : Array.isArray(payload && payload.questions)
        ? payload.questions
        : Array.isArray(payload && payload.data)
          ? payload.data
          : null;

    if (!source) throw new Error('JSON 中没有找到题目数组');

    const result = [];
    const signatures = new Set();

    source.forEach((item, index) => {
      if (!item || typeof item !== 'object') return;
      const question = String(item.question || item.stem || item.title || '').trim();
      const options = normalizeOptions(item.options || item.itemsDescArray);
      if (!question || options.length < 2) return;

      const rawAnswer =
        item.answer ?? item.correctAnswer ?? item.right ?? item.ta ?? item.correct ?? '';
      const answer = normalizeAnswer(rawAnswer, options.length);
      if (!answer.length) return;

      const signature = [question, ...options].join('\u0000');
      if (signatures.has(signature)) return;
      signatures.add(signature);

      const rawType = String(item.type || '').toLowerCase();
      const type =
        answer.length > 1 || rawType === 'multi' || rawType === 'multiple'
          ? 'multi'
          : options.length === 2 || rawType === 'judge' || rawType === 'judgment'
            ? 'judge'
            : 'single';

      const rawId = String(item.id ?? item.qid ?? `import-${index + 1}`);
      result.push({
        // 导入题号统一加 moto- 前缀，避免与外部题库的普通数字题号冲突。
        id: `${subjectConfig.idPrefix}${rawId}`,
        sourceIds: [String(item.id ?? item.qid ?? index + 1)],
        subject,
        subjectName: subjectConfig.name,
        type,
        chapter: String(item.chapter_name || item.chapterName || item.chapter || '导入题库').trim(),
        question,
        options,
        answer,
        analysis: String(
          item.analysis || item.explanation || item.remark || item.bestanswer || '',
        ).trim(),
        mnemonic: String(item.mnemonic || '').trim(),
        concise: String(item.concise_analysis || item.answerSkill || '').trim(),
        image: String(item.image || item.imageurl || item.url || '').trim(),
      });
    });

    if (!result.length) throw new Error('没有找到字段完整且答案有效的题目');
    return result;
  }

  function buildMetaForImported(bank, subject = 'ke1') {
    const subjectConfig = SUBJECT_CONFIG[subject] || SUBJECT_CONFIG.ke1;
    return {
      title: `我的${subjectConfig.name}导入题库`,
      version: todayKey(),
      exam: subjectConfig.name,
      region: '厦门考区适用',
      source: '浏览器本地导入',
      questionCount: bank.length,
      imageCount: bank.filter((question) => question.image).length,
      chapters: [...new Set(bank.map((question) => question.chapter))].sort((a, b) =>
        a.localeCompare(b, 'zh-CN'),
      ),
    };
  }

  /**
   * 导入题库优先于内置题库，并保存在单独的 localStorage 键里。
   * 这样清空学习进度时不会误删用户导入的题库。
   */
  function resolveBank(subject = 'ke1') {
    const subjectConfig = SUBJECT_CONFIG[subject] || SUBJECT_CONFIG.ke1;
    activeSubject = subjectConfig.key;
    try {
      const raw = localStorage.getItem(subjectConfig.importedKey);
      if (raw) {
        const imported = JSON.parse(raw);
        if (Array.isArray(imported) && imported.length) {
          activeBank = imported;
          activeMeta = buildMetaForImported(imported, activeSubject);
          return;
        }
      }
    } catch (error) {
      console.warn('读取导入题库失败，将回退到内置题库。', error);
    }

    activeBank = Array.isArray(subjectConfig.bank) ? subjectConfig.bank.slice() : [];
    activeMeta = subjectConfig.meta || {};
  }

  function recordAttempt(question, correct) {
    const id = question.id;
    const now = Date.now();
    const record = state.records[id] || { seen: 0, correct: 0, last: 0 };
    record.seen += 1;
    record.correct += correct ? 1 : 0;
    record.last = now;
    state.records[id] = record;

    const day = todayKey();
    const daily = state.daily[day] || { total: 0, correct: 0 };
    daily.total += 1;
    daily.correct += correct ? 1 : 0;
    state.daily[day] = daily;

    if (correct) {
      // 错题重练答对后直接移出，减少维护错题本的操作成本。
      if (state.wrong[id]) delete state.wrong[id];
    } else {
      const wrongRecord = state.wrong[id] || { count: 0, last: 0 };
      wrongRecord.count += 1;
      wrongRecord.last = now;
      state.wrong[id] = wrongRecord;
    }
  }

  function poolForCurrentFilters() {
    const filters = state.session.filters;
    return activeBank.filter((question) => {
      if (filters.chapter && question.chapter !== filters.chapter) return false;
      if (filters.onlyUnseen && isAnswered(question.id)) return false;
      if (filters.onlyWrong && !isWrong(question.id)) return false;
      if (filters.onlyFavorite && !state.favorites[question.id]) return false;
      return true;
    });
  }

  /**
   * “未做优先”不是单纯打乱，而是把题单分成三组：
   * 1. 从未作答：最优先，保持题库原始顺序，便于按法规章节形成知识脉络；
   * 2. 已做且仍在错题本：第二优先，错得越多越靠前；
   * 3. 其他已做题：按上次作答时间由远到近，实现间隔复习。
   */
  function buildQueue() {
    const pool = poolForCurrentFilters();
    const sourceIndex = new Map(activeBank.map((question, index) => [question.id, index]));

    const unseen = pool.filter((question) => !isAnswered(question.id));
    const wrong = pool
      .filter((question) => isAnswered(question.id) && isWrong(question.id))
      .sort((left, right) => {
        const leftWrong = state.wrong[left.id] || {};
        const rightWrong = state.wrong[right.id] || {};
        return (
          Number(rightWrong.count || 0) - Number(leftWrong.count || 0) ||
          Number(leftWrong.last || 0) - Number(rightWrong.last || 0)
        );
      });
    const reviewed = pool
      .filter((question) => isAnswered(question.id) && !isWrong(question.id))
      .sort((left, right) => {
        const leftRecord = state.records[left.id] || {};
        const rightRecord = state.records[right.id] || {};
        return Number(leftRecord.last || 0) - Number(rightRecord.last || 0);
      });

    // 原始顺序只用于同一优先级内部，避免每次生成题单都完全重排。
    unseen.sort((left, right) => sourceIndex.get(left.id) - sourceIndex.get(right.id));

    state.session.queue = [...unseen, ...wrong, ...reviewed].map((question) => question.id);
    state.session.position = 0;
    state.session.selected = [];
    state.session.submitted = false;
    state.session.roundComplete = state.session.queue.length === 0;
    state.session.roundAnswered = 0;
    state.session.roundCorrect = 0;
    saveState();
  }

  function restoreOrCreateQueue() {
    const ids = new Set(activeBank.map((question) => question.id));
    const savedQueue = Array.isArray(state.session.queue)
      ? state.session.queue.filter((id) => ids.has(id))
      : [];

    if (savedQueue.length) {
      state.session.queue = savedQueue;
      state.session.position = clamp(
        Number(state.session.position) || 0,
        0,
        Math.max(0, savedQueue.length - 1),
      );
      state.session.selected = Array.isArray(state.session.selected)
        ? state.session.selected.filter(Number.isInteger)
        : [];
    } else {
      buildQueue();
    }
  }

  function populateChapters() {
    const select = $('#chapterSelect');
    const chapters =
      Array.isArray(activeMeta.chapters) && activeMeta.chapters.length
        ? activeMeta.chapters
        : [...new Set(activeBank.map((question) => question.chapter))];

    select.innerHTML = [
      '<option value="">全部章节</option>',
      ...chapters.map(
        (chapter) =>
          `<option value="${escapeHtml(chapter)}">${escapeHtml(chapter)}</option>`,
      ),
    ].join('');
    select.value = state.session.filters.chapter || '';
  }

  function syncFilterControls() {
    const filters = state.session.filters;
    $('#chapterSelect').value = filters.chapter || '';
    $('#onlyUnseen').checked = Boolean(filters.onlyUnseen);
    $('#onlyWrong').checked = Boolean(filters.onlyWrong);
    $('#onlyFavorite').checked = Boolean(filters.onlyFavorite);
  }

  function updateFilterFromControls() {
    state.session.filters = {
      chapter: $('#chapterSelect').value,
      onlyUnseen: $('#onlyUnseen').checked,
      onlyWrong: $('#onlyWrong').checked,
      onlyFavorite: $('#onlyFavorite').checked,
    };
    buildQueue();
    render();
  }

  function typeLabel(type) {
    if (type === 'multi') return '多选题';
    if (type === 'judge') return '判断题';
    return '单选题';
  }

  function filterLabel() {
    const filters = state.session.filters;
    if (filters.chapter) return filters.chapter;
    if (filters.onlyWrong) return '错题速刷';
    if (filters.onlyFavorite) return '收藏题单';
    if (filters.onlyUnseen) return '仅未做';
    return '未做优先';
  }

  function renderStats() {
    const bankCount = activeBank.length;
    // 统计必须限制在当前科目题库内，否则切换科目时会把另一科记录算进来。
    const records = activeBank
      .map((question) => state.records[question.id])
      .filter(Boolean);
    const answered = records.length;
    const seenTotal = records.reduce((sum, record) => sum + Number(record.seen || 0), 0);
    const correctTotal = records.reduce((sum, record) => sum + Number(record.correct || 0), 0);
    const accuracy = seenTotal ? Math.round((correctTotal / seenTotal) * 100) : null;
    const wrongCount = activeBank.filter((question) => isWrong(question.id)).length;
    const favoriteCount = activeBank.filter((question) => state.favorites[question.id]).length;
    const unseenCount = activeBank.filter((question) => !isAnswered(question.id)).length;
    // 题库很大，做一题时四舍五入仍会显示 0%；用“<1%”保留有效的开始反馈。
    const completionRaw = bankCount ? (answered / bankCount) * 100 : 0;
    const completion = Math.round(completionRaw);
    const completionLabel =
      answered > 0 && completionRaw < 1 ? '<1%' : `${completion}%`;

    $('#progressRing').style.setProperty('--value', completionRaw);
    $('#progressPercent').textContent = completionLabel;
    $('#answeredCount').textContent = String(answered);
    $('#remainingCount').textContent = `还剩 ${unseenCount} 道没做`;
    $('#accuracyCount').textContent = accuracy === null ? '--' : `${accuracy}%`;
    $('#wrongCount').textContent = String(wrongCount);
    $('#favoriteCount').textContent = String(favoriteCount);
    $('#unseenCount').textContent = `${unseenCount} 题`;
    $('#wrongActionCount').textContent = `${wrongCount} 题`;

    const queueLength = state.session.queue.length;
    const queueProgress = state.session.roundComplete
      ? 100
      : queueLength
        ? ((state.session.position + 1) / queueLength) * 100
        : 0;
    $('#queueProgress').style.width = `${clamp(queueProgress, 0, 100)}%`;
  }

  function renderSourceInfo() {
    const count = activeBank.length;
    const source = activeMeta.source || '公开题库';
    const version = activeMeta.version || '';
    $('#sourceNote').textContent = `${count} 题 · ${source}`;
    $('#bankInfoText').textContent = `${activeMeta.title || `${activeMeta.exam || ''}题库`} · ${count} 题 · ${
      activeMeta.region || '厦门考区适用'
    } · 版本 ${version} · ${source}`;
  }

  function optionsHtml(question) {
    const { submitted, selected } = state.session;
    return question.options
      .map((text, index) => {
        const isSelected = selected.includes(index);
        const isCorrect = submitted && question.answer.includes(index);
        const isWrongChoice = submitted && isSelected && !question.answer.includes(index);
        const classes = [
          'option',
          isSelected ? 'selected' : '',
          isCorrect ? 'correct' : '',
          isWrongChoice ? 'wrong' : '',
        ]
          .filter(Boolean)
          .join(' ');
        return `
          <button class="${classes}" type="button" data-option="${index}"
                  aria-pressed="${isSelected}" ${
            submitted ? 'disabled' : ''
          }>
            <span class="option-key">${LETTERS[index] || index + 1}</span>
            <span class="option-text">${escapeHtml(text)}</span>
          </button>
        `;
      })
      .join('');
  }

  function resultHtml(question, correct) {
    const answerLetters = question.answer.map((index) => LETTERS[index] || index + 1).join('、');
    const analysis =
      question.analysis ||
      question.concise ||
      '本题暂无详细解析，请结合题干与正确答案复习。';
    const mnemonic =
      question.mnemonic &&
      question.mnemonic !== question.concise &&
      !analysis.includes(question.mnemonic)
        ? `<div class="mnemonic">速记：${escapeHtml(question.mnemonic)}</div>`
        : '';

    return `
      <section class="result-panel ${correct ? 'correct' : 'wrong'}">
        <div class="result-head">
          <span class="result-icon">${correct ? '✓' : '×'}</span>
          <span>${correct ? '回答正确' : '回答错误'}</span>
          <span class="result-answer">正确答案：${answerLetters}</span>
        </div>
        <div class="analysis-title">题目解析</div>
        <p class="analysis-text">${escapeHtml(analysis)}</p>
        ${mnemonic}
      </section>
    `;
  }

  function questionActionsHtml(question) {
    const atEnd = state.session.position >= state.session.queue.length - 1;
    const multiSubmit =
      question.type === 'multi' && !state.session.submitted
        ? `<button class="primary-button" id="btnSubmitMulti" type="button" ${
            state.session.selected.length ? '' : 'disabled'
          }>提交答案</button>`
        : '';

    return `
      <div class="question-actions">
        <button class="secondary-button" id="btnPrev" type="button" ${
          state.session.position <= 0 ? 'disabled' : ''
        }>上一题</button>
        ${multiSubmit}
        <span class="grow"></span>
        <button class="secondary-button" id="btnSkip" type="button">跳过</button>
        <button class="primary-button" id="btnNext" type="button">${
          atEnd ? '查看本轮结果' : '下一题'
        }</button>
      </div>
    `;
  }

  function renderQuestion() {
    const card = $('#questionCard');
    const question = currentQuestion();
    const total = state.session.queue.length;

    if (!activeBank.length) {
      card.innerHTML = `
        <div class="empty-state">
          <div>
            <div class="empty-icon">⚠</div>
            <h2>题库没有加载成功</h2>
            <p>请确认 data.js 与 index.html 位于同一目录，然后刷新页面。</p>
          </div>
        </div>
      `;
      return;
    }

    if (state.session.roundComplete || !question) {
      const answered = Number(state.session.roundAnswered || 0);
      const correct = Number(state.session.roundCorrect || 0);
      const accuracy = answered ? Math.round((correct / answered) * 100) : 0;
      card.innerHTML = `
        <div class="complete-card">
          <div class="empty-icon">${total ? '🏁' : '🗂'}</div>
          <h2>${total ? '本轮完成' : '当前筛选下没有题目'}</h2>
          <p>${total ? '本轮作答情况' : '可以切换章节或取消筛选，再生成一轮题单。'}</p>
          ${
            total
              ? `<div class="score">${accuracy}%</div>
                 <p>本轮作答 ${answered} 题，答对 ${correct} 题</p>`
              : ''
          }
          <div class="question-actions" style="justify-content:center">
            <button class="secondary-button" id="btnBackLast" type="button" ${
              total ? '' : 'disabled'
            }>返回上一题</button>
            <button class="primary-button" id="btnRestartRound" type="button">生成新题单</button>
          </div>
        </div>
      `;
      $('#btnRestartRound').addEventListener('click', () => {
        buildQueue();
        render();
      });
      if (total) {
        $('#btnBackLast').addEventListener('click', () => {
          state.session.roundComplete = false;
          state.session.position = Math.max(0, total - 1);
          saveState();
          render();
        });
      }
      return;
    }

    const submitted = Boolean(state.session.submitted);
    const correct =
      submitted && answerKey(state.session.selected) === answerKey(question.answer);
    // 题库里的媒体字段可能包含静态图片或动画题视频。
    const isVideo = /\.(mp4|webm|ogg)(?:[?#].*)?$/i.test(question.image || '');
    const media = question.image
      ? `
        <figure class="question-image-wrap">
          ${
            isVideo
              ? `<video class="question-video" src="${escapeHtml(question.image)}"
                        controls autoplay muted loop playsinline
                        aria-label="第 ${state.session.position + 1} 题的题目动画"></video>`
              : `<img class="question-image" src="${escapeHtml(question.image)}"
                      alt="第 ${state.session.position + 1} 题的题目配图">`
          }
        </figure>
      `
      : '';
    const favoriteActive = Boolean(state.favorites[question.id]);

    card.innerHTML = `
      <div class="question-meta">
        <span class="tag number">第 ${state.session.position + 1} / ${total} 题</span>
        <span class="tag type">${typeLabel(question.type)}</span>
        <span class="tag">${escapeHtml(question.chapter)}</span>
        <button class="favorite-button ${favoriteActive ? 'active' : ''}"
                id="btnFavorite" type="button" aria-pressed="${favoriteActive}"
                title="${favoriteActive ? '取消收藏' : '收藏本题'}">${favoriteActive ? '★' : '☆'}</button>
      </div>
      <h1 class="stem">${escapeHtml(question.question)}</h1>
      <div class="question-brief">${
        question.type === 'multi'
          ? '多选题：选完后按 Enter 或点击“提交答案”'
          : '选择答案后立即显示解析'
      }</div>
      ${media}
      <div class="options" id="optionsList">${optionsHtml(question)}</div>
      ${submitted ? resultHtml(question, correct) : ''}
      ${questionActionsHtml(question)}
    `;

    $$('#optionsList .option').forEach((button) => {
      button.addEventListener('click', () => chooseOption(Number(button.dataset.option)));
    });
    $('#btnFavorite').addEventListener('click', toggleFavorite);
    $('#btnPrev').addEventListener('click', previousQuestion);
    $('#btnSkip').addEventListener('click', nextQuestion);
    $('#btnNext').addEventListener('click', nextQuestion);
    if ($('#btnSubmitMulti')) {
      $('#btnSubmitMulti').addEventListener('click', submitCurrentAnswer);
    }

    const mediaElement = $('.question-image, .question-video', card);
    if (mediaElement) {
      mediaElement.addEventListener('error', () => {
        mediaElement.closest('.question-image-wrap').innerHTML =
          '<div class="empty-icon" style="font-size:28px;text-align:center">题目媒体暂时无法加载</div>';
      });
    }
  }

  function render() {
    $('#modeLabel').textContent = `${activeMeta.exam || activeSubject} · ${filterLabel()}`;
    document.title = `${SUBJECT_CONFIG[activeSubject]?.shortName || '驾考'}快刷 · 厦门 2026`;
    renderStats();
    renderSourceInfo();
    renderQuestion();
  }

  function chooseOption(index) {
    if (state.session.submitted) return;
    const question = currentQuestion();
    if (!question || !Number.isInteger(index) || !question.options[index]) return;

    if (question.type === 'multi') {
      const selected = new Set(state.session.selected);
      if (selected.has(index)) selected.delete(index);
      else selected.add(index);
      state.session.selected = [...selected].sort((a, b) => a - b);
      saveState();
      render();
      return;
    }

    state.session.selected = [index];
    submitCurrentAnswer();
  }

  function submitCurrentAnswer() {
    const question = currentQuestion();
    if (!question || state.session.submitted) return;
    if (!state.session.selected.length) {
      showToast('请先选择答案');
      return;
    }

    const correct =
      answerKey(state.session.selected) === answerKey(question.answer);
    state.session.submitted = true;
    state.session.roundAnswered += 1;
    if (correct) state.session.roundCorrect += 1;
    recordAttempt(question, correct);
    saveState();
    render();

    if (correct && state.settings.autoNext) {
      window.clearTimeout(autoNextTimer);
      autoNextTimer = window.setTimeout(() => {
        if (currentQuestion()?.id === question.id && state.session.submitted) {
          nextQuestion();
        }
      }, AUTO_NEXT_DELAY);
    }
  }

  function previousQuestion() {
    window.clearTimeout(autoNextTimer);
    if (state.session.roundComplete) state.session.roundComplete = false;
    if (state.session.position > 0) {
      state.session.position -= 1;
      state.session.selected = [];
      state.session.submitted = false;
      saveState();
      render();
      $('#questionCard').scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }

  function nextQuestion() {
    window.clearTimeout(autoNextTimer);
    if (!state.session.queue.length) return;

    if (state.session.position < state.session.queue.length - 1) {
      state.session.position += 1;
    } else {
      state.session.roundComplete = true;
    }
    state.session.selected = [];
    state.session.submitted = false;
    saveState();
    render();
    $('#questionCard').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function toggleFavorite() {
    const question = currentQuestion();
    if (!question) return;
    if (state.favorites[question.id]) {
      delete state.favorites[question.id];
      showToast('已取消收藏');
    } else {
      state.favorites[question.id] = Date.now();
      showToast('已收藏');
    }
    saveState();
    render();
  }

  function jumpToQuestion() {
    const input = $('#jumpInput');
    const target = Number(input.value);
    const total = state.session.queue.length;
    if (!Number.isInteger(target) || target < 1 || target > total) {
      showToast(`请输入 1-${total} 之间的题号`);
      return;
    }
    state.session.position = target - 1;
    state.session.selected = [];
    state.session.submitted = false;
    state.session.roundComplete = false;
    input.value = '';
    saveState();
    render();
    $('#questionCard').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function startFreshRound(message) {
    buildQueue();
    render();
    if (message) showToast(message);
  }

  function setOnlyUnseen() {
    state.session.filters = {
      chapter: '',
      onlyUnseen: true,
      onlyWrong: false,
      onlyFavorite: false,
    };
    syncFilterControls();
    startFreshRound('已生成未做题单');
  }

  function setOnlyWrong() {
    state.session.filters = {
      chapter: '',
      onlyUnseen: false,
      onlyWrong: true,
      onlyFavorite: false,
    };
    syncFilterControls();
    const wrongCount = activeBank.filter((question) => isWrong(question.id)).length;
    startFreshRound(wrongCount ? '已生成错题题单' : '暂无错题');
  }

  function resetProgress() {
    const confirmed = window.confirm(
      '确定清空摩托车 D 照科一的全部答题进度、错题和收藏吗？此操作不可撤销。',
    );
    if (!confirmed) return;

    state.records = {};
    state.wrong = {};
    state.favorites = {};
    state.daily = {};
    state.session = defaultState().session;
    state.session.subject = activeSubject;
    saveState();
    buildQueue();
    syncFilterControls();
    render();
    showToast('学习进度已清空');
  }

  function exportProgress() {
    const payload = {
      app: 'driving-theory-xiamen',
      exportedAt: new Date().toISOString(),
      bank: {
        subject: activeSubject,
        subjectName: activeMeta.exam,
        title: activeMeta.title,
        version: activeMeta.version,
        questionCount: activeBank.length,
      },
      records: state.records,
      wrong: state.wrong,
      favorites: state.favorites,
      daily: state.daily,
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], {
      type: 'application/json;charset=utf-8',
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${activeMeta.exam || activeSubject}学习记录-${todayKey()}.json`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
    showToast('学习记录已导出');
  }

  async function importBankFile(file) {
    if (!file) return;
    try {
      const text = await file.text();
      const imported = normalizeImportedBank(JSON.parse(text), activeSubject);
      localStorage.setItem(SUBJECT_CONFIG[activeSubject].importedKey, JSON.stringify(imported));
      activeBank = imported;
      activeMeta = buildMetaForImported(imported, activeSubject);
      state.session = defaultState().session;
      state.session.subject = activeSubject;
      populateChapters();
      syncFilterControls();
      buildQueue();
      render();
      $('#bankDialog').close();
      showToast(`已导入 ${imported.length} 题`);
    } catch (error) {
      console.error(error);
      showToast(`导入失败：${error.message}`);
    }
  }

  function restoreBuiltinBank() {
    localStorage.removeItem(SUBJECT_CONFIG[activeSubject].importedKey);
    resolveBank(activeSubject);
    state.session = defaultState().session;
    state.session.subject = activeSubject;
    populateChapters();
    syncFilterControls();
    buildQueue();
    render();
    $('#bankDialog').close();
    showToast('已恢复内置题库');
  }

  function openDialog(id) {
    const dialog = document.getElementById(id);
    if (dialog && !dialog.open) dialog.showModal();
  }

  function closeDialog(id) {
    const dialog = document.getElementById(id);
    if (dialog && dialog.open) dialog.close();
  }

  function bindEvents() {
    $('#btnHelp').addEventListener('click', () => openDialog('helpDialog'));
    $('#btnBank').addEventListener('click', () => openDialog('bankDialog'));
    $$('[data-close-dialog]').forEach((button) => {
      button.addEventListener('click', () => closeDialog(button.dataset.closeDialog));
    });
    $$('dialog').forEach((dialog) => {
      dialog.addEventListener('click', (event) => {
        if (event.target === dialog) dialog.close();
      });
    });

    // “只看未做”和“仅错题”在语义上互斥，勾选其中一个时自动取消另一个。
    $('#onlyUnseen').addEventListener('change', (event) => {
      if (event.target.checked) $('#onlyWrong').checked = false;
      updateFilterFromControls();
    });
    $('#onlyWrong').addEventListener('change', (event) => {
      if (event.target.checked) $('#onlyUnseen').checked = false;
      updateFilterFromControls();
    });
    ['#chapterSelect', '#onlyFavorite'].forEach((selector) => {
      $(selector).addEventListener('change', updateFilterFromControls);
    });
    $('#btnNewRound').addEventListener('click', () => startFreshRound('已按当前筛选生成新题单'));
    $('#btnContinue').addEventListener('click', setOnlyUnseen);
    $('#btnReviewWrong').addEventListener('click', setOnlyWrong);
    $('#btnJump').addEventListener('click', jumpToQuestion);
    $('#jumpInput').addEventListener('keydown', (event) => {
      if (event.key === 'Enter') jumpToQuestion();
    });

    $('#btnImport').addEventListener('click', () => $('#fileInput').click());
    $('#fileInput').addEventListener('change', async (event) => {
      const [file] = event.target.files;
      await importBankFile(file);
      event.target.value = '';
    });
    $('#btnRestoreBank').addEventListener('click', restoreBuiltinBank);
    $('#btnExportProgress').addEventListener('click', exportProgress);
    $('#btnResetProgress').addEventListener('click', resetProgress);

    /**
     * 全局快捷键只处理答题相关按键。
     * 只要焦点在输入框、下拉框或弹窗内，就完全退出，避免影响正常打字。
     */
    document.addEventListener('keydown', (event) => {
      const target = event.target;
      if (
        target instanceof HTMLInputElement ||
        target instanceof HTMLSelectElement ||
        target instanceof HTMLTextAreaElement
      ) {
        return;
      }
      if (document.querySelector('dialog[open]')) return;

      const key = event.key;
      if (/^[1-6]$/.test(key)) {
        event.preventDefault();
        chooseOption(Number(key) - 1);
        return;
      }
      if (/^[a-f]$/i.test(key)) {
        event.preventDefault();
        chooseOption(key.toUpperCase().charCodeAt(0) - 65);
        return;
      }
      if (key === 'ArrowLeft' || key === 'Backspace') {
        event.preventDefault();
        previousQuestion();
        return;
      }
      if (key === 'ArrowRight') {
        event.preventDefault();
        nextQuestion();
        return;
      }
      if (key === 'Enter' || key === ' ') {
        event.preventDefault();
        const question = currentQuestion();
        if (question?.type === 'multi' && !state.session.submitted) {
          submitCurrentAnswer();
        } else {
          nextQuestion();
        }
        return;
      }
      if (key.toLowerCase() === 'f') {
        event.preventDefault();
        toggleFavorite();
        return;
      }
      if (key.toLowerCase() === 'x') {
        event.preventDefault();
        nextQuestion();
        return;
      }
      if (key === '?') openDialog('helpDialog');
    });
  }

  function init() {
    activeSubject = SUBJECT_CONFIG[state.session.subject] ? state.session.subject : 'ke1';
    state.session.subject = activeSubject;
    resolveBank(activeSubject);
    populateChapters();
    syncFilterControls();
    restoreOrCreateQueue();
    bindEvents();
    render();
  }

  init();
})();
