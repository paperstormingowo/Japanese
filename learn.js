/* 手機版的共用邏輯：作答判定、FSRS 排程、出字。規則正本是桌機的 learn.py，這裡逐條照搬，改規則時兩邊要一起改。
   瀏覽器用全域 Learn；Node（測試）用 require。 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory(require("./fsrs.js"));
  else root.Learn = factory(root.FSRS);
})(this, function (F) {
  const MASTERED_DAYS = 21, SEEN_MIN = 8, HIGH_DAYS = 7, LOW_DAYS = 2;
  const HARD_MISSES = 2;   // 累計漏掉幾次算「老是忘的字」：開局前幾盤不出、輸送帶上同時最多一盤
  const TIERS = ["N5", "N4", "N3", "N2"];
  const KEY = "sushi_progress";
  const sched = F.fsrs(F.generatorParameters({ enable_fuzz: false }));

  const ROMA = (() => {
    const t = {};
    const rows = { "": "あいうえお", k: "かきくけこ", s: "さしすせそ", t: "たちつてと", n: "なにぬねの",
      h: "はひふへほ", m: "まみむめも", r: "らりるれろ", g: "がぎぐげご", z: "ざじずぜぞ",
      d: "だぢづでど", b: "ばびぶべぼ", p: "ぱぴぷぺぽ", x: "ぁぃぅぇぉ", l: "ぁぃぅぇぉ" };
    for (const c in rows) [..."aiueo"].forEach((v, i) => { t[c + v] = rows[c][i]; });
    const ys = { k: "き", s: "し", t: "ち", c: "ち", n: "に", h: "ひ", m: "み", r: "り",
      g: "ぎ", z: "じ", j: "じ", d: "ぢ", b: "び", p: "ぴ" };
    for (const c in ys) [..."auo"].forEach((v, i) => { t[c + "y" + v] = ys[c] + "ゃゅょ"[i]; });
    return Object.assign(t, { ya: "や", yu: "ゆ", yo: "よ", wa: "わ", wo: "を", shi: "し", chi: "ち", tsu: "つ",
      fu: "ふ", ji: "じ", ja: "じゃ", ju: "じゅ", jo: "じょ", je: "じぇ", sha: "しゃ",
      shu: "しゅ", sho: "しょ", she: "しぇ", cha: "ちゃ", chu: "ちゅ", cho: "ちょ",
      che: "ちぇ", fa: "ふぁ", fi: "ふぃ", fe: "ふぇ", fo: "ふぉ", thi: "てぃ", dhi: "でぃ",
      vu: "ゔ", xtu: "っ", ltu: "っ", xya: "ゃ", xyu: "ゅ", xyo: "ょ", "-": "ー" });
  })();
  const VOWEL = {};
  ["あかさたなはまやらわがざだばぱぁゃ", "いきしちにひみりぎじぢびぴぃ", "うくすつぬふむゆるぐずづぶぷぅゅ",
    "えけせてねへめれげぜでべぺぇ", "おこそとのほもよろをごぞどぼぽぉょ"].forEach((ks, i) => {
    for (const k of ks) VOWEL[k] = "あいうえお"[i];
  });
  const NV = "aiueoy";   // n 後面接這些就不是「ん」

  function romajiToKana(s) {
    let out = "", i = 0;
    while (i < s.length) {
      const c = s[i], nxt = s.slice(i + 1, i + 2), n2 = s.slice(i + 2, i + 3);
      if (c === "n" && !(nxt && NV.includes(nxt))) {
        out += "ん";
        i += ((nxt === "n" || nxt === "'") && !(n2 && NV.includes(n2))) || nxt === "'" ? 2 : 1;
        continue;
      }
      if (c === "m" && (nxt === "b" || nxt === "p")) { out += "ん"; i += 1; continue; }
      if (c === nxt && !"aiueon-".includes(c)) { out += "っ"; i += 1; continue; }
      let hit = false;
      for (const k of [3, 2, 1]) {
        const seg = s.slice(i, i + k);
        if (Object.prototype.hasOwnProperty.call(ROMA, seg)) { out += ROMA[seg]; i += seg.length; hit = true; break; }
      }
      if (!hit) { out += c; i += 1; }
    }
    return out;
  }

  /* 全半形統一、羅馬拼音轉假名、片假名轉平假名、長音 ー 換成母音 */
  function norm(s) {
    s = s.normalize("NFKC").trim().split(" ").join("").toLowerCase();
    if (/^[\x00-\x7f]*$/.test(s)) s = romajiToKana(s);
    let out = "";
    for (let c of s) {
      if (c >= "ァ" && c <= "ヶ") c = String.fromCharCode(c.charCodeAt(0) - 0x60);
      out += c === "ー" ? (VOWEL[out.slice(-1)] || c) : c;
    }
    return out;
  }

  function isCorrect(word, text) {
    return !!text.trim() && (norm(text) === norm(word.kana) || text.trim() === word.kanji);
  }

  const CONF = { "づ": "ず", "ぢ": "じ", "つ": "す", "ち": "し", "ゃ": "や", "ゅ": "ゆ", "ょ": "よ" };

  /* 抹平「容易打錯」的差異：濁音、半濁音、つ/ず、ち/じ、促音、長音 */
  function fold(s) {
    s = [...norm(s).split("っ").join("")].map((c) => CONF[c] || c).join("");
    s = s.normalize("NFD").replace(/[゙゚]/g, "").normalize("NFC");
    let out = "";
    for (const c of s) {
      const v = VOWEL[out.slice(-1)];
      if ("あいうえお".includes(c) && (v === c || (v === "お" && c === "う") || (v === "え" && c === "い"))) continue;
      out += c;
    }
    return out;
  }

  function similar(word, text) {
    return !!text.trim() && fold(text) === fold(word.kana);
  }

  function mastery(card) {
    if (!card) return "無";
    const s = card.stability || 0;
    if (s < LOW_DAYS || card.state === F.State.Relearning) return "低";
    return s >= HIGH_DAYS ? "高" : "中";
  }

  const due = (card, t) => new Date(card.due) <= t;
  const choice = (a) => a[Math.floor(Math.random() * a.length)];

  /* 手機自己的紀錄，存在這支手機的瀏覽器裡（不回傳桌機） */
  class Progress {
    constructor(store) {
      this.store = store;
      let d = {};
      try { d = JSON.parse(store.getItem(KEY)) || {}; } catch (e) { d = {}; }
      this.cards = d.cards || {};
      this.log = d.log || [];
    }
    save() { this.store.setItem(KEY, JSON.stringify({ cards: this.cards, log: this.log })); }
    review(kana, rating, ms) {
      const t = new Date();
      const card = this.cards[kana] || F.createEmptyCard(t);
      this.cards[kana] = JSON.parse(JSON.stringify(sched.next(card, t, rating).card));
      this.log.push({ kana, rating: ["", "Again", "Hard", "Good", "Easy"][rating], ms, at: t.toISOString() });
    }
    misses() {                       // 每個字累計漏掉幾次（紀錄裡的 Again）
      const n = {};
      for (const e of this.log) if (e.rating === "Again") n[e.kana] = (n[e.kana] || 0) + 1;
      return n;
    }
    lastMissed() {                   // 最近一次作答是漏掉的字：這局吃回來就是「リベンジ」
      const last = {};
      for (const e of this.log) last[e.kana] = e.rating;
      return new Set(Object.keys(last).filter((k) => last[k] === "Again"));
    }
    mastered() { return Object.values(this.cards).filter((c) => (c.stability || 0) > MASTERED_DAYS).length; }
    level() { return 1 + Math.floor(this.mastered() / 10); }
  }

  /* 一局的出字：到期字優先 → 新字與見過的字各半；某題材某一級全是「高」就只留到期的字、開局跳過那一級 */
  class Picker {
    constructor(prog, words) {
      this.prog = prog;
      this.t = new Date();
      const cards = prog.cards;
      const key = (w) => w.cat + "|" + (w.jlpt || "N5");
      const groups = {};
      for (const w of words) (groups[key(w)] = groups[key(w)] || []).push(w);
      let high = new Set(Object.keys(groups).filter((k) => groups[k].every((w) => mastery(cards[w.kana]) === "高")));
      if (high.size === Object.keys(groups).length) high = new Set();
      this.reviewOnly = new Set(words.filter((w) => high.has(key(w))).map((w) => w.kana));
      words = words.filter((w) => !high.has(key(w)) || due(cards[w.kana], this.t));
      const open = Object.keys(groups).filter((k) => !high.has(k));
      this.start = Math.max(0, TIERS.findIndex((lv) => open.some((k) => k.split("|")[1] === lv)));
      this.tiers = TIERS.map((lv) => words.filter((w) => (w.jlpt || "N5") === lv));
      this.served = new Set();
    }
    pick(tier, avoid) {
      const cards = this.prog.cards, sv = this.served;
      const ws = this.tiers[tier].filter((w) => !avoid.has(w.kana));
      const dueWs = ws.filter((w) => cards[w.kana] && !sv.has(w.kana) && due(cards[w.kana], this.t));
      const fresh = ws.filter((w) => !cards[w.kana] && !sv.has(w.kana));
      const seen = ws.filter((w) => (cards[w.kana] || sv.has(w.kana)) && !this.reviewOnly.has(w.kana));
      let w;
      if (dueWs.length) w = choice(dueWs);
      else if (fresh.length && (seen.length < SEEN_MIN || Math.random() < 0.5)) w = choice(fresh);
      else if (seen.length) {
        const wt = seen.map((x) => (cards[x.kana] ? 1 / (1 + (cards[x.kana].stability || 0)) : 1));
        let r = Math.random() * wt.reduce((a, b) => a + b, 0);
        w = seen[seen.length - 1];
        for (let i = 0; i < seen.length; i++) { r -= wt[i]; if (r < 0) { w = seen[i]; break; } }
      } else return null;
      sv.add(w.kana);
      return w;
    }
  }

  /* 第三條軌道上的讀音提示：f＝在第三條走了幾成。一進來就給第一個字，走到 full 時全部顯示，沒顯示的用・ */
  function hint(kana, f, full = 0.6) {
    const ks = [...kana], n = Math.min(ks.length, 1 + Math.floor(Math.max(f, 0) / full * ks.length));
    return ks.slice(0, n).join("") + "・".repeat(ks.length - n);
  }

  /* 漏掉＝Again；盤子走完一半前吃到＝Good；之後才吃到＝Hard。到第三條看了提示才吃到算漏掉（index.html 處理） */
  function ratingFor(missed, early) {
    return missed ? F.Rating.Again : early ? F.Rating.Good : F.Rating.Hard;
  }

  return { TIERS, HARD_MISSES, hint, norm, fold, isCorrect, similar, mastery, Progress, Picker, ratingFor, romajiToKana };
});
