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

function loadVisitorStats() {
  const stats = document.querySelector(".footer-statistics");
  if (!stats) return;

  const uvContainer = document.getElementById("busuanzi_container_site_uv");
  const pvContainer = document.getElementById("busuanzi_container_site_pv");
  const uvValue = document.getElementById("busuanzi_value_site_uv");
  const pvValue = document.getElementById("busuanzi_value_site_pv");
  const currentHost = window.location.hostname.toLowerCase();
  const siteHost = stats.dataset.siteHost.toLowerCase();

  function showStatsLine() {
    if (uvContainer) uvContainer.style.display = "inline";
    if (pvContainer) pvContainer.style.display = "inline";
  }

  if (currentHost !== siteHost) {
    if (uvValue) uvValue.textContent = uvValue.textContent.trim() || "711";
    if (pvValue) pvValue.textContent = pvValue.textContent.trim() || "1503";
    showStatsLine();
    return;
  }

  const script = document.createElement("script");
  script.src =
    "https://busuanzi.ibruce.info/busuanzi/2.3/busuanzi.pure.mini.js";
  script.defer = true;
  script.referrerPolicy = "no-referrer-when-downgrade";
  document.head.appendChild(script);

  let attempts = 0;
  const timer = setInterval(() => {
    attempts++;

    if (
      uvValue &&
      pvValue &&
      uvValue.textContent.trim() &&
      pvValue.textContent.trim()
    ) {
      showStatsLine();
      clearInterval(timer);
      return;
    }

    if (attempts >= 20) {
      showStatsLine();
      if (uvValue && !uvValue.textContent.trim()) uvValue.textContent = "711";
      if (pvValue && !pvValue.textContent.trim()) pvValue.textContent = "1503";
      clearInterval(timer);
    }
  }, 500);
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
