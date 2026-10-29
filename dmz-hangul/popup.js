const DEFAULTS = { enabled: true, hover: true, collect: false };

chrome.storage.sync.get(DEFAULTS, (opt) => {
  for (const key of Object.keys(DEFAULTS)) {
    const el = document.getElementById(key);
    el.checked = !!opt[key];
    el.addEventListener("change", () => {
      chrome.storage.sync.set({ [key]: el.checked });
    });
  }
});

// ── 미번역 문구 수집 목록 ──
const copyBtn = document.getElementById("copy");
let showing = false;

function refresh() {
  chrome.storage.local.get({ missing: [] }, (r) => {
    if (!showing) copyBtn.textContent = "복사(" + r.missing.length + ")";
  });
}
refresh();
chrome.storage.onChanged.addListener((c, area) => {
  if (area === "local" && c.missing) refresh();
});

copyBtn.addEventListener("click", () => {
  chrome.storage.local.get({ missing: [] }, async (r) => {
    // dictionary.js 에 그대로 붙여넣고 두 번째 칸에 한글만 채우면 되는 형태
    const esc = (s) => s.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
    const text = r.missing.map((m) => `  ["${esc(m)}", "", "x"],`).join("\n");
    try {
      await navigator.clipboard.writeText(text);
      copyBtn.textContent = "복사됨!";
    } catch (e) {
      copyBtn.textContent = "복사 실패";
    }
    showing = true;
    setTimeout(() => {
      showing = false;
      refresh();
    }, 1500);
  });
});

document.getElementById("clear").addEventListener("click", () => {
  showing = false;
  chrome.storage.local.set({ missing: [] }, refresh);
});

// ── [보류] 모든 위치 페이지 수집 ──
// 나중에 다시 쓰려면 아래 주석(//)을 풀고, popup.html 의 crawl 버튼 주석과 content.js 의 crawl 주석도 함께 푸세요.
// const crawlBtn = document.getElementById("crawl");
// const crawlSt = document.getElementById("crawlst");
// function showCrawl(s) {
//   if (!s) return;
//   if (s.running) crawlSt.textContent = "수집 중… " + s.done + " / " + s.total;
//   else crawlSt.textContent = "완료: 페이지 " + s.ok + "개 읽음, 실패 " + s.fail + "개, 새 문구 " + (s.added || 0) + "개. 위의 '복사'를 누르세요.";
// }
// chrome.storage.local.get({ crawlStatus: null }, (r) => showCrawl(r.crawlStatus));
// chrome.storage.onChanged.addListener((c, area) => {
//   if (area === "local" && c.crawlStatus) showCrawl(c.crawlStatus.newValue);
// });
// crawlBtn.addEventListener("click", () => {
//   chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
//     const tab = tabs[0];
//     if (!tab) return;
//     chrome.tabs.sendMessage(tab.id, { type: "crawl-locations" }, (res) => {
//       if (chrome.runtime.lastError || !res) crawlSt.textContent = "dmzcodex.com 페이지를 연 상태에서(한글로 보기 켬) 눌러 주세요.";
//     });
//   });
// });
