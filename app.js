(() => {
  const modules = window.STUDY_MODULES || [];
  const questions = window.QUESTION_BANK || [];
  const cards = window.VOCAB_CARDS || [];
  const KEY = 'toeicStudyStateV1';
  const defaultState = {
    completed: [],
    answerLog: {},
    wrongIds: [],
    masteredCards: [],
    lastModule: 'priority',
    visits: [],
    dailyActivity: {},
    theme: 'light'
  };

  const validModuleIds = new Set(modules.map((m) => m.id));
  const validQuestionIds = new Set(questions.map((q) => q.id));
  const validCardTerms = new Set(cards.map((c) => c.term));

  let state = loadState();
  let currentView = 'dashboard';
  let currentModule = null;
  let quizSession = null;
  let flashDeck = [];
  let flashIndex = 0;
  let flashInitialized = false;

  const $ = (selector) => document.querySelector(selector);
  const $$ = (selector) => [...document.querySelectorAll(selector)];

  function uniqueValid(values, validSet) {
    return [...new Set(Array.isArray(values) ? values : [])].filter((value) => validSet.has(value));
  }

  function normalizeState(raw = {}) {
    const normalizedLog = {};
    if (raw.answerLog && typeof raw.answerLog === 'object' && !Array.isArray(raw.answerLog)) {
      Object.entries(raw.answerLog).forEach(([id, item]) => {
        if (!validQuestionIds.has(id) || !item || typeof item !== 'object') return;
        const attempts = Math.max(0, Number(item.attempts) || 0);
        const correct = Math.min(attempts, Math.max(0, Number(item.correct) || 0));
        normalizedLog[id] = {
          attempts,
          correct,
          last: typeof item.last === 'string' ? item.last : ''
        };
      });
    }

    const normalizedDaily = {};
    if (raw.dailyActivity && typeof raw.dailyActivity === 'object' && !Array.isArray(raw.dailyActivity)) {
      Object.entries(raw.dailyActivity)
        .filter(([date]) => /^\d{4}-\d{2}-\d{2}$/.test(date))
        .sort(([a], [b]) => a.localeCompare(b))
        .slice(-60)
        .forEach(([date, item]) => {
          if (!item || typeof item !== 'object') return;
          normalizedDaily[date] = {
            answers: Math.max(0, Number(item.answers) || 0),
            wrongReviews: Math.max(0, Number(item.wrongReviews) || 0),
            modules: uniqueValid(item.modules, validModuleIds)
          };
        });
    }

    return {
      ...defaultState,
      completed: uniqueValid(raw.completed, validModuleIds),
      answerLog: normalizedLog,
      wrongIds: uniqueValid(raw.wrongIds, validQuestionIds),
      masteredCards: uniqueValid(raw.masteredCards, validCardTerms),
      lastModule: validModuleIds.has(raw.lastModule) ? raw.lastModule : (modules[0]?.id || 'priority'),
      visits: [...new Set(Array.isArray(raw.visits) ? raw.visits : [])]
        .filter((date) => /^\d{4}-\d{2}-\d{2}$/.test(date))
        .slice(-120),
      dailyActivity: normalizedDaily,
      theme: raw.theme === 'dark' ? 'dark' : 'light'
    };
  }

  function loadState() {
    try {
      return normalizeState(JSON.parse(localStorage.getItem(KEY) || '{}'));
    } catch (error) {
      console.warn('Unable to read saved progress:', error);
      return normalizeState();
    }
  }

  function persistState() {
    try {
      localStorage.setItem(KEY, JSON.stringify(state));
    } catch (error) {
      console.warn('Unable to save progress:', error);
    }
  }

  function saveState() {
    persistState();
    refreshStats();
  }

  function dateKey(date = new Date()) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  function today() {
    return dateKey(new Date());
  }

  function updateVisit() {
    const key = today();
    if (!state.visits.includes(key)) {
      state.visits.push(key);
      state.visits = state.visits.slice(-120);
      saveState();
    }
  }

  function streak() {
    const dates = new Set(state.visits);
    let count = 0;
    const cursor = new Date();
    while (dates.has(dateKey(cursor))) {
      count += 1;
      cursor.setDate(cursor.getDate() - 1);
    }
    return count;
  }

  function getDailyActivity(date = today()) {
    const item = state.dailyActivity?.[date];
    return item || { answers: 0, wrongReviews: 0, modules: [] };
  }

  function ensureDailyActivity(date = today()) {
    if (!state.dailyActivity || typeof state.dailyActivity !== 'object') state.dailyActivity = {};
    if (!state.dailyActivity[date]) {
      state.dailyActivity[date] = { answers: 0, wrongReviews: 0, modules: [] };
    }
    return state.dailyActivity[date];
  }

  function rankedModules() {
    return modules
      .filter((module) => module.id !== 'priority' && module.id !== 'checklist')
      .map((module) => {
        const moduleQuestions = questions.filter((question) => question.module === module.id);
        let attempts = 0;
        let correct = 0;
        moduleQuestions.forEach((question) => {
          const log = state.answerLog[question.id];
          if (!log) return;
          attempts += log.attempts || 0;
          correct += log.correct || 0;
        });
        const accuracy = attempts ? correct / attempts : null;
        const score = (module.priority * 2)
          + (state.completed.includes(module.id) ? -3 : 2)
          + (accuracy !== null ? (1 - accuracy) * 8 : 0);
        return { module, score, accuracy, attempts };
      })
      .sort((a, b) => b.score - a.score);
  }

  function nextStudyModule() {
    return rankedModules().find((item) => !state.completed.includes(item.module.id))?.module
      || modules.find((module) => !state.completed.includes(module.id))
      || moduleById(state.lastModule)
      || modules[0];
  }

  function setGoalState(selector, completed, active = false, optional = false) {
    const element = $(selector);
    if (!element) return;
    element.classList.toggle('completed', completed);
    element.classList.toggle('active', active && !completed);
    element.classList.toggle('optional', optional);
  }

  function refreshTodayPlan() {
    const activity = getDailyActivity();
    const lessonDone = activity.modules.length > 0;
    const practiceCount = Math.min(activity.answers, 10);
    const practiceDone = practiceCount >= 10;
    const hasReviewGoal = state.wrongIds.length > 0 || activity.wrongReviews > 0;
    const reviewTarget = hasReviewGoal ? 3 : 0;
    const reviewCount = Math.min(activity.wrongReviews, reviewTarget || 0);
    const reviewDone = practiceDone && (!hasReviewGoal || reviewCount >= reviewTarget || state.wrongIds.length === 0);

    const reviewScore = reviewDone ? 1 : (practiceDone && hasReviewGoal ? reviewCount / reviewTarget : 0);
    const goalScores = [lessonDone ? 1 : 0, practiceCount / 10, reviewScore];
    const dailyPercent = Math.round((goalScores.reduce((sum, value) => sum + value, 0) / goalScores.length) * 100);

    $('#todayPercent').textContent = `${dailyPercent}%`;
    $('#todayRing')?.style.setProperty('--progress', `${dailyPercent}%`);
    $('#sideProgress').style.width = `${dailyPercent}%`;
    $('#sideProgressText').textContent = dailyPercent ? `今日已完成 ${dailyPercent}%` : '今天尚未開始';
    $('#todayDate').textContent = new Date().toLocaleDateString('zh-TW', { month: 'numeric', day: 'numeric', weekday: 'short' });

    $('#todayLessonText').textContent = lessonDone
      ? `已完成：${moduleTitle(activity.modules[activity.modules.length - 1])}`
      : '完成一個高頻章節';
    $('#todayPracticeText').textContent = `${practiceCount} / 10 題`;
    $('#todayReviewText').textContent = !practiceDone
      ? '完成練習後自動整理'
      : hasReviewGoal
        ? (reviewDone ? '今日錯題已整理' : `已複習 ${reviewCount} / ${reviewTarget} 題，尚有 ${state.wrongIds.length} 題`)
        : '今天沒有錯題';

    setGoalState('#todayLessonGoal', lessonDone, !lessonDone);
    setGoalState('#todayPracticeGoal', practiceDone, lessonDone && !practiceDone);
    setGoalState('#todayReviewGoal', reviewDone, practiceDone && !reviewDone, !practiceDone);

    const button = $('#todayActionBtn');
    const focusTitle = $('#todayFocusTitle');
    const focusMeta = $('#todayFocusMeta');
    const headline = $('#todayHeadline');
    const summary = $('#todaySummary');
    const time = $('#todayTime');
    if (!button || !focusTitle || !focusMeta) return;

    if (!lessonDone) {
      const target = nextStudyModule();
      headline.innerHTML = '今天先完成一個章節，<br><em>再用題目確認是否真的學會。</em>';
      summary.textContent = '不用自己找內容，系統已依高頻程度與目前紀錄排好今天的第一步。';
      focusTitle.textContent = target?.title || '考前優先順序';
      focusMeta.textContent = target ? `${target.subtitle} · 約 ${target.estimated} 分鐘` : '先建立作答判斷順序';
      button.textContent = '開始今日章節';
      button.dataset.action = 'lesson';
      button.dataset.module = target?.id || modules[0]?.id || '';
      button.dataset.count = '';
      time.textContent = target ? `預計 ${target.estimated} 分鐘` : '約 10 分鐘';
      return;
    }

    if (!practiceDone) {
      const remaining = 10 - practiceCount;
      headline.innerHTML = '章節已完成，<br><em>現在用練習把觀念固定下來。</em>';
      summary.textContent = '每題作答後立即看解析；答錯的題目會自動加入錯題本。';
      focusTitle.textContent = `完成剩餘 ${remaining} 題練習`;
      focusMeta.textContent = '混合文法與商務字彙，完成後更新今日進度';
      button.textContent = `開始剩餘 ${remaining} 題`;
      button.dataset.action = 'practice';
      button.dataset.count = String(remaining);
      button.dataset.module = '';
      time.textContent = `約 ${Math.max(3, Math.ceil(remaining * 0.8))} 分鐘`;
      return;
    }

    if (!reviewDone) {
      const remaining = Math.max(1, reviewTarget - reviewCount);
      headline.innerHTML = '今日練習已達標，<br><em>最後把錯題整理乾淨。</em>';
      summary.textContent = '重新答對比只看答案更有效；完成後今天的學習流程就結束。';
      focusTitle.textContent = `複習 ${remaining} 題錯題`;
      focusMeta.textContent = `錯題本目前有 ${state.wrongIds.length} 題待處理`;
      button.textContent = '開始錯題複習';
      button.dataset.action = 'wrong';
      button.dataset.count = String(remaining);
      button.dataset.module = '';
      time.textContent = '約 3–5 分鐘';
      return;
    }

    headline.innerHTML = '今天的目標已完成，<br><em>穩定累積比一次讀很多更重要。</em>';
    summary.textContent = '教材、練習與錯題流程都已完成；可以休息，或再加練一回保持手感。';
    focusTitle.textContent = '今日學習完成';
    focusMeta.textContent = `已作答 ${activity.answers} 題 · 連續學習 ${streak()} 天`;
    button.textContent = '再加練 10 題';
    button.dataset.action = 'extra';
    button.dataset.count = '10';
    button.dataset.module = '';
    time.textContent = '選擇性加練';
  }

  function escapeHTML(value) {
    return String(value).replace(/[&<>'"]/g, (char) => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      "'": '&#39;',
      '"': '&quot;'
    })[char]);
  }

  function stripHTML(html) {
    const container = document.createElement('div');
    container.innerHTML = html;
    return container.textContent || '';
  }

  function moduleById(id) {
    return modules.find((module) => module.id === id);
  }

  function moduleTitle(id) {
    return moduleById(id)?.title || id;
  }

  function stars(count) {
    const safeCount = Math.max(0, Math.min(3, Number(count) || 0));
    return '★'.repeat(safeCount) + '☆'.repeat(3 - safeCount);
  }

  function shuffle(items) {
    const result = [...items];
    for (let index = result.length - 1; index > 0; index -= 1) {
      const randomIndex = Math.floor(Math.random() * (index + 1));
      [result[index], result[randomIndex]] = [result[randomIndex], result[index]];
    }
    return result;
  }

  function toast(message) {
    const element = $('#toast');
    if (!element) return;
    element.textContent = message;
    element.classList.add('show');
    clearTimeout(element._timer);
    element._timer = setTimeout(() => element.classList.remove('show'), 1900);
  }

  function applyTheme(theme) {
    const safeTheme = theme === 'dark' ? 'dark' : 'light';
    state.theme = safeTheme;
    document.documentElement.dataset.theme = safeTheme;
    const button = $('#themeBtn');
    if (button) {
      const nextTheme = safeTheme === 'dark' ? '淺色' : '深色';
      button.setAttribute('aria-label', `切換為${nextTheme}模式`);
      button.title = `切換為${nextTheme}模式`;
    }
  }

  function showView(view) {
    currentView = view;
    $$('.view').forEach((element) => element.classList.toggle('active', element.id === `view-${view}`));
    $$('.nav-item').forEach((button) => button.classList.toggle('active', button.dataset.view === view));
    $('#sidebar')?.classList.remove('open');
    window.scrollTo({ top: 0, behavior: 'smooth' });
    if (view === 'dashboard') refreshTodayPlan();
    if (view === 'course') renderCourseNav();
    if (view === 'mistakes') renderMistakes();
    if (view === 'flashcards') initFlashcards();
    if (view === 'quiz') updateQuizAvailability();
  }

  function refreshStats() {
    const logs = Object.values(state.answerLog);
    const totalAnswers = logs.reduce((sum, item) => sum + (item.attempts || 0), 0);
    const correctAnswers = logs.reduce((sum, item) => sum + (item.correct || 0), 0);
    const percentage = modules.length ? Math.round((state.completed.length / modules.length) * 100) : 0;

    $('#statModules').textContent = `${state.completed.length} / ${modules.length}`;
    $('#statAnswers').textContent = totalAnswers;
    $('#statAccuracy').textContent = totalAnswers ? `${Math.round((correctAnswers / totalAnswers) * 100)}%` : '—';
    $('#statStreak').textContent = `${streak()} 天`;
    $('#coursePercent').textContent = `${percentage}%`;
    $('#wrongBadge').textContent = state.wrongIds.length;
    $('#quickWrongText').textContent = state.wrongIds.length ? `${state.wrongIds.length} 題等待複習` : '目前沒有錯題';
    $('#flashMastered').textContent = state.masteredCards.length;

    refreshTodayPlan();
    renderRecommendations();
    renderModulePreview();
  }

  function renderRecommendations() {
    const element = $('#recommendations');
    if (!element) return;

    const scored = rankedModules().slice(0, 3);

    element.innerHTML = scored.map((item, index) => `
      <button type="button" class="recommendation" data-module="${item.module.id}">
        <span class="rec-num">${index + 1}</span>
        <div>
          <b>${escapeHTML(item.module.title)}</b>
          <small>${item.attempts ? `目前正確率 ${Math.round(item.accuracy * 100)}%` : `約 ${item.module.estimated} 分鐘，尚未完成`}</small>
        </div>
        <span class="stars">${stars(item.module.priority)}</span>
      </button>
    `).join('');

    $$('.recommendation').forEach((button) => {
      button.onclick = () => openModule(button.dataset.module);
    });
  }

  function renderModulePreview() {
    const element = $('#modulePreview');
    if (!element) return;
    element.innerHTML = modules
      .filter((module) => module.priority === 3)
      .slice(0, 8)
      .map((module) => moduleCardHTML(module))
      .join('');
    $$('#modulePreview .module-card').forEach((button) => {
      button.onclick = () => openModule(button.dataset.module);
    });
  }

  function moduleCardHTML(module) {
    const completed = state.completed.includes(module.id);
    return `
      <button type="button" class="module-card" data-module="${module.id}">
        ${completed ? '<span class="done-check">✓</span>' : ''}
        <span class="module-meta"><span>${escapeHTML(module.group)}</span><span>${module.estimated} 分鐘</span></span>
        <span class="module-card-title">${escapeHTML(module.title)}</span>
        <span class="module-card-copy">${escapeHTML(module.subtitle)}</span>
        <span class="stars module-card-stars">${stars(module.priority)}</span>
      </button>
    `;
  }

  function renderCourseNav() {
    const nav = $('#courseNav');
    let html = '';
    let lastGroup = '';

    modules.forEach((module) => {
      if (module.group !== lastGroup) {
        lastGroup = module.group;
        html += `<div class="course-group">${escapeHTML(lastGroup)}</div>`;
      }
      const completed = state.completed.includes(module.id);
      html += `
        <button type="button" class="course-link ${completed ? 'completed' : ''} ${currentModule === module.id ? 'active' : ''}" data-module="${module.id}">
          <span class="course-dot">${completed ? '✓' : ''}</span>
          <span><b>${escapeHTML(module.title)}</b><small>${stars(module.priority)} · ${module.estimated} 分鐘</small></span>
        </button>
      `;
    });

    nav.innerHTML = html;
    $$('.course-link').forEach((button) => {
      button.onclick = () => renderLesson(button.dataset.module);
    });
  }

  function openModule(id) {
    showView('course');
    renderLesson(id);
  }

  function renderLesson(id) {
    const module = moduleById(id);
    if (!module) return;

    currentModule = id;
    state.lastModule = id;
    saveState();
    renderCourseNav();

    const completed = state.completed.includes(id);
    const questionCount = questions.filter((question) => question.module === id).length;
    const quizButton = questionCount
      ? `<button type="button" class="btn secondary" id="lessonQuiz">練習本章題目（${questionCount} 題）</button>`
      : '<button type="button" class="btn secondary" disabled title="本章為導讀或檢查清單，沒有獨立題目">本章沒有獨立題目</button>';

    $('#lessonArticle').innerHTML = `
      <header class="lesson-header">
        <span class="eyebrow">${escapeHTML(module.group)}</span>
        <h1>${escapeHTML(module.title)}</h1>
        <p>${escapeHTML(module.subtitle)}</p>
        <div class="lesson-toolbar">
          <span class="source-pill">資料來源：${escapeHTML(module.source)} · 約 ${module.estimated} 分鐘</span>
          <button type="button" class="btn secondary complete-btn ${completed ? 'completed' : ''}" id="completeLesson">${completed ? '✓ 已完成' : '標記為已完成'}</button>
        </div>
      </header>
      <div class="lesson-content">${module.content}</div>
      <footer class="lesson-bottom">
        ${quizButton}
        <button type="button" class="btn primary" id="nextLesson">下一章 →</button>
      </footer>
    `;

    $('#completeLesson').onclick = () => toggleComplete(id);
    if ($('#lessonQuiz')) $('#lessonQuiz').onclick = () => startQuiz('module', 10, id);
    $('#nextLesson').onclick = () => {
      const index = modules.findIndex((item) => item.id === id);
      renderLesson(modules[(index + 1) % modules.length].id);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    };
  }

  function toggleComplete(id) {
    const activity = ensureDailyActivity();
    if (state.completed.includes(id)) {
      state.completed = state.completed.filter((item) => item !== id);
      activity.modules = activity.modules.filter((item) => item !== id);
    } else {
      state.completed.push(id);
      if (!activity.modules.includes(id)) activity.modules.push(id);
    }
    saveState();
    renderLesson(id);
    toast(state.completed.includes(id) ? '已完成本章' : '已取消完成標記');
  }

  function setMode(mode) {
    $$('.mode-card').forEach((label) => {
      label.classList.toggle('selected', label.querySelector('input').value === mode);
    });
    const input = $(`input[name="quizMode"][value="${mode}"]`);
    if (input) input.checked = true;
    $('#quizModule').disabled = mode !== 'module';
    updateQuizAvailability();
  }

  function availableQuestions(mode, moduleId) {
    if (mode === 'wrong') return questions.filter((question) => state.wrongIds.includes(question.id));
    if (mode === 'module') return questions.filter((question) => question.module === moduleId);
    return questions;
  }

  function updateQuizAvailability() {
    const mode = $('input[name="quizMode"]:checked')?.value || 'mixed';
    const moduleId = $('#quizModule')?.value;
    const count = availableQuestions(mode, moduleId).length;
    const hint = $('#quizAvailability');
    const startButton = $('#startQuizBtn');

    if (hint) {
      hint.textContent = mode === 'wrong' && !count
        ? '目前沒有錯題，先完成一回混合練習。'
        : `目前可出 ${count} 題。`;
    }
    if (startButton) startButton.disabled = count === 0;
  }

  function prepareQuestion(raw) {
    const choices = raw.choices.map((text, index) => ({ text, correct: index === raw.answer }));
    return { ...raw, shuffled: shuffle(choices) };
  }

  function startQuiz(mode = 'mixed', count = 10, moduleId = null) {
    showView('quiz');
    const pool = availableQuestions(mode, moduleId || $('#quizModule').value);
    if (!pool.length) {
      $('#quizSetup').hidden = false;
      $('#quizRunner').hidden = true;
      $('#quizRunner').innerHTML = '';
      quizSession = null;
      updateQuizAvailability();
      toast('目前沒有可用題目');
      return;
    }

    const requestedCount = Number(count) || 10;
    const picked = shuffle(pool)
      .slice(0, Math.min(requestedCount, pool.length))
      .map(prepareQuestion);

    quizSession = {
      mode,
      moduleId,
      questions: picked,
      index: 0,
      correct: 0,
      answers: []
    };
    $('#quizSetup').hidden = true;
    $('#quizRunner').hidden = false;
    renderQuestion();
  }

  function renderQuestion() {
    const session = quizSession;
    if (!session) return;
    if (session.index >= session.questions.length) {
      renderResult();
      return;
    }

    const question = session.questions[session.index];
    const module = moduleById(question.module);
    const progress = ((session.index + 1) / session.questions.length) * 100;

    $('#quizRunner').innerHTML = `
      <div class="quiz-shell">
        <div class="quiz-top">
          <span class="quiz-number">${session.index + 1} / ${session.questions.length}</span>
          <div class="quiz-progress" aria-label="作答進度"><span style="width:${progress}%"></span></div>
          <button type="button" class="text-btn" id="quitQuiz">結束</button>
        </div>
        <article class="question-card">
          <span class="question-category">${escapeHTML(module?.title || question.module)} · 難度 ${'●'.repeat(question.level || 1)}</span>
          <h2>${escapeHTML(question.prompt)}</h2>
          <div class="choices">
            ${question.shuffled.map((choice, index) => `
              <button type="button" class="choice" data-i="${index}">
                <span class="choice-letter">${String.fromCharCode(65 + index)}</span>
                <span>${escapeHTML(choice.text)}</span>
              </button>
            `).join('')}
          </div>
          <div class="feedback" id="feedback" aria-live="polite"></div>
          <div class="question-actions">
            <button type="button" class="btn primary" id="nextQuestion" hidden>${session.index === session.questions.length - 1 ? '查看結果' : '下一題 →'}</button>
          </div>
        </article>
      </div>
    `;

    $$('.choice').forEach((button) => {
      button.onclick = () => answerQuestion(Number(button.dataset.i));
    });
    $('#nextQuestion').onclick = () => {
      session.index += 1;
      renderQuestion();
    };
    $('#quitQuiz').onclick = () => {
      if (confirm('要結束這次練習嗎？')) resetQuiz();
    };
  }

  function answerQuestion(index) {
    const session = quizSession;
    if (!session || session.answers.length > session.index) return;

    const question = session.questions[session.index];
    const selected = question.shuffled[index];
    if (!selected) return;
    const isCorrect = selected.correct;

    $$('.choice').forEach((button, choiceIndex) => {
      button.disabled = true;
      if (question.shuffled[choiceIndex].correct) button.classList.add('correct');
      else if (choiceIndex === index) button.classList.add('wrong');
    });

    const feedback = $('#feedback');
    feedback.className = `feedback show ${isCorrect ? 'correct' : 'wrong'}`;
    feedback.innerHTML = `
      <h3>${isCorrect ? '答對了！' : '答錯了'}</h3>
      <p>${escapeHTML(question.explanation)}</p>
      ${question.tip ? `<p class="tip"><b>秒判提示：</b>${escapeHTML(question.tip)}</p>` : ''}
    `;
    $('#nextQuestion').hidden = false;

    session.answers.push({ id: question.id, correct: isCorrect });
    if (isCorrect) session.correct += 1;

    const log = state.answerLog[question.id] || { attempts: 0, correct: 0, last: '' };
    log.attempts += 1;
    if (isCorrect) log.correct += 1;
    log.last = today();
    state.answerLog[question.id] = log;

    if (isCorrect) {
      state.wrongIds = state.wrongIds.filter((id) => id !== question.id);
    } else if (!state.wrongIds.includes(question.id)) {
      state.wrongIds.push(question.id);
    }

    const activity = ensureDailyActivity();
    activity.answers += 1;
    if (session.mode === 'wrong') activity.wrongReviews += 1;
    saveState();
  }

  function renderResult() {
    const session = quizSession;
    if (!session || !session.questions.length) return;

    const percentage = Math.round((session.correct / session.questions.length) * 100);
    const wrongCount = session.questions.length - session.correct;
    const breakdown = {};

    session.answers.forEach((answer) => {
      const question = questions.find((item) => item.id === answer.id);
      if (!question) return;
      const name = moduleTitle(question.module);
      if (!breakdown[name]) breakdown[name] = { correct: 0, total: 0 };
      breakdown[name].total += 1;
      if (answer.correct) breakdown[name].correct += 1;
    });

    $('#quizRunner').innerHTML = `
      <div class="result-card">
        <span class="eyebrow">SESSION COMPLETE</span>
        <h1>${percentage >= 80 ? '表現很好！' : percentage >= 60 ? '觀念正在建立' : '先從錯題補強'}</h1>
        <p>本次答對 ${session.correct} 題、答錯 ${wrongCount} 題。</p>
        <div class="result-score"><strong>${percentage}%</strong><span>正確率</span></div>
        <div class="breakdown">
          ${Object.entries(breakdown).slice(0, 6).map(([name, item]) => `
            <div><b>${item.correct}/${item.total}</b><small>${escapeHTML(name)}</small></div>
          `).join('')}
        </div>
        <div class="result-actions">
          <button type="button" class="btn secondary" id="newQuiz">再做一回</button>
          ${wrongCount
            ? '<button type="button" class="btn primary" id="reviewWrong">複習錯題</button>'
            : '<button type="button" class="btn primary" id="goCourse">繼續學習</button>'}
        </div>
      </div>
    `;

    $('#newQuiz').onclick = resetQuiz;
    if ($('#reviewWrong')) $('#reviewWrong').onclick = () => startQuiz('wrong', 999);
    if ($('#goCourse')) $('#goCourse').onclick = () => showView('course');
  }

  function resetQuiz() {
    $('#quizSetup').hidden = false;
    $('#quizRunner').hidden = true;
    $('#quizRunner').innerHTML = '';
    quizSession = null;
    updateQuizAvailability();
  }

  function renderMistakes() {
    const element = $('#mistakeList');
    const wrongQuestions = state.wrongIds
      .map((id) => questions.find((question) => question.id === id))
      .filter(Boolean);

    if (!wrongQuestions.length) {
      element.innerHTML = `
        <div class="empty-state">
          <span>✓</span><h2>目前沒有錯題</h2>
          <p>完成練習後，答錯的題目會自動出現在這裡。</p>
          <button type="button" class="btn primary" data-quick="mixed">開始 10 題練習</button>
        </div>
      `;
      element.querySelector('[data-quick]').onclick = () => startQuiz('mixed', 10);
      return;
    }

    element.innerHTML = wrongQuestions.map((question) => `
      <article class="mistake-card">
        <div class="meta">
          <span>${escapeHTML(moduleTitle(question.module))}</span>
          <span>累積作答 ${state.answerLog[question.id]?.attempts || 1} 次</span>
        </div>
        <h3>${escapeHTML(question.prompt)}</h3>
        <div class="answer">正確答案：${escapeHTML(question.choices[question.answer])}</div>
        <div class="explanation">
          ${escapeHTML(question.explanation)}
          ${question.tip ? `<br><small>提示：${escapeHTML(question.tip)}</small>` : ''}
        </div>
      </article>
    `).join('');
  }

  function initFlashcards() {
    const select = $('#flashCategory');
    if (!flashInitialized) {
      const categories = ['全部', ...new Set(cards.map((card) => card.category))];
      select.innerHTML = categories.map((category) => `<option>${escapeHTML(category)}</option>`).join('');
      select.onchange = buildFlashDeck;
      $('#flashcard').onclick = () => $('#flashcard').classList.toggle('flipped');
      $('#nextFlash').onclick = () => moveFlash(1);
      $('#prevFlash').onclick = () => moveFlash(-1);
      $('#shuffleFlash').onclick = buildFlashDeck;
      $('#masterFlash').onclick = toggleMasterCard;
      flashInitialized = true;
    }
    buildFlashDeck();
  }

  function buildFlashDeck() {
    const category = $('#flashCategory').value || '全部';
    flashDeck = shuffle(cards.filter((card) => category === '全部' || card.category === category));
    flashIndex = 0;
    renderFlash();
  }

  function moveFlash(direction) {
    if (!flashDeck.length) return;
    flashIndex = (flashIndex + direction + flashDeck.length) % flashDeck.length;
    renderFlash();
  }

  function renderFlash() {
    const card = flashDeck[flashIndex];
    if (!card) {
      $('#flashTerm').textContent = '沒有可用字卡';
      $('#flashMeaning').textContent = '';
      $('#flashExample').textContent = '';
      $('#flashCounter').textContent = '0 / 0';
      return;
    }

    $('#flashcard').classList.remove('flipped');
    $('#flashCat').textContent = card.category;
    $('#flashTerm').textContent = card.term;
    $('#flashMeaning').textContent = card.meaning;
    $('#flashExample').textContent = card.example;
    $('#flashCounter').textContent = `${flashIndex + 1} / ${flashDeck.length}`;

    const mastered = state.masteredCards.includes(card.term);
    $('#masterFlash').textContent = mastered ? '✓ 已熟悉' : '標記已熟悉';
    $('#masterFlash').classList.toggle('success', mastered);
  }

  function toggleMasterCard() {
    const card = flashDeck[flashIndex];
    if (!card) return;

    if (state.masteredCards.includes(card.term)) {
      state.masteredCards = state.masteredCards.filter((term) => term !== card.term);
    } else {
      state.masteredCards.push(card.term);
    }
    saveState();
    renderFlash();
    toast(state.masteredCards.includes(card.term) ? '已標記熟悉' : '已取消熟悉標記');
  }

  function setupSearch() {
    const input = $('#globalSearch');
    const box = $('#searchResults');

    input.addEventListener('input', () => {
      const term = input.value.trim().toLowerCase();
      const minimumLength = /[\u3400-\u9fff]/.test(term) ? 1 : 2;
      if (term.length < minimumLength) {
        box.hidden = true;
        return;
      }

      const found = modules.filter((module) => {
        const searchable = [
          module.title,
          module.subtitle,
          ...(module.keywords || []),
          stripHTML(module.content)
        ].join(' ').toLowerCase();
        return searchable.includes(term);
      }).slice(0, 8);

      box.innerHTML = found.length
        ? found.map((module) => `
            <button type="button" class="search-result" data-module="${module.id}">
              <b>${escapeHTML(module.title)}</b><small>${escapeHTML(module.subtitle)}</small>
            </button>
          `).join('')
        : '<div class="search-empty">找不到相關內容</div>';
      box.hidden = false;

      $$('.search-result').forEach((button) => {
        button.onclick = () => {
          box.hidden = true;
          input.value = '';
          openModule(button.dataset.module);
        };
      });
    });

    document.addEventListener('click', (event) => {
      if (!event.target.closest('.search-wrap')) box.hidden = true;
    });
  }

  function init() {
    applyTheme(state.theme);
    persistState();

    $('#quizModule').innerHTML = modules
      .filter((module) => questions.some((question) => question.module === module.id))
      .map((module) => `<option value="${module.id}">${escapeHTML(module.title)}（${questions.filter((question) => question.module === module.id).length} 題）</option>`)
      .join('');

    $$('.nav-item').forEach((button) => {
      button.onclick = () => showView(button.dataset.view);
    });
    $$('[data-go]').forEach((button) => {
      button.onclick = () => showView(button.dataset.go);
    });
    $$('[data-quick="mixed"]').forEach((button) => {
      button.onclick = () => startQuiz('mixed', 10);
    });
    $$('.mode-card').forEach((label) => {
      label.onclick = () => setMode(label.querySelector('input').value);
    });

    $('#startQuizBtn').onclick = () => startQuiz(
      $('input[name="quizMode"]:checked').value,
      $('#quizCount').value,
      $('#quizModule').value
    );
    $('#quizModule').onchange = updateQuizAvailability;
    $('#quizCount').onchange = updateQuizAvailability;
    $('#todayActionBtn').onclick = () => {
      const button = $('#todayActionBtn');
      const action = button.dataset.action;
      const count = Math.max(1, Number(button.dataset.count) || 10);
      if (action === 'lesson') openModule(button.dataset.module || nextStudyModule()?.id);
      else if (action === 'wrong') startQuiz('wrong', count);
      else startQuiz('mixed', count);
    };
    $('#clearWrongBtn').onclick = () => {
      if (state.wrongIds.length && confirm('確定要清空所有錯題嗎？')) {
        state.wrongIds = [];
        saveState();
        renderMistakes();
      }
    };
    $('#themeBtn').onclick = () => {
      applyTheme(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark');
      saveState();
    };
    $('#menuBtn').onclick = () => $('#sidebar').classList.toggle('open');

    document.addEventListener('keydown', (event) => {
      if (event.key !== 'Escape') return;
      $('#sidebar').classList.remove('open');
      $('#searchResults').hidden = true;
    });

    window.addEventListener('storage', (event) => {
      if (event.key !== KEY) return;
      state = loadState();
      applyTheme(state.theme);
      refreshStats();
      renderCourseNav();
      if (currentView === 'mistakes') renderMistakes();
    });

    setupSearch();
    updateVisit();
    refreshStats();
    renderCourseNav();
    setMode('mixed');
  }

  init();
})();
