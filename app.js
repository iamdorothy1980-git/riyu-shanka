(function () {
  'use strict';

  var SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  var CARDS = window.CARDS || [];
  var VOCAB = window.VOCAB || [];
  var SCORE = window.JPScore;

  var byId = {};
  CARDS.concat(VOCAB).forEach(function (c) { byId[c.id] = c; });

  var LEVELS = {
    loose:    { pass: 65, perfect: 88, label: '宽松' },
    standard: { pass: 78, perfect: 92, label: '标准' },
    strict:   { pass: 88, perfect: 96, label: '严格' }
  };

  var STORE_KEY = 'jp-travel-cards.v1';

  function $(id) { return document.getElementById(id); }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  /* ---------------- 存储 ---------------- */
  function defaultStore() {
    return {
      version: 1,
      settings: { mode: 'zh2ja', strict: 'standard', rate: 0.9, voiceURI: '' },
      cards: {},
      favorites: []
    };
  }

  var store = loadStore();

  function loadStore() {
    var base = defaultStore();
    try {
      var raw = localStorage.getItem(STORE_KEY);
      if (!raw) return base;
      var parsed = JSON.parse(raw) || {};
      return {
        version: 1,
        settings: Object.assign({}, base.settings, parsed.settings || {}),
        cards: parsed.cards || {},
        favorites: parsed.favorites || []
      };
    } catch (e) {
      return base;
    }
  }

  function saveStore() {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify(store));
    } catch (e) {
      /* 隐私模式等情况下无法写入，功能仍可用 */
    }
  }

  function rec(id) {
    if (!store.cards[id]) store.cards[id] = { level: 0, seen: 0, bestScore: 0 };
    return store.cards[id];
  }

  /* ---------------- DOM ---------------- */
  var el = {
    home: $('view-home'),
    study: $('view-study'),
    card: $('card'),
    face: $('face'),
    progressFill: $('progress-fill'),
    progressText: $('progress-text'),
    btnFlip: $('btn-flip'),
    rateRow: $('rate-row'),
    doneActions: $('done-actions'),
    star: $('btn-star'),
    statMastered: $('stat-mastered'),
    statFav: $('stat-fav'),
    statTotal: $('stat-total'),
    favBadge: $('fav-badge'),
    toast: $('toast')
  };

  var session = {
    ids: [],
    queue: [],
    total: 0,
    doneSet: {},
    current: null,
    flipped: false,
    revealed: {},
    repeats: {},
    filter: 'all'
  };

  /* ---------------- 通用 ---------------- */
  var toastTimer = null;
  function toast(msg) {
    el.toast.textContent = msg;
    el.toast.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.toast.hidden = true; }, 2000);
  }

  function shuffle(arr) {
    for (var i = arr.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var t = arr[i]; arr[i] = arr[j]; arr[j] = t;
    }
    return arr;
  }

  function showView(name) {
    el.home.hidden = name !== 'home';
    el.study.hidden = name !== 'study';
    if (name === 'home') updateStats();
  }

  var ui = { cat: 'all', module: 'sentence', freq: 'all' };

  function moduleItems() {
    return ui.module === 'word' ? VOCAB : CARDS;
  }

  function catLabel(cat) {
    return cat === 'all' ? '全部' : cat;
  }

  function freqOk(c) {
    if (ui.module !== 'word' || ui.freq === 'all') return true;
    if (ui.freq === 'top') return c.freq === 1;
    if (ui.freq === 'core') return c.freq <= 2;
    return true;
  }

  function freqLabel(f) {
    return f === 1 ? '高频' : f === 2 ? '常用' : '进阶';
  }

  function catIds(cat) {
    return moduleItems().filter(function (c) {
      return (cat === 'all' || c.cat === cat) && freqOk(c);
    }).map(function (c) { return c.id; });
  }

  function updateStats() {
    var items = moduleItems();
    var isWord = ui.module === 'word';
    var idSet = {};
    items.forEach(function (c) { idSet[c.id] = 1; });

    var mastered = 0;
    items.forEach(function (c) {
      var r = store.cards[c.id];
      if (r && r.level === 3) mastered++;
    });

    var favCount = 0;
    store.favorites.forEach(function (id) { if (idSet[id]) favCount++; });

    el.statMastered.textContent = mastered;
    el.statFav.textContent = favCount;
    el.statTotal.textContent = items.length;
    el.favBadge.textContent = favCount;

    var totalLabel = $('stat-total-label');
    if (totalLabel) totalLabel.textContent = isWord ? '总单词' : '总卡片';

    var cats = {};
    items.forEach(function (c) { cats[c.cat] = 1; });
    var sub = $('home-sub');
    if (sub) {
      sub.textContent = Object.keys(cats).length + ' 个场景 · ' + items.length +
        (isWord ? ' 个常用单词' : ' 句常用对话');
    }

    var startLabel = $('start-label');
    if (startLabel) {
      var n = catIds(ui.cat).length;
      startLabel.textContent = (isWord ? '背单词' : '开始练习') + ' · ' + catLabel(ui.cat) +
        '（' + n + (isWord ? ' 个' : ' 张') + '）';
    }

    var ms = $('module-switch');
    if (ms) {
      Array.prototype.forEach.call(ms.querySelectorAll('button'), function (b) {
        b.classList.toggle('on', b.getAttribute('data-module') === ui.module);
      });
    }

    var ff = $('freq-filter');
    if (ff) {
      ff.hidden = !isWord;
      Array.prototype.forEach.call(ff.querySelectorAll('button'), function (b) {
        b.classList.toggle('on', b.getAttribute('data-freq') === ui.freq);
      });
    }

    var filter = $('cat-filter');
    if (filter) {
      Array.prototype.forEach.call(filter.querySelectorAll('button'), function (b) {
        b.classList.toggle('on', b.getAttribute('data-cat') === ui.cat);
      });
    }
  }

  /* ---------------- 语音播放 ---------------- */
  var voicesJa = [];

  function refreshVoices() {
    try {
      var all = window.speechSynthesis ? window.speechSynthesis.getVoices() : [];
      voicesJa = all.filter(function (v) { return /^ja/i.test(v.lang || ''); });
    } catch (e) {
      voicesJa = [];
    }
    fillVoiceSelect();
  }

  function pickVoice() {
    if (store.settings.voiceURI) {
      for (var i = 0; i < voicesJa.length; i++) {
        if (voicesJa[i].voiceURI === store.settings.voiceURI) return voicesJa[i];
      }
    }
    for (var j = 0; j < voicesJa.length; j++) {
      if (/kyoko/i.test(voicesJa[j].name)) return voicesJa[j];
    }
    return voicesJa[0] || null;
  }

  var speakToken = 0;
  var audioCtx = null;
  var audioPlayer = null;
  var audioBroken = {};

  // iOS 上先用一次音频通道，录音后也靠它切回播放模式
  function unlockAudio() {
    try {
      if (!audioCtx) {
        var AC = window.AudioContext || window.webkitAudioContext;
        if (AC) audioCtx = new AC();
      }
      if (audioCtx && audioCtx.state === 'suspended') audioCtx.resume();
    } catch (e) { /* 忽略 */ }
  }

  // 与 tools/make-audio.js 完全一致的哈希，用来定位音频文件
  function audioKey(text) {
    var h = 2166136261;
    for (var i = 0; i < text.length; i++) {
      h ^= text.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return (h >>> 0).toString(36);
  }

  function playbackRate() {
    var r = Number(store.settings.rate) || 0.9;
    return Math.max(0.8, Math.min(1.2, r / 0.9));
  }

  function playFile(text) {
    var src = 'audio/' + audioKey(text) + '.m4a';
    if (audioBroken[src]) return false;
    try {
      if (!audioPlayer) {
        audioPlayer = new Audio();
        audioPlayer.preload = 'auto';
      }
      audioPlayer.onerror = function () {
        audioBroken[src] = true;
        speechFallback(text);
      };
      audioPlayer.onended = null;
      audioPlayer.pause();
      audioPlayer.currentTime = 0;
      audioPlayer.src = src;
      audioPlayer.playbackRate = playbackRate();
      var p = audioPlayer.play();
      if (p && p.catch) {
        p.catch(function () {
          audioBroken[src] = true;
          speechFallback(text);
        });
      }
      return true;
    } catch (e) {
      return false;
    }
  }

  // 没有音频文件时的兜底：用系统语音
  function speechFallback(text) {
    if (!window.speechSynthesis) { toast('这个浏览器不支持语音播放'); return; }
    var token = ++speakToken;
    try {
      var busy = window.speechSynthesis.speaking || window.speechSynthesis.pending;
      if (busy) window.speechSynthesis.cancel();
      try { window.speechSynthesis.resume(); } catch (e) {}

      var u = new SpeechSynthesisUtterance(text);
      u.lang = 'ja-JP';
      u.rate = Number(store.settings.rate) || 0.9;
      var v = pickVoice();
      if (v) u.voice = v;

      if (busy) {
        setTimeout(function () {
          if (token !== speakToken) return;
          try {
            window.speechSynthesis.resume();
            window.speechSynthesis.speak(u);
          } catch (e) {}
        }, 90);
      } else {
        window.speechSynthesis.speak(u);
      }
    } catch (e) { /* 忽略 */ }
  }

  function speak(text) {
    if (!text) return;
    unlockAudio();
    if (playFile(text)) return;
    speechFallback(text);
  }

  function fillVoiceSelect() {
    var sel = $('set-voice');
    if (!sel) return;
    var note = $('voice-note');
    if (!voicesJa.length) {
      sel.innerHTML = '<option>未检测到日语语音</option>';
      sel.disabled = true;
      if (note) note.textContent = '系统里没有找到日语语音。可在「系统设置 → 辅助功能 → 朗读内容」中添加。';
      return;
    }
    sel.disabled = false;
    sel.innerHTML = voicesJa.map(function (v) {
      return '<option value="' + esc(v.voiceURI) + '">' + esc(v.name + '（' + v.lang + '）') + '</option>';
    }).join('');
    if (store.settings.voiceURI) sel.value = store.settings.voiceURI;
    if (note) note.textContent = '使用 macOS 系统语音，离线可用。';
  }

  /* ---------------- 练习流程 ---------------- */
  function startSession(filter) {
    var ids = catIds(ui.cat);
    if (filter === 'review') {
      ids = ids.filter(function (id) {
        var r = store.cards[id];
        return !r || r.level !== 3;
      });
    }
    if (filter === 'fav') {
      ids = ids.filter(function (id) { return store.favorites.indexOf(id) >= 0; });
    }

    if (!ids.length) {
      var where = ui.cat === 'all' ? '' : '「' + ui.cat + '」里';
      if (filter === 'fav') {
        toast(where + '还没有收藏，翻面后点右上角 ☆ 收藏');
      } else if (filter === 'review') {
        toast(where + (ui.module === 'word' ? '的单词都已经掌握了' : '的卡片都已经掌握了') + '，换一个吧');
      } else {
        toast(where + '暂时没有可练的内容');
      }
      return;
    }

    shuffle(ids);
    if (ui.module === 'word') {
      // 稳定排序：高频在前，同一频次内部保持打乱顺序
      ids.sort(function (a, b) { return (byId[a].freq || 9) - (byId[b].freq || 9); });
    }
    session.ids = ids.slice();
    session.queue = ids.slice();
    session.total = ids.length;
    session.doneSet = {};
    session.repeats = {};
    session.filter = filter;
    session.module = ui.module;
    session.current = null;

    showView('study');
    showCard();
  }

  function showCard() {
    if (!session.queue.length) { renderDone(); return; }

    session.current = byId[session.queue[0]];
    session.flipped = false;
    session.revealed = {};

    el.card.scrollTop = 0;
    el.star.hidden = false;
    el.doneActions.hidden = true;
    setRateVisible(false);
    renderFront();
    updateProgress();
    updateStar();
  }

  function renderFront() {
    var c = session.current;
    el.face.className = 'face center';
    el.face.innerHTML =
      '<div class="cat">' + esc(c.cat) + '</div>' +
      '<div class="zh">' + esc(c.zh) + '</div>' +
      '<div class="hint">' + (c.pos ? '看中文，说出对应的日语单词' : '先自己说一遍，再点卡片翻面看答案') + '</div>' +
      '<button class="front-mic" id="front-mic">🎤 口语测试</button>';

    $('front-mic').addEventListener('click', function (e) {
      e.stopPropagation();
      openMic();
    });
  }

  function renderTokens(text) {
    if (!window.tokenizeJapanese) return esc(text);
    return window.tokenizeJapanese(text).map(function (tk) {
      if (!tk.w) return esc(tk.t);
      return '<span class="tok" data-w="' + esc(tk.t) + '" lang="ja">' + esc(tk.t) + '</span>';
    }).join('');
  }

  function handleWordTap(tok) {
    var line = tok.closest('.toks');
    if (!line) return;
    var panel = line.parentElement.querySelector('.word-panel');
    if (!panel) return;
    var word = tok.getAttribute('data-w');
    var entry = window.WORDS && window.WORDS[word];
    if (!entry) return;

    // 再点同一个词：收起
    if (!panel.hidden && panel.getAttribute('data-word') === word) {
      panel.hidden = true;
      tok.classList.remove('active');
      return;
    }

    Array.prototype.forEach.call(line.querySelectorAll('.tok.active'), function (n) {
      n.classList.remove('active');
    });
    tok.classList.add('active');

    panel.setAttribute('data-word', word);
    panel.innerHTML =
      '<div class="wp-top"><b lang="ja">' + esc(word) + '</b>' +
      '<span lang="ja">' + esc(entry.r) + '</span>' +
      '<button class="wp-play" type="button" aria-label="播放这个词">🔊</button></div>' +
      '<div class="wp-meaning">' + esc(entry.m) + '</div>';
    panel.hidden = false;

    panel.querySelector('.wp-play').addEventListener('click', function (e) {
      e.stopPropagation();
      speak(word);
    });
  }

  function replyHtml(r, i) {
    return '<div class="reply" data-i="' + i + '">' +
        '<button class="reply-icon" data-play="' + i + '" aria-label="播放这句话">🔊</button>' +
        '<div class="reply-body" data-toggle="' + i + '">' +
          '<div class="reply-tip">轻点显示文字</div>' +
          '<div class="reply-text">' +
            '<div class="rja toks" lang="ja">' + renderTokens(r.ja) + '</div>' +
            '<div class="word-panel" hidden></div>' +
            '<div class="rkana" lang="ja">' + esc(r.kana || '') + '</div>' +
            '<div class="rzh">' + esc(r.zh) + '</div>' +
          '</div>' +
        '</div>' +
        '<button class="reply-icon mic" data-mic="' + i + '" aria-label="跟读这句话">🎤</button>' +
      '</div>';
  }

  function renderBack() {
    var c = session.current;
    el.face.className = 'face';

    // 单词卡：只有词、假名、词性、发音和跟读
    if (c.pos) {
      el.face.innerHTML =
        '<div class="back">' +
          '<div class="cat-row"><div class="cat-left"><span class="cat">' + esc(c.cat) + '</span>' +
            '<span class="freq-badge f' + (c.freq || 3) + '">' + freqLabel(c.freq || 3) + '</span></div>' +
            '<button class="mini-btn" id="speak-main">🔊 播放</button></div>' +
          '<div class="ja" lang="ja">' + esc(c.ja) + '</div>' +
          '<div class="kana" lang="ja">' + esc(c.kana) + '</div>' +
          '<div class="words"><span class="word"><b>' + esc(c.pos) + '</b> · ' + esc(c.zh) + '</span></div>' +
          '<button class="mic-entry" id="mic-entry">🎤 跟读这个单词</button>' +
        '</div>';

      $('speak-main').addEventListener('click', function (e) {
        e.stopPropagation();
        speak(c.ja);
      });
      $('mic-entry').addEventListener('click', function (e) {
        e.stopPropagation();
        openMic();
      });
      return;
    }

    var words = c.words.map(function (w) {
      return '<span class="word"><b>' + esc(w.t) + '</b>' +
        (w.r ? '<i>' + esc(w.r) + '</i>' : '') +
        ' · ' + esc(w.m) + '</span>';
    }).join('');

    el.face.innerHTML =
      '<div class="back">' +
        '<div class="cat-row"><span class="cat">' + esc(c.cat) + '</span>' +
          '<button class="mini-btn" id="speak-main">🔊 播放</button></div>' +
        '<div class="ja toks" lang="ja">' + renderTokens(c.ja) + '</div>' +
        '<div class="word-panel" hidden></div>' +
        '<div class="kana" lang="ja">' + esc(c.kana) + '</div>' +
        '<div class="tap-hint">轻点句中的词，可以看读音和意思</div>' +
        '<div class="words">' + words + '</div>' +
        '<button class="mic-entry" id="mic-entry">🎤 跟读这句</button>' +
        '<div class="divider"><span>对方可能会说 · 先听再猜</span>' +
          '<button class="link-btn" id="reveal-all">全部显示</button></div>' +
        '<div class="replies">' + c.replies.map(replyHtml).join('') + '</div>' +
      '</div>';

    $('speak-main').addEventListener('click', function (e) {
      e.stopPropagation();
      speak(c.ja);
    });

    $('mic-entry').addEventListener('click', function (e) {
      e.stopPropagation();
      openMic();
    });

    $('reveal-all').addEventListener('click', function (e) {
      e.stopPropagation();
      revealAll();
    });

    Array.prototype.forEach.call(el.face.querySelectorAll('.reply'), function (row) {
      var i = Number(row.getAttribute('data-i'));
      var r = c.replies[i];

      row.querySelector('[data-play]').addEventListener('click', function (e) {
        e.stopPropagation();
        speak(r.ja);
      });

      row.querySelector('[data-mic]').addEventListener('click', function (e) {
        e.stopPropagation();
        openMic({ ja: r.ja, kana: r.kana || '', reply: true });
      });

      row.querySelector('[data-toggle]').addEventListener('click', function (e) {
        e.stopPropagation();
        toggleReply(i);
      });
    });

    updateRevealAll();
  }

  function toggleReply(i) {
    session.revealed[i] = !session.revealed[i];
    var row = el.face.querySelector('.reply[data-i="' + i + '"]');
    if (row) row.classList.toggle('open', !!session.revealed[i]);
    updateRevealAll();
  }

  function revealAll() {
    var allOpen = session.current.replies.every(function (r, i) { return !!session.revealed[i]; });
    session.current.replies.forEach(function (r, i) { session.revealed[i] = !allOpen; });
    Array.prototype.forEach.call(el.face.querySelectorAll('.reply'), function (row) {
      var i = Number(row.getAttribute('data-i'));
      row.classList.toggle('open', !!session.revealed[i]);
    });
    updateRevealAll();
  }

  function updateRevealAll() {
    var btn = $('reveal-all');
    if (!btn || !session.current) return;
    var allOpen = session.current.replies.every(function (r, i) { return !!session.revealed[i]; });
    btn.textContent = allOpen ? '全部收起' : '全部显示';
  }

  function flip() {
    if (!session.current || session.flipped) return;
    session.flipped = true;
    renderBack();
    setRateVisible(true);
  }

  function setRateVisible(v) {
    el.rateRow.hidden = !v;
    el.btnFlip.hidden = v;
  }

  function rate(level) {
    if (!session.current || !session.flipped) return;

    var c = session.current;
    var r = rec(c.id);
    r.level = level;
    r.seen = (r.seen || 0) + 1;
    r.lastAt = Date.now();
    saveStore();

    session.doneSet[c.id] = true;
    session.queue.shift();

    var rep = session.repeats[c.id] || 0;
    if (level < 3 && rep < 2) {
      session.repeats[c.id] = rep + 1;
      var pos = level === 1 ? Math.min(2, session.queue.length) : Math.min(5, session.queue.length);
      session.queue.splice(pos, 0, c.id);
    }

    updateProgress();
    showCard();
  }

  function updateProgress() {
    var done = Object.keys(session.doneSet).length;
    var pct = session.total ? Math.min(100, Math.round((done / session.total) * 100)) : 0;
    el.progressFill.style.width = pct + '%';
    el.progressText.textContent = done + ' / ' + session.total;
  }

  function renderDone() {
    var counts = { 1: 0, 2: 0, 3: 0 };
    session.ids.forEach(function (id) {
      var r = store.cards[id];
      var lv = r ? r.level : 0;
      if (counts[lv] !== undefined) counts[lv]++;
    });

    el.face.className = 'face';
    el.face.innerHTML =
      '<div class="done">' +
        '<div class="done-emoji">🎉</div>' +
        '<h2>这一轮练完了</h2>' +
        '<p>共 ' + session.total + (session.module === 'word' ? ' 个' : ' 张') + '<br>认识 ' + counts[3] + ' · 有点模糊 ' + counts[2] + ' · 不认识 ' + counts[1] + '</p>' +
        '<p style="font-size:12.5px;opacity:.85">没掌握的卡片下次会优先出现</p>' +
      '</div>';

    el.btnFlip.hidden = true;
    el.rateRow.hidden = true;
    el.doneActions.hidden = false;
    el.star.hidden = true;
    el.progressFill.style.width = '100%';
    el.progressText.textContent = session.total + ' / ' + session.total + ' · 完成';
    updateStats();
  }

  function updateStar() {
    var on = session.current && store.favorites.indexOf(session.current.id) >= 0;
    el.star.textContent = on ? '★' : '☆';
    el.star.classList.toggle('on', !!on);
  }

  function toggleStar() {
    if (!session.current) return;
    var id = session.current.id;
    var i = store.favorites.indexOf(id);
    if (i >= 0) {
      store.favorites.splice(i, 1);
      toast('已取消收藏');
    } else {
      store.favorites.push(id);
      toast('已收藏，可在首页「收藏夹」单独练');
    }
    saveStore();
    updateStar();
    updateStats();
  }

  /* ---------------- 跟读识别 ---------------- */
  var mic = {
    rec: null, state: 'idle', card: null, watch: null, log: [],
    interim: '', lastAlts: [], finished: false, silenceTimer: null,
    target: null, fromFront: false, scored: false, blind: false
  };

  function shortUA() {
    var ua = navigator.userAgent || '';
    var m = ua.match(/(?:Safari|Chrome|Edg|Firefox)\/[\d.]+/g);
    return m ? m.join(' ') : ua.slice(0, 80);
  }

  function micDiag(msg) {
    mic.log.push(new Date().toLocaleTimeString('zh-CN', { hour12: false }) + '  ' + msg);
    var box = $('mic-diag');
    if (box) box.textContent = mic.log.join('\n');
  }

  function showBanner(text) {
    var b = $('mic-banner');
    b.textContent = text;
    b.hidden = false;
  }

  function hideBanner() {
    $('mic-banner').hidden = true;
  }

  function openMic(target) {
    if (!session.current) return;
    mic.card = session.current;
    mic.target = target || { ja: session.current.ja, kana: session.current.kana, reply: false };
    mic.fromFront = !session.flipped;
    // 封面盲测：只显示中文提示，不显示日语答案
    mic.blind = !target && mic.fromFront;
    mic.scored = false;
    mic.log = [];
    hideBanner();
    resetMicUI();
    $('mic-title').textContent = mic.target.reply ? '回应跟读' : (mic.blind ? '口语测试' : '跟读练习');
    $('mic-ja').textContent = mic.target.ja;
    $('mic-kana').textContent = mic.target.kana;
    $('mic-blind-zh').textContent = session.current.zh;
    $('mic-target').hidden = mic.blind;
    $('mic-blind').hidden = !mic.blind;
    $('mic-pass').textContent = mic.blind ? '看答案' : '算通过';
    $('mic-overlay').hidden = false;

    micDiag('浏览器 ' + shortUA());
    micDiag('页面地址 ' + location.origin + '（' + location.protocol + '）');
    micDiag('语音识别接口：' + (SR ? '存在' : '不存在'));
    if (!SR) {
      $('mic-status').textContent = '这个浏览器没有语音识别接口';
      showBanner('这个浏览器没有「语音识别」接口，所以按麦克风不会有任何反应。卡片和发音都正常，只有跟读不能用。想练跟读，请用 Chrome 打开同一地址。');
    } else {
      $('mic-status').textContent = '点一下麦克风，念出这句话';
    }
  }

  function closeMic() {
    // 在封面做口语测试后，关掉弹层自动翻到背面看答案
    var shouldFlip = mic.fromFront && mic.scored && !session.flipped;
    stopRec();
    $('mic-overlay').hidden = true;
    if (shouldFlip) flip();
  }

  function releaseRec() {
    var r = mic.rec;
    mic.rec = null;
    if (!r) return;
    try { r.abort(); } catch (e) {}
  }

  function stopRec() {
    mic.finished = true;
    clearTimeout(mic.watch);
    clearTimeout(mic.silenceTimer);
    releaseRec();
    mic.state = 'idle';
  }

  function resetMicUI() {
    mic.state = 'idle';
    mic.finished = false;
    mic.interim = '';
    mic.lastAlts = [];
    clearTimeout(mic.watch);
    clearTimeout(mic.silenceTimer);
    var btn = $('mic-btn');
    btn.classList.remove('listening');
    $('mic-heard').hidden = true;
    $('mic-score').hidden = true;
    $('mic-actions').hidden = true;
    $('mic-status').textContent = SR ? '点一下麦克风，念出这句话' : '这个浏览器没有语音识别接口';
  }

  function armSilence() {
    clearTimeout(mic.silenceTimer);
    mic.silenceTimer = setTimeout(function () {
      if (mic.state === 'listening' && mic.interim && !mic.finished) {
        micDiag('静音 2.5 秒，自动结束');
        stopRecAndScore();
      }
    }, 2500);
  }

  function finishRec(alts) {
    if (mic.finished) return;
    mic.finished = true;
    clearTimeout(mic.watch);
    clearTimeout(mic.silenceTimer);
    mic.state = 'idle';
    releaseRec();          // 立刻归还麦克风，避免占用音频通道
    evaluate(alts);
    unlockAudio();
    setTimeout(function () {
      try { window.speechSynthesis && window.speechSynthesis.resume(); } catch (e) {}
    }, 350);
  }

  function stopRecAndScore() {
    if (!mic.rec) return;
    var alts = mic.lastAlts.length ? mic.lastAlts : (mic.interim ? [mic.interim] : []);
    try { mic.rec.stop(); } catch (e) {}
    if (alts.length) finishRec(alts);
  }

  function startRec() {
    if (!SR) {
      showBanner('这个浏览器没有「语音识别」接口。想练跟读，请用 Chrome 打开同一地址。');
      return;
    }
    if (mic.state === 'listening' || mic.state === 'starting') { stopRecAndScore(); return; }

    releaseRec();          // 先把上一次的会话彻底关掉
    hideBanner();
    micDiag('点击麦克风');
    mic.interim = '';
    mic.lastAlts = [];
    mic.finished = false;

    try {
      if (window.speechSynthesis) window.speechSynthesis.cancel();

      var r = new SR();
      r.lang = 'ja-JP';
      r.interimResults = true;   // 实时结果：Safari 经常不给「最终结果」
      r.continuous = true;       // 不说完不自动断
      r.maxAlternatives = 3;

      r.onstart = function () {
        clearTimeout(mic.watch);
        mic.state = 'listening';
        micDiag('onstart：开始录音');
        $('mic-btn').classList.add('listening');
        $('mic-status').textContent = '正在听… 说完等一下，或再点一次麦克风结束';
      };

      r.onerror = function (e) {
        var code = e && e.error ? e.error : 'unknown';
        micDiag('onerror：' + code);
        handleRecError(code);
      };

      r.onresult = function (e) {
        var full = '';
        var last = null;
        for (var i = 0; i < e.results.length; i++) {
          full += e.results[i][0].transcript;
          last = e.results[i];
        }
        var alts = [full];
        if (e.results.length === 1) {
          alts = [];
          for (var j = 0; j < last.length; j++) alts.push(last[j].transcript);
        }
        mic.interim = full;
        mic.lastAlts = alts;
        micDiag('onresult：' + full + (last && last.isFinal ? '（定稿）' : '（临时）'));
        $('mic-status').textContent = '听到：' + full;

        if (last && last.isFinal) { finishRec(alts); return; }
        armSilence();
      };

      r.onend = function () {
        clearTimeout(mic.watch);
        clearTimeout(mic.silenceTimer);
        micDiag('onend（state=' + mic.state + '，已听到：' + (mic.interim || '无') + '）');
        $('mic-btn').classList.remove('listening');
        if (mic.finished) return;
        if (mic.interim) {
          finishRec(mic.lastAlts.length ? mic.lastAlts : [mic.interim]);
          return;
        }
        mic.state = 'idle';
        $('mic-status').textContent = '没有收到识别结果';
        showBanner('麦克风是正常的，但浏览器这次没有返回任何识别文字（Safari 上很常见）。你可以先试：系统设置 → 键盘 → 听写，打开并添加「日本語」；如果还是这样，就需要换 Chrome，或者让我把它改成 Mac 本地识别。');
      };

      mic.rec = r;
      mic.state = 'starting';
      $('mic-status').textContent = '正在启动麦克风…';
      r.start();

      clearTimeout(mic.watch);
      mic.watch = setTimeout(function () {
        if (mic.state === 'starting') {
          mic.state = 'idle';
          micDiag('8 秒内没有任何回调');
          $('mic-status').textContent = '8 秒没有响应';
          showBanner('按了麦克风，浏览器 8 秒内没有任何反应。请先点「先检查麦克风是否正常」；如果麦克风没问题，就改用 Chrome 打开这个地址。');
        }
      }, 8000);
    } catch (e) {
      micDiag('start 异常：' + e);
      $('mic-status').textContent = '启动失败：' + (e && e.message ? e.message : e);
    }
  }

  function checkMic() {
    micDiag('检查麦克风权限…');
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      micDiag('getUserMedia 不存在');
      showBanner('这个浏览器环境不允许网页访问麦克风。');
      return;
    }
    navigator.mediaDevices.getUserMedia({ audio: true }).then(function (stream) {
      micDiag('getUserMedia 成功，麦克风可用');
      $('mic-status').textContent = '麦克风正常 ✓ 权限已允许';
      stream.getTracks().forEach(function (t) { t.stop(); });
    }).catch(function (err) {
      var name = err && err.name ? err.name : 'UnknownError';
      var reason = {
        NotAllowedError: '权限被拒绝。打开 Safari → 设置 → 网站 → 麦克风，把 127.0.0.1 改成「允许」，刷新页面再试。',
        NotFoundError: '系统没有检测到麦克风设备。',
        NotReadableError: '麦克风被别的程序占用了（比如会议、录音软件），关掉那些程序再试。',
        SecurityError: '页面不在安全环境下打开，请确认地址是 http://127.0.0.1:8787。',
        AbortError: '麦克风启动被中断，再点一次。'
      }[name] || '未知原因。';
      micDiag('getUserMedia 失败：' + name);
      $('mic-status').textContent = '麦克风打不开（' + name + '）';
      showBanner('麦克风打不开：' + reason);
    });
  }

  function handleRecError(code) {
    if (mic.finished) return;
    clearTimeout(mic.watch);
    clearTimeout(mic.silenceTimer);
    if (code === 'aborted') {
      mic.state = 'idle';
      releaseRec();
      return;
    }
    mic.finished = true;
    mic.state = 'idle';
    releaseRec();
    $('mic-btn').classList.remove('listening');

    var map = {
      'not-allowed': '麦克风权限被拒绝',
      'service-not-allowed': '语音识别服务不可用',
      'no-speech': '没听到声音，靠近一点再说一次',
      'audio-capture': '没有找到可用的麦克风',
      'network': '识别需要联网，请检查网络',
      'aborted': '已取消'
    };
    $('mic-status').textContent = map[code] || ('识别出错（' + code + '）');

    if (code === 'not-allowed') {
      showBanner('麦克风权限被拒绝了。打开 Safari → 设置 → 网站 → 麦克风，把 127.0.0.1 改成「允许」，然后刷新页面。');
    } else if (code === 'service-not-allowed') {
      showBanner('浏览器的语音识别服务不可用（Safari 依赖 macOS 的听写服务）。可以试：系统设置 → 键盘 → 听写，打开并添加日语；或者直接用 Chrome 打开。');
    } else if (code === 'network') {
      showBanner('识别需要联网，请检查网络后重试。');
    }
  }

  function evaluate(alts) {
    mic.state = 'result';
    $('mic-btn').classList.remove('listening');

    // 用这张卡自己的「原句 → 假名」做一次替换（汉字识别结果也能对上）
    var extra = {};
    if (mic.target.ja) {
      extra[mic.target.ja] = mic.target.kana;
      var plainJa = mic.target.ja.replace(/[、。！？!?，．\s]/g, '');
      var plainKana = mic.target.kana.replace(/[、。！？!?，．\s]/g, '');
      if (plainJa && plainJa !== mic.target.ja) extra[plainJa] = plainKana;
    }

    var best = SCORE.compare(mic.target.kana, alts, extra);
    if (!best) {
      $('mic-status').textContent = '没听清，再说一遍试试';
      return;
    }
    mic.scored = true;

    var lv = LEVELS[store.settings.strict] || LEVELS.standard;
    var pass = best.score >= lv.pass;
    var perfect = best.score >= lv.perfect;

    $('mic-status').textContent = '识别完成';
    $('mic-heard').hidden = false;
    $('mic-heard').innerHTML = '<b>我听到的是：</b>' + esc(best.raw || '（空）');

    micDiag('评分：' + best.score + ' 分（' + best.raw + '）');

    // 盲测时不显示标准读音，避免把答案露出来
    $('mic-diff').hidden = !!mic.blind;

    $('mic-score').hidden = false;
    $('score-num').textContent = best.score;
    var ring = $('score-ring');
    ring.style.setProperty('--p', best.score);
    ring.style.setProperty('--ring-color', perfect ? '#2E9E7A' : pass ? '#D2A03A' : '#C25B5B');

    $('score-label').textContent = (perfect ? '完美！' : pass ? '基本正确' : '再试一次') +
      '（' + lv.label + '：' + lv.pass + ' 分通过）';

    $('mic-diff').innerHTML = buildDiff(best);

    $('mic-actions').hidden = false;

    if (!mic.target.reply) {
      var r = rec(mic.card.id);
      r.bestScore = Math.max(r.bestScore || 0, best.score);
      saveStore();
    }
  }

  function buildDiff(best) {
    var norm = SCORE.normalizeWithMap(mic.target.kana);
    if (!norm.map) return '';

    var marked = {};
    var ti = 0;
    best.ops.forEach(function (op) {
      if (op.t === '+') return;
      if (op.t !== '=') marked[ti] = true;
      ti++;
    });

    var origMark = {};
    norm.map.forEach(function (orig, k) {
      if (marked[k]) origMark[orig] = true;
    });

    var src = mic.target.kana;
    var out = '';
    var open = false;
    for (var i = 0; i < src.length; i++) {
      var isMark = !!origMark[i];
      if (isMark && !open) { out += '<mark>'; open = true; }
      if (!isMark && open) { out += '</mark>'; open = false; }
      out += esc(src.charAt(i));
    }
    if (open) out += '</mark>';

    return '标准读音：' + out;
  }

  /* ---------------- 设置 ---------------- */
  function openSettings() {
    syncSettings();
    refreshVoices();
    $('settings-overlay').hidden = false;
  }

  function closeSettings() {
    $('settings-overlay').hidden = true;
  }

  function markSeg(id, value) {
    Array.prototype.forEach.call($(id).querySelectorAll('button'), function (b) {
      b.classList.toggle('on', b.getAttribute('data-v') === String(value));
    });
  }

  function syncSettings() {
    markSeg('set-strict', store.settings.strict);
    markSeg('set-rate', store.settings.rate);
    $('strict-note').textContent =
      '通过线：宽松 ' + LEVELS.loose.pass + ' 分 · 标准 ' + LEVELS.standard.pass +
      ' 分 · 严格 ' + LEVELS.strict.pass + ' 分（满分 100）';
  }

  /* ---------------- 事件 ---------------- */
  $('btn-start').addEventListener('click', function () { startSession('all'); });
  $('freq-filter').addEventListener('click', function (e) {
    var b = e.target.closest('button');
    if (!b) return;
    ui.freq = b.getAttribute('data-freq');
    updateStats();
  });

  $('module-switch').addEventListener('click', function (e) {
    var b = e.target.closest('button');
    if (!b) return;
    var m = b.getAttribute('data-module');
    if (m === ui.module) return;
    ui.module = m;
    ui.cat = 'all';
    updateStats();
  });

  $('cat-filter').addEventListener('click', function (e) {
    var b = e.target.closest('button');
    if (!b) return;
    ui.cat = b.getAttribute('data-cat');
    updateStats();
  });
  $('btn-review').addEventListener('click', function () { startSession('review'); });
  $('btn-fav').addEventListener('click', function () { startSession('fav'); });
  $('btn-settings').addEventListener('click', openSettings);
  $('btn-back').addEventListener('click', function () { stopRec(); showView('home'); });
  el.btnFlip.addEventListener('click', flip);
  el.star.addEventListener('click', toggleStar);
  $('btn-again').addEventListener('click', function () { startSession(session.filter); });
  $('btn-home2').addEventListener('click', function () { showView('home'); });

  Array.prototype.forEach.call(el.rateRow.querySelectorAll('button'), function (b) {
    b.addEventListener('click', function () { rate(Number(b.getAttribute('data-level'))); });
  });

  el.face.addEventListener('click', function (e) {
    var tok = e.target.closest ? e.target.closest('.tok') : null;
    if (!tok) return;
    e.stopPropagation();
    e.preventDefault();
    handleWordTap(tok);
  }, true);

  el.card.addEventListener('click', function (e) {
    if (e.target.closest('button')) return;
    flip();
  });

  /* 跟读 */
  $('mic-close').addEventListener('click', closeMic);
  $('mic-play').addEventListener('click', function () { if (mic.card) speak(mic.card.ja); });
  $('mic-check').addEventListener('click', checkMic);
  $('diag-toggle').addEventListener('click', function () {
    var box = $('mic-diag');
    box.hidden = !box.hidden;
    this.textContent = box.hidden ? '诊断信息' : '收起诊断信息';
  });
  $('diag-copy').addEventListener('click', function () {
    var text = mic.log.join('\n') || '（还没有记录）';
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(function () {
        toast('诊断信息已复制，直接粘贴发给我');
      }).catch(function () {
        window.prompt('复制下面的内容发给我：', text);
      });
    } else {
      window.prompt('复制下面的内容发给我：', text);
    }
  });
  $('mic-btn').addEventListener('click', startRec);
  $('mic-retry').addEventListener('click', function () {
    resetMicUI();
    startRec();
  });
  $('mic-pass').addEventListener('click', function () {
    var blind = mic.blind;
    closeMic();
    if (!blind) toast('已通过，继续下一张');
  });
  $('mic-overlay').addEventListener('click', function (e) {
    if (e.target === $('mic-overlay')) closeMic();
  });

  /* 设置 */
  $('settings-close').addEventListener('click', closeSettings);
  $('settings-overlay').addEventListener('click', function (e) {
    if (e.target === $('settings-overlay')) closeSettings();
  });

  $('set-strict').addEventListener('click', function (e) {
    var b = e.target.closest('button');
    if (!b) return;
    store.settings.strict = b.getAttribute('data-v');
    saveStore();
    syncSettings();
  });

  $('set-rate').addEventListener('click', function (e) {
    var b = e.target.closest('button');
    if (!b) return;
    store.settings.rate = Number(b.getAttribute('data-v'));
    saveStore();
    syncSettings();
    speak('こんにちは');
  });

  $('set-voice').addEventListener('change', function (e) {
    store.settings.voiceURI = e.target.value;
    saveStore();
    speak('こんにちは');
  });

  $('btn-test-voice').addEventListener('click', function () {
    speak('こんにちは。これは音声のテストです。');
    setTimeout(function () {
      var speaking = window.speechSynthesis &&
        (window.speechSynthesis.speaking || window.speechSynthesis.pending);
      var note = $('voice-note');
      if (note) {
        note.textContent = speaking
          ? '正在播放。如果听不见，检查手机侧边静音键和音量。'
          : '没有检测到播放。可能是静音键、音量，或系统语音被占用。';
      }
    }, 1100);
  });

  $('btn-export').addEventListener('click', exportProgress);
  $('btn-import').addEventListener('click', function () { $('import-file').click(); });
  $('import-file').addEventListener('change', function (e) {
    var file = e.target.files && e.target.files[0];
    if (file) importProgress(file);
    e.target.value = '';
  });

  $('btn-reset').addEventListener('click', function () {
    if (!window.confirm('确定清空所有学习进度和收藏吗？此操作不能撤销。')) return;
    store = defaultStore();
    saveStore();
    updateStats();
    syncSettings();
    toast('已重置');
  });

  /* ---------------- 进度备份 ---------------- */
  function exportProgress() {
    var data = {
      app: 'jp-travel-cards',
      version: 1,
      exportedAt: new Date().toISOString(),
      settings: store.settings,
      cards: store.cards,
      favorites: store.favorites
    };
    try {
      var blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      var url = URL.createObjectURL(blob);
      var a = document.createElement('a');
      a.href = url;
      a.download = '日语闪卡进度-' + new Date().toISOString().slice(0, 10) + '.json';
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(function () { URL.revokeObjectURL(url); }, 2000);
      toast('已导出，记得保存好这个文件');
    } catch (e) {
      toast('导出失败：' + (e && e.message ? e.message : e));
    }
  }

  function importProgress(file) {
    var reader = new FileReader();
    reader.onload = function () {
      try {
        var data = JSON.parse(reader.result);
        if (!data || data.app !== 'jp-travel-cards' || !data.cards) {
          throw new Error('格式不对');
        }
        if (!window.confirm('导入会覆盖这台设备上现有的学习进度和收藏，继续吗？')) return;
        store.cards = data.cards || {};
        store.favorites = data.favorites || [];
        if (data.settings) store.settings = Object.assign({}, store.settings, data.settings);
        saveStore();
        updateStats();
        syncSettings();
        toast('导入成功');
      } catch (e) {
        toast('这个文件不是进度备份，导入失败');
      }
    };
    reader.onerror = function () { toast('读取文件失败'); };
    reader.readAsText(file);
  }

  /* 键盘 */
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') {
      if (!$('mic-overlay').hidden) { closeMic(); return; }
      if (!$('settings-overlay').hidden) { closeSettings(); return; }
    }
    if (el.study.hidden || !$('mic-overlay').hidden || !$('settings-overlay').hidden) return;
    if (e.key === ' ') {
      e.preventDefault();
      if (!session.flipped) flip();
    } else if (session.flipped && (e.key === '1' || e.key === '2' || e.key === '3')) {
      rate(Number(e.key));
    }
  });

  document.addEventListener('pointerdown', unlockAudio, { once: true });

  window.addEventListener('pagehide', function () {
    if (window.speechSynthesis) window.speechSynthesis.cancel();
    stopRec();
  });

  /* ---------------- 初始化 ---------------- */
  updateStats();
  syncSettings();
  refreshVoices();
  setTimeout(refreshVoices, 400);
  setTimeout(refreshVoices, 1500);
  if (window.speechSynthesis) {
    try {
      window.speechSynthesis.addEventListener('voiceschanged', refreshVoices);
    } catch (e) {
      window.speechSynthesis.onvoiceschanged = refreshVoices;
    }
  }
})();
