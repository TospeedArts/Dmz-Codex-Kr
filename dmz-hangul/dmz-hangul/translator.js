/*
 * 번역 엔진 (DOM과 무관한 순수 로직 → Node에서도 테스트 가능)
 *
 * createTranslator(dict, { unofficial: true|false, maxLen: 100 })
 *   → translate(str) 함수를 돌려줍니다.
 *
 * 동작 순서
 *  1) 문자열 전체가 사전 키와 정확히 같으면 그 값으로 교체  (등급 o / u / x 모두)
 *  2) 여러 문장으로 된 문자열이면 문장별로 1)을 시도 (아이콘 클릭 설명 문구용)
 *  3) 아니면(길이 maxLen 이하일 때만) "N areas" 같은 패턴을 먼저 치환하고,
 *     사전의 o / u 항목을 긴 표현 우선으로 부분 치환
 *  - 'x' 등급은 1), 2)에서만 쓰입니다. (문장 설명이 부분 치환되어 어색해지는 것을 방지)
 *  - 이미 한글로 바뀐 문자열은 영문 키와 맞지 않으므로 다시 돌려도 결과가 같습니다.
 */
(function (root) {
  "use strict";

  const normKey = (s) =>
    s.replace(/[‘’]/g, "'").replace(/\s+/g, " ").trim().toLowerCase();

  const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

  // 정규식으로 처리할 패턴 규칙 (사전보다 먼저 적용)
  const MONTH = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
  const DIRECTION = {
    northern: "북부", southern: "남부", eastern: "동부", western: "서부", central: "중앙",
    north: "북부", south: "남부", east: "동부", west: "서부",
    northeastern: "북동부", northwestern: "북서부", southeastern: "남동부", southwestern: "남서부",
    northeast: "북동부", northwest: "북서부", southeast: "남동부", southwest: "남서부",
    "north-central": "북중부", "south-central": "남중부",
  };
  const PATTERNS = [
    [/(\d+)\s+areas?(?![\p{L}\p{N}_-])/giu, "$1개 구역"],
    // 전리품 페이지: "229 items · 186 with a known rarity", "95 recipes with their costs"
    [/(\d+)\s+items?\s*·\s*(\d+)\s+with a known rarity/gi, "아이템 $1개 · 등급 확인 $2개"],
    [/(\d+)\s+recipes?\s+with their costs/gi, "$1개 레시피와 제작 비용"],
    // "Updated 26 Oct 2026" → "2026년 10월 26일 업데이트됨" (날짜가 바뀌어도 동작)
    [
      /\bUpdated\s+(\d{1,2})\s+(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.?\s+(\d{4})\b/gi,
      (m, d, mon, y) => `${y}년 ${MONTH[mon.toLowerCase()]}월 ${Number(d)}일 업데이트됨`,
    ],
    // "75 of 75" → "75개 중 75개"  (필터 결과 개수)
    [/^(\d+) of (\d+)$/g, "$2개 중 $1개"],
    // "Northern Hajin" → "하진 북부", "Eastern Hajin City" → "하진시 동부"  (공식 한글 표기 방식)
    [
      /\b(North[- ]central|South[- ]central|Northeastern|Northwestern|Southeastern|Southwestern|Northeast|Northwest|Southeast|Southwest|Northern|Southern|Eastern|Western|Central|North|South|East|West)\s+Hajin(\s+City)?\b/gi,
      (m, dir, city) => `${city ? "하진시" : "하진"} ${DIRECTION[dir.toLowerCase().replace(/\s+/g, "-")]}`,
    ],
    // 페이지 제목: "NuriGO Mall (MW4 DMZ location) | DMZ Codex"
    [/\(MW4 DMZ location\)/gi, "(MW4 DMZ 위치)"],
  ];

  // 문자열 앞/뒤에 붙은 화살표(→ 등)를 글자와 분리해서 번역하기 위한 정규식
  // "Radiation Station →" → 본문 "Radiation Station" 만 번역하고 화살표는 그대로 다시 붙임
  const ARROWS = "→←↗↘↖↙↑↓»›▸▶➜➔⟶";
  const ARROW_EDGE = new RegExp(
    "^(\\s*)([" + ARROWS + "]\\s*)?([\\s\\S]*?)(\\s*[" + ARROWS + "])?(\\s*)$"
  );
  // 앞/뒤 화살표가 있으면 {pre, body, post} 로 나눠 돌려주고, 없으면 null
  function splitArrow(str) {
    const m = ARROW_EDGE.exec(str);
    if (!m || (!m[2] && !m[4])) return null;
    if (!/[A-Za-z]/.test(m[3])) return null;
    return { pre: m[1] + (m[2] || ""), body: m[3], post: (m[4] || "") + m[5] };
  }

  function createTranslator(dict, opts) {
    const options = Object.assign({ unofficial: true, maxLen: 100 }, opts || {});

    const exactMap = new Map(); // 전체 일치용 (o, u, x)
    const partMap = new Map(); //  부분 치환용 (o, u)

    for (const [en, ko, grade] of dict) {
      // 한글이 비어 있는 항목('미번역 문구 수집'에서 복사한 줄)은 무시 → 글자가 지워지는 것을 방지
      if (!ko) continue;
      if (grade !== "o" && !options.unofficial) continue;
      const key = normKey(en);
      exactMap.set(key, ko);
      if (grade !== "x") partMap.set(key, ko);
    }

    const keys = [...partMap.keys()].sort((a, b) => b.length - a.length);
    let partRe = null;
    if (keys.length) {
      const alt = keys.map((k) => escapeRe(k).replace(/ /g, "\\s+")).join("|");
      partRe = new RegExp(
        "(?<![\\p{L}\\p{N}_-])(?:" + alt + ")(?![\\p{L}\\p{N}_-])",
        "giu"
      );
    }

    const cache = new Map();

    // 패턴 + 부분 치환 (짧은 문자열용). 바뀐 게 없으면 null
    function partial(core) {
      let res = core.replace(/[‘’]/g, "'");
      let changed = false;

      for (const [re, rep] of PATTERNS) {
        re.lastIndex = 0;
        const next = res.replace(re, rep);
        if (next !== res) {
          changed = true;
          res = next;
        }
      }
      if (partRe) {
        partRe.lastIndex = 0;
        res = res.replace(partRe, (m) => {
          const v = partMap.get(normKey(m));
          if (v === undefined) return m;
          changed = true;
          return v;
        });
      }
      return changed ? res : null;
    }

    // 마침표 뒤 공백 + 대문자/숫자/따옴표로 시작하는 곳에서 문장 분리
    const SENT_SPLIT = /(?<=[.!?])\s+(?=[A-Z0-9“"'‘])/;

    function translateBase(str) {
      if (!str || !/[A-Za-z]/.test(str)) return str;
      const hit = cache.get(str);
      if (hit !== undefined) return hit;

      const lead = str.match(/^\s*/)[0];
      const trail = str.match(/\s*$/)[0];
      const core = str.trim();
      let out = str;

      const exact = exactMap.get(normKey(core));
      if (exact !== undefined) {
        // 1) 문자열 전체가 사전과 일치
        out = lead + exact + trail;
      } else {
        // 2) 여러 문장이면 문장별로 전체 일치를 시도 (설명 문구용)
        const sents = core.split(SENT_SPLIT);
        let sentHit = 0;
        if (sents.length > 1) {
          const parts = sents.map((s) => {
            const v = exactMap.get(normKey(s));
            if (v !== undefined) {
              sentHit++;
              return v;
            }
            // 일치하지 않는 문장도 짧으면 부분 치환은 시도
            const p = s.length <= options.maxLen ? partial(s) : null;
            return p === null ? s : p;
          });
          if (sentHit > 0) out = lead + parts.join(" ") + trail;
        }
        // 3) 그 외: 짧은 문자열만 부분 치환
        if (sentHit === 0 && core.length <= options.maxLen) {
          const p = partial(core);
          if (p !== null) out = lead + p + trail;
        }
      }

      if (cache.size > 5000) cache.clear();
      cache.set(str, out);
      return out;
    }

    // 화살표 분리 래퍼: 먼저 문자열 전체로 번역해 보고("Open map →" 같은 기존 항목 유지),
    // 바뀐 게 없으면 화살표를 떼고 본문만 번역한 뒤 화살표를 다시 붙입니다.
    function translate(str) {
      const out = translateBase(str);
      if (out !== str) return out;
      const sp = splitArrow(str);
      if (!sp) return out;
      const t = translateBase(sp.body);
      return t === sp.body ? out : sp.pre + t + sp.post;
    }

    // 전체 일치(또는 모든 문장이 일치)할 때만 번역. 아니면 null  (링크가 섞인 문장용)
    function exactBase(str) {
      const core = (str || "").trim();
      if (!/[A-Za-z]/.test(core)) return null;
      const e = exactMap.get(normKey(core));
      if (e !== undefined) return e;
      const sents = core.split(SENT_SPLIT);
      if (sents.length < 2) return null;
      const parts = [];
      for (const s of sents) {
        const v = exactMap.get(normKey(s));
        if (v === undefined) return null;
        parts.push(v);
      }
      return parts.join(" ");
    }
    function translateExact(str) {
      const r = exactBase(str);
      if (r !== null) return r;
      const sp = splitArrow(str || "");
      if (!sp) return null;
      const b = exactBase(sp.body);
      return b === null ? null : sp.pre + b + sp.post;
    }
    translate.exact = translateExact;

    return translate;
  }

  const api = { createTranslator, normKey };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.DMZKO_API = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
