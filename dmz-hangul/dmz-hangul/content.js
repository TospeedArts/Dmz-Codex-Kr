/*
 * dmzcodex.com 한글화 콘텐츠 스크립트 (지도·위치·전리품 등)
 * - 텍스트 노드 + title / aria-label / alt / placeholder 속성을 번역
 * - 지도는 JS로 계속 다시 그려지므로 MutationObserver로 변경분만 처리
 */
(function () {
  "use strict";

  const DEFAULTS = { enabled: true, hover: true, collect: false };
  const ATTRS = ["title", "aria-label", "alt", "placeholder"];
  const SKIP = new Set(["SCRIPT", "STYLE", "NOSCRIPT", "TEXTAREA", "INPUT", "CODE", "PRE"]);

  chrome.storage.sync.get(DEFAULTS, (opt) => {
    // 한글 검색 브리지(search-bridge.js)가 읽는 스위치
    document.documentElement.dataset.dmzkoSearch = opt.enabled ? "1" : "0";
    if (!opt.enabled) return;
    start(opt);
  });

  // 설정이 바뀌면 원문 복원을 위해 새로고침
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "sync") location.reload();
  });

  function start(opt) {
    const translate = DMZKO_API.createTranslator(DMZKO_DICT, {
      unofficial: true, // 비공식 번역도 항상 적용
    });

    // 번역해서 노드에 쓴 마지막 값 (자기 자신이 일으킨 변경 무시용)
    const lastText = new WeakMap();

    // ── 미번역 문구 수집 (팝업의 '미번역 문구 수집'을 켰을 때만) ──
    // 한글 번역에 이미 영문 그대로 들어 있는 낱말(Activision, Safari 같은 고유명사)은 '남은 영문'으로 보지 않는다.
    const keptLatin = new Set();
    for (const row of DMZKO_DICT) for (const w of row[1].match(/[A-Za-z]{4,}/g) || []) keptLatin.add(w.toLowerCase());
    const hasEnglishLeft = (t) => (t.match(/[A-Za-z]{4,}/g) || []).some((w) => !keptLatin.has(w.toLowerCase()));
    // 부모에 글자가 든 다른 요소(링크 등)가 섞여 있으면, 이 텍스트는 문장의 일부 조각이다.
    // 조각은 번역이 안 돼도 정상이므로 수집하지 않고, 문장 전체({1} 형태)만 수집한다.
    const isFragment = (n) => {
      const p = n.parentElement;
      if (!p) return false;
      for (const ch of p.children) if (/\S/.test(ch.textContent) && !SKIP.has(ch.tagName.toUpperCase())) return true;
      return false;
    };
    const missing = new Set();
    let missingTimer = null;
    function noteMissing(str) {
      if (!opt.collect) return;
      const s = str.replace(/\s+/g, " ").trim();
      if (s.length < 4 || s.length > 600 || !/[A-Za-z]{3,}/.test(s)) return;
      if (/^[A-J][0-9](\s|$)/.test(s) && s.length < 8) return; // 그리드 좌표
      if (missing.has(s)) return;
      missing.add(s);
      if (missingTimer === null) {
        missingTimer = setTimeout(() => {
          missingTimer = null;
          chrome.storage.local.get({ missing: [] }, (r) => {
            const all = new Set(r.missing);
            for (const m of missing) all.add(m);
            missing.clear();
            chrome.storage.local.set({ missing: [...all].slice(-2000) });
          });
        }, 1500);
      }
    }


    // [보류] 위치 페이지 전체 수집 — 나중에 다시 쓰려면 아래 줄 맨 앞의 '// ' 를 모두 지우세요.
    // (popup.html 의 crawl 버튼, popup.js 의 [보류] 주석도 함께 푸세요.)
    // // ── 위치 페이지 전체 수집 (팝업의 '모든 위치 페이지 수집') ──
    // // 같은 사이트의 /locations/ 하위 페이지를 직접 읽어 번역이 안 되는 문장을 모읍니다.
    // // 링크가 섞인 문장은 {1}, {2} 형태로 모입니다.
    // const LOC_SLUGS = ["14th-political-prison","admin-complex-no-2","air-base-bunker","air-base-exterior","chang-san-air-base","cheongun-outskirts","cheongun-village","cheonwang-peak-array","compound-alpha","compound-bravo","compound-charlie","compound-delta","compound-echo","compound-foxtrot","construction-zone","daesong-ridge","dbn-headquarters","deadtown","deadtown-exterior","donpyeong-gate","farmland-exterior","field-depot","fire-station-storage","hajin-river","hajin-river-heights","han-go-korean-bbq","haneul-nuclear-reactor","hanex-bank","hanrim-village","heavenly-luck-casino","imjin-farmland","imjin-suburb","jayon-warehouses","mirae-general-hospital","mujin-pass","namjin-riverside","nurigo-east","nurigo-mall","nurigo-west","oamsik-turtle-island","old-barber-shop","police-station-armory","prison","pyonghwa-village","re-education-center","reactor","revolution-dam","rice-mill","russian-border-crossing","russian-border-crossing-east","russian-border-crossing-west","shoreline-station","silo-control-room","songdo-pier","songdo-wharf","south-island","south-korean-border-zone","the-citadel","the-fortress-prison-yard","the-grid","theatre","tong-il-village","wolves-stadium","baseball-stadium-b-station","city-hall","expressway-no-1","ginyeom-il-bridge","hotel-lucera","jeong-loading-dock","jinseo-park-towers","la-grande-vie","minsok-art-school","nenshin-tech-complex","russian-border","year-of-the-fire-horse-statue"];
    //
    // function extractMissing(doc) {
    //   const found = [];
    //   const els = doc.body ? doc.body.querySelectorAll("*") : [];
    //   for (const el of els) {
    //     if (SKIP.has(el.tagName.toUpperCase()) || el.closest("script,style,noscript,textarea,code,pre")) continue;
    //     let tpl = "";
    //     let n = 0;
    //     let letters = false;
    //     for (const c of el.childNodes) {
    //       if (c.nodeType === 3) {
    //         tpl += c.nodeValue;
    //         if (/[A-Za-z]/.test(c.nodeValue)) letters = true;
    //       } else if (c.nodeType === 1 && /\S/.test(c.textContent) && !SKIP.has(c.tagName.toUpperCase())) {
    //         tpl += "{" + ++n + "}";
    //       }
    //     }
    //     if (!letters) continue;
    //     tpl = tpl.replace(/\s+/g, " ").trim();
    //     if (tpl.length < 4 || tpl.length > 600 || !/[A-Za-z]{3,}/.test(tpl)) continue;
    //     if (/^[A-J][0-9](\s|$)/.test(tpl) && tpl.length < 8) continue;
    //     if (translate.exact(tpl) !== null) continue;
    //     found.push(tpl);
    //   }
    //   return found;
    // }
    //
    // let crawling = false;
    // async function crawlLocations() {
    //   if (crawling) return;
    //   crawling = true;
    //   const urls = new Set(LOC_SLUGS.map((s) => location.origin + "/locations/" + s + "/"));
    //   urls.add(location.origin + "/locations/");
    //   document.querySelectorAll('a[href*="/locations/"]').forEach((a) => {
    //     try {
    //       const u = new URL(a.href, location.href);
    //       if (u.origin === location.origin && /^\/locations\/[^/]+\/?$/.test(u.pathname)) urls.add(u.origin + u.pathname.replace(/\/?$/, "/"));
    //     } catch (e) {}
    //   });
    //   const list = [...urls];
    //   const result = new Set();
    //   let ok = 0;
    //   let fail = 0;
    //   for (let i = 0; i < list.length; i++) {
    //     try {
    //       const res = await fetch(list[i], { credentials: "same-origin" });
    //       if (!res.ok) throw new Error(res.status);
    //       const doc = new DOMParser().parseFromString(await res.text(), "text/html");
    //       for (const m of extractMissing(doc)) result.add(m);
    //       ok++;
    //     } catch (e) {
    //       fail++;
    //     }
    //     chrome.storage.local.set({ crawlStatus: { done: i + 1, total: list.length, ok, fail, running: true } });
    //     await new Promise((r) => setTimeout(r, 250));
    //   }
    //   chrome.storage.local.get({ missing: [] }, (r) => {
    //     const all = new Set(r.missing);
    //     for (const m of result) all.add(m);
    //     chrome.storage.local.set({
    //       missing: [...all].slice(-5000),
    //       crawlStatus: { done: list.length, total: list.length, ok, fail, running: false, added: result.size },
    //     });
    //     crawling = false;
    //   });
    // }
    //
    // chrome.runtime.onMessage.addListener((msg, sender, reply) => {
    //   if (msg && msg.type === "crawl-locations") {
    //     crawlLocations();
    //     reply({ started: true });
    //   }
    // });
    //
    //

    function markParent(parent) {
      if (parent && parent.classList) parent.classList.add("dmzko-t");
    }

    // ── 링크·강조 등이 섞인 문장 처리 ──
    // 문장이 <a> 등으로 쪼개져 있으면 조각마다는 번역이 안 되므로,
    // 링크 자리를 {1}, {2} 로 바꾼 문장 전체를 사전에서 찾아 조각별로 다시 채웁니다.
    const orig = new WeakMap(); // 텍스트 노드의 원문
    const applied = new WeakMap(); // 요소 → 마지막으로 적용한 상태
    const pending = new Set();
    const origOf = (n) => (lastText.get(n) === n.nodeValue && orig.has(n) ? orig.get(n) : n.nodeValue);

    // 링크 순서가 한글에서 바뀌는 문장: 링크(+아이콘)를 옮겨 새로 배치
    function reorderBlock(el, ko, units) {
      const textNodes = [...el.childNodes].filter((c) => c.nodeType === Node.TEXT_NODE);
      const members = new Set([...textNodes, ...units.flat()]);
      let ref = null;
      for (const c of el.childNodes) {
        if (members.has(c)) {
          ref = c;
          break;
        }
      }
      const marker = document.createTextNode("");
      orig.set(marker, "");
      lastText.set(marker, "");
      el.insertBefore(marker, ref);
      for (const t of textNodes) {
        orig.set(t, "");
        lastText.set(t, "");
        t.nodeValue = "";
      }
      const frag = document.createDocumentFragment();
      for (const tok of ko.split(/(\{\d+\})/)) {
        const m = /^\{(\d+)\}$/.exec(tok);
        if (m) {
          for (const node of units[+m[1] - 1]) frag.appendChild(node);
        } else if (tok) {
          const t = document.createTextNode(tok);
          orig.set(t, "");
          lastText.set(t, tok);
          frag.appendChild(t);
        }
      }
      el.insertBefore(frag, marker);
      markParent(el);
      let s2 = "";
      for (const c of el.childNodes) if (c.nodeType === Node.TEXT_NODE) s2 += c.nodeValue + "\u0001";
      applied.set(el, s2);
    }

    function blockPass(el) {
      if (!el || el.nodeType !== Node.ELEMENT_NODE || !el.isConnected) return;
      if (SKIP.has(el.tagName.toUpperCase())) return;
      const anchors = [];
      const units = []; // 링크 + 그 앞의 아이콘 같은 빈 요소 묶음 (순서를 바꿀 때 함께 이동)
      let lead = [];
      const gaps = [[]];
      let tpl = "";
      let hasText = false;
      let sig = "";
      for (const c of el.childNodes) {
        if (c.nodeType === Node.TEXT_NODE) {
          gaps[gaps.length - 1].push(c);
          const o = origOf(c);
          tpl += o;
          sig += c.nodeValue + "\u0001";
          if (/[A-Za-z]/.test(o)) hasText = true;
        } else if (c.nodeType === Node.ELEMENT_NODE) {
          if (SKIP.has(c.tagName.toUpperCase())) return;
          if (/\S/.test(c.textContent)) {
            anchors.push(c);
            units.push(lead.concat(c));
            lead = [];
            tpl += "{" + anchors.length + "}";
            gaps.push([]);
          } else {
            lead.push(c);
          }
        }
      }
      if (!hasText || !anchors.length) return;
      if (applied.get(el) === sig) return;

      const ko = translate.exact(tpl);
      if (ko === null) {
        noteMissing(tpl.replace(/\s+/g, " ").trim());
        return;
      }
      // 한글에서는 {1}, {2} 순서가 영문과 달라질 수 있음 (예: "{2}의, {1}의 …")
      const order = (ko.match(/\{\d+\}/g) || []).map((x) => +x.slice(1, -1));
      const n = anchors.length;
      if (order.length !== n || new Set(order).size !== n || !order.every((i) => i >= 1 && i <= n)) return;
      if (!order.every((v, i) => v === i + 1)) {
        reorderBlock(el, ko, units);
        return;
      }
      const segs = ko.split(/\{\d+\}/);
      for (let k = 0; k < gaps.length; k++) {
        const nodes = gaps[k];
        const seg = segs[k];
        if (!nodes.length) {
          if (!seg) continue;
          const t = document.createTextNode(seg);
          el.insertBefore(t, k < anchors.length ? anchors[k] : null);
          orig.set(t, "");
          lastText.set(t, seg);
          continue;
        }
        // 앵커 바로 앞 조각에는 마지막 노드에 써서 아이콘 이미지가 링크 옆에 남게 함
        const target = k < anchors.length ? nodes[nodes.length - 1] : nodes[0];
        for (const n of nodes) {
          orig.set(n, origOf(n));
          const v = n === target ? seg : "";
          lastText.set(n, v);
          n.nodeValue = v;
        }
      }
      markParent(el);
      let s2 = "";
      for (const c of el.childNodes) if (c.nodeType === Node.TEXT_NODE) s2 += c.nodeValue + "\u0001";
      applied.set(el, s2);
    }

    function runBlocks() {
      const list = [...pending];
      pending.clear();
      for (const el of list) blockPass(el);
    }

    function doText(node) {
      const val = node.nodeValue;
      if (!val || lastText.get(node) === val) return;
      if (node.parentElement && SKIP.has(node.parentElement.tagName.toUpperCase())) return;
      orig.set(node, val);
      if (node.parentElement) pending.add(node.parentElement);
      const out = translate(val);
      if (out === val) {
        // 사전에 '그대로'로 등록된 항목(예: dmzcodex.com)과 문장 조각은 미번역이 아님
        if (translate.exact(val) === null && !isFragment(node)) noteMissing(val);
        return;
      }
      // 일부만 번역되고 영문이 남은 경우도 수집
      if (hasEnglishLeft(out) && !isFragment(node)) noteMissing(val);
      lastText.set(node, out);
      node.nodeValue = out;
      markParent(node.parentElement);
    }

    function doAttrs(el) {
      if (!el.getAttribute) return;
      for (const a of ATTRS) {
        const v = el.getAttribute(a);
        if (!v) continue;
        const out = translate(v);
        if (out !== v) el.setAttribute(a, out);
      }
    }

    function walk(root) {
      if (root.nodeType === Node.TEXT_NODE) {
        doText(root);
        return;
      }
      if (root.nodeType !== Node.ELEMENT_NODE && root.nodeType !== Node.DOCUMENT_NODE) return;

      const first = root.nodeType === Node.ELEMENT_NODE ? root : root.documentElement;
      if (!first) return;
      doAttrs(first);
      if (SKIP.has(first.tagName.toUpperCase())) return;

      const tw = document.createTreeWalker(
        first,
        NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT,
        {
          acceptNode(n) {
            if (n.nodeType === Node.ELEMENT_NODE) {
              doAttrs(n); // INPUT 의 placeholder 등도 여기서 처리
              if (SKIP.has(n.tagName.toUpperCase())) return NodeFilter.FILTER_REJECT;
              return NodeFilter.FILTER_SKIP;
            }
            return NodeFilter.FILTER_ACCEPT;
          },
        }
      );
      let n;
      while ((n = tw.nextNode())) doText(n);
      runBlocks();
    }

    // 변경 감시 (짧게 모아서 한 번에 처리)
    const nodes = new Set();
    const attrEls = new Set();
    let timer = null;

    function flush() {
      timer = null;
      const batchNodes = [...nodes];
      const batchAttrs = [...attrEls];
      nodes.clear();
      attrEls.clear();
      for (const n of batchNodes) if (n.isConnected) walk(n);
      for (const e of batchAttrs) if (e.isConnected) doAttrs(e);
    }
    function queue() {
      if (timer === null) timer = setTimeout(flush, 40);
    }

    const mo = new MutationObserver((muts) => {
      for (const m of muts) {
        if (m.type === "childList") {
          m.addedNodes.forEach((n) => nodes.add(n));
        } else if (m.type === "characterData") {
          nodes.add(m.target);
        } else if (m.type === "attributes") {
          attrEls.add(m.target);
        }
      }
      queue();
    });

    // ── 지도 아이콘 마우스 오버 이름 표시 (팝업의 '지도 아이콘 이름 표시') ──
    // 사이트의 지도 아이콘은 images/services/<종류>--map-icon.(png|svg), images/location-icons/*.webp,
    // images/operations/*--game-icon.png 이미지입니다. 아이콘에 마우스를 올리면 한글 이름을 말풍선으로 보여줍니다.
    // 이름은 ① 아이콘의 aria-label/title/alt → ② 아이콘 옆에 붙은 글자(예: "주유소 · D2") → ③ 이미지 파일명(종류) 순으로 찾습니다.
    function setupHover() {
      const ICON = 'img[src*="--map-icon"], img[src*="/location-icons/"], img[src*="--game-icon"]';
      const tip = document.createElement("code"); // CODE 태그: 번역 대상에서 제외됨
      tip.setAttribute("aria-hidden", "true");
      tip.style.cssText =
        "position:fixed;left:0;top:0;z-index:2147483647;max-width:320px;padding:4px 8px;background:#0b0c0d;color:#fff;" +
        "border:1px solid #fff;border-radius:4px;font:12px/1.4 system-ui,'Malgun Gothic',sans-serif;pointer-events:none;" +
        "display:none;white-space:normal;word-break:keep-all;letter-spacing:normal";
      document.body.appendChild(tip);

      // el 안(또는 el 자신)에 아이콘 이미지가 '딱 하나'면 el 은 마커 하나
      const iconOf = (el) => {
        if (el.tagName === "IMG") return el.matches(ICON) ? el : null;
        const imgs = el.querySelectorAll(ICON);
        return imgs.length === 1 ? imgs[0] : null;
      };
      // 마우스가 실제로 마커 위에 있는지 (큰 레이어가 아이콘 하나만 품고 있는 경우 걸러냄)
      const overMarker = (el, x, y) => {
        const r = el.getBoundingClientRect();
        return r.width <= 360 && r.height <= 160 && x >= r.left - 4 && x <= r.right + 4 && y >= r.top - 4 && y <= r.bottom + 4;
      };
      function findMarker(target, x, y) {
        let el = target instanceof Element ? target : target && target.parentElement;
        let best = null;
        // 아이콘에서 위로 올라가며, 같은 아이콘 하나만 품은 가장 큰 '작은 상자'를 마커로 삼는다 (아이콘 + 옆 글자 + 링크 감싸개)
        for (let i = 0; el && el !== document.body && i < 7; i++, el = el.parentElement) {
          if (el.closest("li, nav, header, footer, code")) return null; // 왼쪽 목록·메뉴의 아이콘은 제외
          const img = iconOf(el);
          if (img && overMarker(el, x, y) && (!best || img === best.img)) best = { el, img };
          else if (best) break;
          else if (img) return null; // 아이콘은 있으나 너무 큰 레이어
        }
        return best;
      }

      const humanize = (src) => {
        const m = /\/([a-z0-9-]+?)(?:--map-icon|--game-icon)?\.(?:png|svg|webp)(?:\?|$)/i.exec(src || "");
        if (!m) return "";
        return m[1].replace(/-/g, " ").replace(/\b[a-z]/g, (ch) => ch.toUpperCase());
      };
      function nameOf(m) {
        for (let e = m.img, i = 0; e && i < 5; e = e.parentElement, i++) {
          const t = (e.getAttribute("aria-label") || e.getAttribute("title") || (e.tagName === "IMG" ? e.getAttribute("alt") : "") || "").trim();
          if (t) return t;
          if (e === m.el) break;
        }
        const own = m.el.textContent.replace(/\s+/g, " ").trim();
        if (own && own.length <= 80) return own;
        return humanize(m.img.getAttribute("src"));
      }

      let cur = null;
      // 마우스를 따라다니지 않고, 해당 아이콘(마커) 오른쪽에 붙여서 보여준다. 오른쪽에 자리가 없으면 왼쪽.
      const place = () => {
        if (!cur) return;
        tip.style.left = "0px";
        tip.style.top = "0px";
        const r = cur.el.getBoundingClientRect();
        const w = tip.offsetWidth;
        const h = tip.offsetHeight;
        let x = r.right + 6;
        if (x + w > innerWidth - 4) x = Math.max(4, r.left - w - 6);
        const y = Math.max(4, Math.min(r.top + (r.height - h) / 2, innerHeight - h - 4));
        tip.style.left = Math.round(x) + "px";
        tip.style.top = Math.round(y) + "px";
      };
      const hide = () => {
        cur = null;
        tip.style.display = "none";
      };
      function update(e) {
        const m = findMarker(e.target, e.clientX, e.clientY);
        if (!m) {
          if (cur) hide();
          return;
        }
        if (cur && cur.el === m.el) return;
        const raw = nameOf(m);
        if (!raw) return hide();
        cur = m;
        tip.textContent = translate(raw);
        tip.style.display = "block";
        place();
      }

      document.addEventListener("mouseover", update, true);
      // 확대/축소·드래그로 숨겨진 뒤에도, 마우스가 아이콘 위에 있으면 다시 보여줌 (큰 영역 검사는 피하려고 아이콘 근처만)
      document.addEventListener(
        "mousemove",
        (e) => {
          if (cur) return;
          const t = e.target;
          if (t instanceof Element && (t.matches(ICON) || (t.children.length <= 3 && t.querySelector(ICON)))) update(e);
        },
        true
      );
      document.addEventListener(
        "mouseout",
        (e) => {
          if (cur && !(e.relatedTarget && cur.el.contains(e.relatedTarget))) hide();
        },
        true
      );
      // 지도를 끌거나 확대/축소할 때는 말풍선을 숨김
      for (const ev of ["mousedown", "wheel", "scroll", "touchstart"]) document.addEventListener(ev, hide, true);
    }

    if (opt.hover && document.body) setupHover();

    walk(document); // 최초 1회 전체 처리
    mo.observe(document.documentElement, {
      childList: true,
      subtree: true,
      characterData: true,
      attributes: true,
      attributeFilter: ATTRS,
    });
  }
})();
