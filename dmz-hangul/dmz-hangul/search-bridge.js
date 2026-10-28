/*
 * 한글 검색 브리지 (페이지 본문 세계 = MAIN world 에서 실행)
 *
 * 왜 필요한가?
 *  사이트의 검색은 내부 영문 데이터로 찾기 때문에, 화면 글자를 한글로 바꿔도 "열쇠"를 입력하면 결과가 없습니다.
 *  → 검색창에 한글을 입력하면, 사이트 스크립트가 값을 읽는 순간에만 영문으로 바꿔서 돌려줍니다.
 *  화면의 검색창에는 입력한 한글이 그대로 보입니다. (실제 입력값은 건드리지 않음)
 *
 * 영문 변환은 dictionary.js 의 한글 ↔ 영문 쌍을 거꾸로 사용합니다.
 */
(function (root) {
  "use strict";

  const HANGUL = /[\u1100-\u11FF\u3130-\u318F\uAC00-\uD7A3]/;
  const GRADE_RANK = { o: 0, u: 1, x: 2 };

  // 비교용: 공백 제거 + 자모 분해(NFD). '창사'(입력 중) 가 '창산' 의 앞부분으로 맞도록.
  const norm = (s) => s.normalize("NFD").replace(/\s+/g, "").toLowerCase();

  // 같은 한글 이름에 영문 표기가 여럿일 때 하나로 정한다.
  //  - 띄어쓰기만 다른 표기(BlackMarket / Black Market)는 띄어쓴 쪽
  //  - 완전히 다른 표기(Shopping DRC Locker / Shopping DRC Weapons Locker)는 공통 앞부분(Shopping DRC)
  //    → 사이트 검색이 부분 일치라면 두 표기 모두 걸립니다.
  function pickVariant(vars) {
    if (vars.length === 1) return vars[0];
    const key = (v) => v.en.toLowerCase().replace(/[^a-z0-9]/g, "");
    if (vars.every((v) => key(v) === key(vars[0]))) {
      return vars.slice().sort((x, y) => (y.en.match(/[ -]/g) || []).length - (x.en.match(/[ -]/g) || []).length || x.en.length - y.en.length)[0];
    }
    const words = vars.map((v) => v.en.split(/\s+/));
    let n = 0;
    while (words.every((w) => w[n] && w[n].toLowerCase() === words[0][n].toLowerCase())) n++;
    const prefix = words[0].slice(0, n).join(" ");
    if (n >= 1 && prefix.length >= 4) return { en: prefix, rank: vars[0].rank };
    return vars.slice().sort((x, y) => x.en.length - y.en.length)[0];
  }

  function buildIndex(dict) {
    const groups = new Map();
    for (const [en, ko, grade] of dict) {
      if (!ko || !en) continue;
      // 문장/좌표/링크 조각 등 검색어로 부적합한 항목 제외
      if (en.length > 60 || ko.length > 40) continue;
      if (/[{}→↗·]/.test(en) || /[{}→↗·]/.test(ko)) continue;
      if (/[.!?]$/.test(en.trim()) || en.trim().split(/\s+/).length > 7) continue;
      if (!/[A-Za-z]/.test(en)) continue;
      const k = norm(ko);
      const rank = GRADE_RANK[grade] ?? 2;
      const g = groups.get(k) || { ko, k, rank: 9, vars: [] };
      g.vars.push({ en, rank });
      if (rank < g.rank) g.rank = rank;
      groups.set(k, g);
    }
    const out = [];
    for (const g of groups.values()) {
      const best = pickVariant(g.vars.filter((v) => v.rank === g.rank));
      out.push({ en: best.en, ko: g.ko, k: g.k, rank: g.rank });
    }
    return out;
  }

  function createConverter(dict) {
    const entries = buildIndex(dict);
    const cache = new Map();

    const STOP = new Set(["the", "and", "for", "of", "room", "key"]);
    const wordsOf = (en) => (en.match(/[A-Za-z0-9][A-Za-z0-9'-]*/g) || []).filter((w) => w.length >= 3);

    // 한글 묶음 → 영문 검색어
    //  1) 한글 이름이 정확히 같은 항목이 있으면 그 영문 (복수형 'Backpacks' 는 'Backpack' 으로 — 다른 항목도 걸리도록)
    //  2) 일부만 맞는 항목이 여러 개면, 그 영문들에 공통으로 들어 있는 단어 (예: 수류탄 → Grenade)
    //  3) 하나뿐이면 그 항목
    function lookupWords(tokens, strict) {
      const clean = tokens.map((t) => t.replace(/[\u3130-\u318F]+$/g, "")).filter(Boolean);
      const q = norm(clean.join(""));
      if (!q) return strict ? null : tokens.join(" ");

      let exact = null;
      const cand = [];
      for (const e of entries) {
        if (e.k === q) {
          if (!exact || e.rank < exact.rank || (e.rank === exact.rank && e.en.length < exact.en.length)) exact = e;
        } else if (e.k.includes(q)) cand.push(e);
      }
      if (exact) {
        let en = exact.en;
        if (/s$/i.test(en) && !/ss$/i.test(en)) {
          const stem = en.slice(0, -1).toLowerCase();
          if (cand.some((e) => e.en.toLowerCase().includes(stem) && !e.en.toLowerCase().includes(en.toLowerCase()))) en = en.slice(0, -1);
        }
        return en;
      }
      if (cand.length === 1) return cand[0].en;
      if (cand.length > 1) {
        const count = new Map();
        for (const e of cand) for (const w of new Set(wordsOf(e.en).map((x) => x.toLowerCase()))) if (!STOP.has(w)) count.set(w, (count.get(w) || 0) + 1);
        // 가장 많이 겹치는 단어. 동률이면 영문 이름의 뒤쪽 단어(Armor Vest 의 Vest 처럼 핵심 명사)를 고른다
        const tail = (w) => {
          let sum = 0;
          for (const e of cand) {
            const ws = wordsOf(e.en).map((x) => x.toLowerCase());
            const i = ws.lastIndexOf(w);
            if (i >= 0) sum += ws.length - 1 - i;
          }
          return sum;
        };
        let bestW = null;
        let bestC = 0;
        for (const [w, c] of count) if (c > bestC || (c === bestC && tail(w) < tail(bestW))) { bestW = w; bestC = c; }
        if (bestW && bestC >= 2 && bestC >= cand.length * 0.5) return bestW.replace(/^./, (c) => c.toUpperCase());
        // 공통 단어가 없으면 앞부분이 맞는 것 중 가장 짧은 항목
        cand.sort((x, y) => (x.k.startsWith(q) ? 0 : 1) - (y.k.startsWith(q) ? 0 : 1) || x.k.length - y.k.length || x.rank - y.rank);
        return cand[0].en;
      }
      // 한 덩어리로는 없음: 단어마다 모두 포함하는 항목 → 없으면 단어별로 따로 변환
      const qs = clean.map(norm);
      if (qs.length > 1) {
        const all = entries.filter((e) => qs.every((x) => e.k.includes(x)));
        if (all.length) return all.sort((x, y) => x.k.length + x.rank * 10 - (y.k.length + y.rank * 10))[0].en;
      }
      if (strict) return null;
      if (clean.length > 1) return clean.map((t) => lookupWords([t])).join(" ");
      return tokens.join(" ");
    }

    return function convert(str) {
      if (!str || !HANGUL.test(str)) return str;
      const hit = cache.get(str);
      if (hit !== undefined) return hit;
      // 영문/한글이 섞여 있으면 한글 단어 묶음만 바꾼다  예) "gas 주유소" → "gas Gas Station"
      const tokens = str.trim().split(/\s+/);
      if (tokens.length > 1 && tokens.some((t) => !HANGUL.test(t))) {
        // "원자로 DRC 보관함" 처럼 영문이 섞인 이름: 전체로 먼저 찾아본다
        const whole = lookupWords(tokens, true);
        if (whole) {
          cache.set(str, whole);
          return whole;
        }
      }
      const out = [];
      let run = [];
      const flush = () => {
        if (run.length) out.push(lookupWords(run));
        run = [];
      };
      for (const t of tokens) {
        if (HANGUL.test(t)) run.push(t);
        else {
          flush();
          out.push(t);
        }
      }
      flush();
      const res = out.join(" ");
      if (cache.size > 500) cache.clear();
      cache.set(str, res);
      return res;
    };
  }

  const api = { createConverter, norm };
  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
    return;
  }

  // ───────────── 브라우저(MAIN world) 설치 ─────────────
  const dict = root.DMZKO_DICT;
  if (!dict || typeof HTMLInputElement === "undefined") return;
  const convert = createConverter(dict);
  try {
    delete root.DMZKO_DICT; // 페이지 전역을 어지럽히지 않도록
  } catch (e) {}

  // 변환하면 안 되는 입력칸(메모·라벨·이름·메일·주소 등). 검색창 힌트가 있으면 이쪽보다 우선합니다.
  const SEARCH_HINT = /search|find|query|filter|lookup|cmdk|palette|omni|command|검색|찾기|찾아/i;
  const SKIP_HINT = /label|note|memo|comment|desc|message|e-?mail|pass|evidence|url|link|name|title|plan|nick|display|username|coord|라벨|메모|이름|제목|설명|메시지|주소/i;
  const SEARCH_ANCESTOR = '[role="search"], form[role="search"], [class*="search" i], [id*="search" i], [class*="palette" i], [class*="command" i], [class*="cmdk" i]';
  function isSearchBox(el) {
    const t = (el.getAttribute("type") || "text").toLowerCase();
    if (t !== "search" && t !== "text") return false;
    if (el.readOnly || el.disabled) return false;
    if (t === "search") return true;
    const role = (el.getAttribute("role") || "").toLowerCase();
    if (role === "searchbox" || role === "combobox") return true;
    if ((el.getAttribute("inputmode") || "").toLowerCase() === "search") return true;
    const hint = [el.id, el.name, el.className, el.getAttribute("aria-label"), el.getAttribute("placeholder"), el.getAttribute("data-testid"), el.getAttribute("autocomplete")]
      .filter((v) => typeof v === "string")
      .join(" ");
    if (SEARCH_HINT.test(hint)) return true;
    if (el.closest && el.closest(SEARCH_ANCESTOR)) return true;
    // 단서가 전혀 없으면 검색창으로 간주 (사이트 검색창의 속성을 정확히 알 수 없으므로). 메모·이름 칸은 위 SKIP_HINT 로 제외.
    return !SKIP_HINT.test(hint);
  }

  const desc = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value");
  if (!desc || !desc.get) return;
  Object.defineProperty(HTMLInputElement.prototype, "value", {
    configurable: true,
    enumerable: desc.enumerable,
    get() {
      const v = desc.get.call(this);
      if (v && HANGUL.test(v) && document.documentElement.dataset.dmzkoSearch !== "0" && isSearchBox(this)) {
        try {
          const out = convert(v);
          try {
            if (window.localStorage && localStorage.getItem("dmzkoDebug") === "1") console.log("[dmz-hangul] 검색어", JSON.stringify(v), "→", JSON.stringify(out));
          } catch (e2) {}
          return out;
        } catch (e) {}
      }
      return v;
    },
    set(v) {
      desc.set.call(this, v);
    },
  });

  const on = () => document.documentElement.dataset.dmzkoSearch !== "0";
  const rawValue = (el) => desc.get.call(el);
  const debug = (...a) => {
    try {
      if (window.localStorage && localStorage.getItem("dmzkoDebug") === "1") console.log("[dmz-hangul]", ...a);
    } catch (e) {}
  };

  // <form> 으로 검색하는 사이트: FormData 는 value 접근자를 거치지 않으므로 별도로 영문으로 바꿔 준다
  document.addEventListener(
    "formdata",
    (ev) => {
      if (!on() || !ev.target || !ev.target.querySelectorAll) return;
      for (const el of ev.target.querySelectorAll("input[name]")) {
        const v = rawValue(el);
        if (v && HANGUL.test(v) && isSearchBox(el)) {
          const out = convert(v);
          debug("폼 전송", JSON.stringify(v), "→", JSON.stringify(out));
          ev.formData.set(el.name, out);
        }
      }
    },
    true
  );

  // 한글 입력(IME) 조합이 끝나면 입력 이벤트를 한 번 더 알려 준다.
  // 조합 중 이벤트를 무시하는 사이트에서도 최종 검색어로 검색이 실행되도록.
  document.addEventListener(
    "compositionend",
    (ev) => {
      const el = ev.target;
      if (!on() || !(el instanceof HTMLInputElement) || !isSearchBox(el)) return;
      setTimeout(() => {
        const v = rawValue(el);
        if (v && HANGUL.test(v)) {
          debug("조합 종료", JSON.stringify(v), "→", JSON.stringify(convert(v)));
          el.dispatchEvent(new Event("input", { bubbles: true }));
        }
      }, 0);
    },
    true
  );

  // 화면 구석에 "영문 검색어: Backpack" 을 잠깐 보여 준다 → 변환이 되었는지 한눈에 확인.
  //  (<code> 태그를 써서 확장 프로그램의 번역 대상에서 제외)
  let badge = null;
  let badgeTimer = 0;
  function showBadge(text) {
    if (!document.body) return;
    if (!badge || !badge.isConnected) {
      badge = document.createElement("code");
      badge.setAttribute("aria-hidden", "true");
      badge.style.cssText =
        "position:fixed;right:12px;bottom:12px;z-index:2147483647;background:#111;color:#ffd400;border:1px solid #555;" +
        "padding:6px 10px;font:12px/1.4 system-ui,sans-serif;border-radius:4px;pointer-events:none;opacity:0;transition:opacity .15s";
      document.body.appendChild(badge);
    }
    badge.textContent = "\uD83D\uDD0E 영문 검색어: " + text;
    badge.style.opacity = "1";
    clearTimeout(badgeTimer);
    badgeTimer = setTimeout(() => (badge.style.opacity = "0"), 2500);
  }
  document.addEventListener(
    "input",
    (ev) => {
      const el = ev.target;
      if (!on() || !(el instanceof HTMLInputElement) || !isSearchBox(el)) return;
      const v = rawValue(el);
      if (!v || !HANGUL.test(v)) return;
      const out = convert(v);
      if (out && out !== v) showBadge(out);
    },
    true
  );

  // 점검용: 콘솔에서 __dmzkoConvert("배낭") 을 입력하면 변환 결과를 볼 수 있습니다.
  try {
    Object.defineProperty(root, "__dmzkoConvert", { value: convert, configurable: true });
  } catch (e) {}
  debug("검색 브리지 설치됨");
})(typeof globalThis !== "undefined" ? globalThis : this);
