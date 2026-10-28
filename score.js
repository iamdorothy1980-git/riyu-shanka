/* 跟读比对引擎（纯函数，方便单独测试）
 * 思路：把标准读音和识别结果都归一化成「平假名」再算相似度，
 * 这样 汉字/假名 写法差异、标点、片假名 都不会被误判成错误。
 */
(function () {
  'use strict';

  var K = window.KANJI_READINGS || {};
  var KEYS = Object.keys(K).sort(function (a, b) { return b.length - a.length; });

  // 片假名 → 平假名（1:1，长度不变）
  function toHiragana(s) {
    return s.replace(/[\u30A1-\u30F6]/g, function (c) {
      return String.fromCharCode(c.charCodeAt(0) - 0x60);
    });
  }

  // 汉字 → 假名（词典最长匹配）
  function kanjiToKana(s) {
    var out = s;
    for (var i = 0; i < KEYS.length; i++) {
      var k = KEYS[i];
      if (out.indexOf(k) !== -1) out = out.split(k).join(K[k]);
    }
    return out;
  }

  var PUNCT = /[\s\u3000、。，．,.!?！？「」『』（）()・…‥~〜\-—–:：;；"'“”‘’]/;

  // 归一化，同时记录每个输出字符对应的原始下标（用于把差异高亮回原文）
  function normalizeWithMap(src) {
    var chars = [];
    var map = [];
    for (var i = 0; i < src.length; i++) {
      var ch = src.charAt(i);
      if (PUNCT.test(ch)) continue;
      var nf = ch.normalize ? ch.normalize('NFKC') : ch;
      if (nf.length === 1) {
        chars.push(nf);
        map.push(i);
      } else {
        for (var j = 0; j < nf.length; j++) {
          chars.push(nf.charAt(j));
          map.push(i);
        }
      }
    }
    var joined = toHiragana(chars.join(''));
    var text = kanjiToKana(joined);
    // 只对「全是假名」的标准读音使用 map；含汉字时 map 会错位，直接丢弃
    return { text: text, map: text.length === map.length ? map : null };
  }

  function normalize(src) {
    return normalizeWithMap(String(src || '')).text;
  }

  // 编辑距离 + 回溯路径
  function align(a, b) {
    var n = a.length;
    var m = b.length;
    var dp = [];
    for (var i = 0; i <= n; i++) {
      dp.push(new Array(m + 1).fill(0));
      dp[i][0] = i;
    }
    for (var j = 0; j <= m; j++) dp[0][j] = j;

    for (i = 1; i <= n; i++) {
      for (j = 1; j <= m; j++) {
        var cost = a.charAt(i - 1) === b.charAt(j - 1) ? 0 : 1;
        dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + cost);
      }
    }

    var ops = [];
    i = n;
    j = m;
    while (i > 0 || j > 0) {
      if (i > 0 && j > 0 && a.charAt(i - 1) === b.charAt(j - 1) && dp[i][j] === dp[i - 1][j - 1]) {
        ops.push({ t: '=', a: a.charAt(i - 1), b: b.charAt(j - 1) });
        i--; j--;
      } else if (i > 0 && j > 0 && dp[i][j] === dp[i - 1][j - 1] + 1) {
        ops.push({ t: '~', a: a.charAt(i - 1), b: b.charAt(j - 1) });
        i--; j--;
      } else if (i > 0 && dp[i][j] === dp[i - 1][j] + 1) {
        ops.push({ t: '-', a: a.charAt(i - 1), b: '' });
        i--;
      } else {
        ops.push({ t: '+', a: '', b: b.charAt(j - 1) });
        j--;
      }
    }
    ops.reverse();

    var dist = dp[n][m];
    var sim = 1 - dist / Math.max(n, m, 1);
    return { ops: ops, dist: dist, sim: Math.max(0, Math.min(1, sim)) };
  }

  // 把「这张卡自己的原句」按已知假名替换掉，避免依赖全局汉字表
  function applyExtra(text, extra) {
    if (!extra) return text;
    var keys = Object.keys(extra).sort(function (a, b) { return b.length - a.length; });
    var out = text;
    keys.forEach(function (k) {
      if (k && out.indexOf(k) !== -1) out = out.split(k).join(extra[k]);
    });
    return out;
  }

  // 在若干识别候选里挑最像的一个
  function compare(kana, alternatives, extra) {
    var target = normalizeWithMap(String(kana || '')).text;
    if (!target) return null;
    var best = null;
    (alternatives || []).forEach(function (raw) {
      var heard = normalize(applyExtra(String(raw || ''), extra));
      if (!heard) return;
      var res = align(target, heard);
      var score = Math.round(res.sim * 100);
      if (!best || score > best.score) {
        best = { score: score, raw: String(raw || ''), heard: heard, ops: res.ops, dist: res.dist, target: target };
      }
    });
    return best;
  }

  window.JPScore = {
    toHiragana: toHiragana,
    kanjiToKana: kanjiToKana,
    normalize: normalize,
    normalizeWithMap: normalizeWithMap,
    align: align,
    compare: compare
  };
})();
