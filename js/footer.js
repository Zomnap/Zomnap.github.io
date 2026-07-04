function updateRuntime() {
  const start = new Date("2026-03-09T23:27:31+08:00");
  const now = new Date();
  const diff = Math.max(0, now - start);

  const d = Math.floor(diff / (1000 * 60 * 60 * 24));
  const h = Math.floor(diff / (1000 * 60 * 60)) % 24;
  const m = Math.floor(diff / (1000 * 60)) % 60;
  const s = Math.floor(diff / 1000) % 60;

  const el = document.getElementById("runtime");
  if (el) {
    el.textContent = `本站已运行 ${d} 天 ${h} 小时 ${m} 分 ${s} 秒`;
  }
}
setInterval(updateRuntime, 1000);
updateRuntime();

function attachOffsetCounter(element, baseline) {
  if (!element || !window.MutationObserver) return;

  let applying = false;
  new MutationObserver(() => {
    if (applying) return;

    const rawValue = Number.parseInt(
      element.textContent.replace(/[^\d]/g, ""),
      10
    );
    if (!Number.isFinite(rawValue)) return;

    applying = true;
    element.textContent = String(baseline + rawValue);
    applying = false;
  }).observe(element, {
    childList: true,
    characterData: true,
    subtree: true,
  });
}

function loadVisitorStats() {
  const stats = document.querySelector(".footer-statistics");
  const pagePv = document.getElementById("busuanzi_value_page_pv");

  const currentHost = window.location.hostname.toLowerCase();
  const siteHosts = ((stats && (stats.dataset.siteHosts || stats.dataset.siteHost)) || "")
    .split(",")
    .map((host) => host.trim().toLowerCase())
    .filter(Boolean);
  const shouldLoadSiteStats = stats && siteHosts.includes(currentHost);
  if (!pagePv && !shouldLoadSiteStats) return;

  if (shouldLoadSiteStats) {
    const siteUv = document.getElementById("busuanzi_value_site_uv");
    const sitePv = document.getElementById("busuanzi_value_site_pv");
    const siteUvBase = Number.parseInt(siteUv && siteUv.textContent, 10) || 0;
    const sitePvBase = Number.parseInt(sitePv && sitePv.textContent, 10) || 0;

    attachOffsetCounter(siteUv, siteUvBase);
    attachOffsetCounter(sitePv, sitePvBase);
  }

  const script = document.createElement("script");
  script.src =
    "https://busuanzi.ibruce.info/busuanzi/2.3/busuanzi.pure.mini.js";
  script.defer = true;
  script.referrerPolicy = "no-referrer-when-downgrade";
  document.head.appendChild(script);
}

loadVisitorStats();

const typingTexts = [
  "欢迎来到我的博客！",
  "这里记录了我的学习和生活点滴。",
  "希望你能喜欢这里的内容！",
];

let ti = 0;
let tj = 0;
let deleting = false;

function runTyping() {
  const el = document.getElementById("footer-typing");
  if (!el) return;

  const text = typingTexts[ti];

  if (!deleting) {
    tj++;
  } else {
    tj--;
  }

  el.textContent = text.slice(0, tj);

  let delay = deleting ? 40 : 80;

  if (!deleting && tj === text.length) {
    delay = 1200;
    deleting = true;
  } else if (deleting && tj === 0) {
    deleting = false;
    ti = (ti + 1) % typingTexts.length;
    delay = 300;
  }

  setTimeout(runTyping, delay);
}

runTyping();
