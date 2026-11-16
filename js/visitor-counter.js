/**
 * 博客浏览量统计（文章阅读量 + 站点总 PV/UV）
 *
 * 设计要点：
 * 1. 计数 key 只由「路径」决定，不含域名 —— 所以 zomnap.top、zomnap.github.io、
 *    本地 localhost 看到的都是同一份总数据，不会再出现「每个域名各算一套」。
 * 2. 本地预览（localhost / 127.0.0.1 / file://）只读取不写入，方便调试又不污染真实数据。
 * 3. 网络失败或服务不可用时不显示假的 0，而是显示 “—”，避免误导。
 * 4. 配置来自 _config.yml 的 visitor_counter，由 scripts/injector.js 注入 window.BLOG_COUNTER。
 */
(function () {
  'use strict';

  var cfg = window.BLOG_COUNTER || {};
  var API = String(cfg.api || 'https://abacus.jasoncameron.dev').replace(/\/+$/, '');
  var NS = String(cfg.namespace || 'zomnap-blog').replace(/[^a-zA-Z0-9_-]/g, '-') || 'zomnap-blog';

  var SITE_PV_KEY = 'site-pv';
  var SITE_UV_KEY = 'site-uv';
  var VISITOR_STORAGE_KEY = 'zomnap-blog:visitor';

  var pageOffset = Number(cfg.page_pv_offset) || 0;
  var sitePvOffset = Number(cfg.site_pv_offset) || 0;
  var siteUvOffset = Number(cfg.site_uv_offset) || 0;

  // 单篇文章的起始偏移（把历史阅读量接过来），key 做同样的大小写/斜杠归一化，
  // 这样配置文件里写 "/2026/04/05/xss/" 或 "/2026/04/05/XSS" 都能命中
  function buildOffsetMap(map) {
    var result = {};
    if (!map || typeof map !== 'object') return result;
    for (var raw in map) {
      if (!Object.prototype.hasOwnProperty.call(map, raw)) continue;
      var value = Number(map[raw]);
      if (!isFinite(value) || value === 0) continue;
      result[normalizePath(raw)] = value;
    }
    return result;
  }

  var pageOffsets = buildOffsetMap(cfg.page_offsets);

  if (typeof window.fetch !== 'function') return;

  /* ---------------- 路径 → 计数 key ---------------- */

  // 32 位 FNV-1a，用位移实现避免浮点精度丢失
  function fnv1a(str) {
    var h = 0x811c9dc5;
    for (var i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = (h + (h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24)) >>> 0;
    }
    return h.toString(36);
  }

  // 归一化路径：统一大小写、补尾斜杠、去掉 index.html，保证同一篇文章只有一个 key
  function normalizePath(pathname) {
    var path = pathname || '/';
    try {
      path = decodeURI(path);
    } catch (e) {
      /* 保留原始值 */
    }
    path = path.replace(/\/{2,}/g, '/');
    if (path.charAt(0) !== '/') path = '/' + path;
    path = path.replace(/\/index\.html?$/i, '/');
    if (path !== '/' && !/\.[a-z0-9]+$/i.test(path) && path.slice(-1) !== '/') {
      path += '/';
    }
    return path.toLowerCase();
  }

  // key 只允许 [a-z0-9-]，中文等路径靠 hash 区分
  function pageKey(pathname) {
    var path = normalizePath(pathname);
    var slug = path
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40);
    return 'page' + (slug ? '-' + slug : '') + '-' + fnv1a(path);
  }

  /* ---------------- 请求封装 ---------------- */

  function keyUrl(action, key) {
    return API + '/' + action + '/' + encodeURIComponent(NS) + '/' + encodeURIComponent(key);
  }

  // retries：失败重试次数（免费服务偶发 5xx/网络抖动，重试一次即可）
  function apiRequest(url, retries) {
    if (typeof retries !== 'number') retries = 1;
    return fetch(url, { cache: 'no-store', credentials: 'omit' })
      .then(function (res) {
        if (res.status === 404) return { value: 0 }; // key 还不存在，视为 0
        if (!res.ok) throw new Error('HTTP ' + res.status);
        return res.json();
      })
      .then(function (data) {
        var value = Number(data && data.value);
        if (!isFinite(value)) throw new Error('invalid payload');
        return value;
      })
      .catch(function (err) {
        if (retries <= 0) throw err;
        return new Promise(function (resolve) {
          setTimeout(resolve, 700);
        }).then(function () {
          return apiRequest(url, retries - 1);
        });
      });
  }

  /* ---------------- 渲染 ---------------- */

  function formatNumber(value) {
    var n = Math.max(0, Math.round(Number(value) || 0));
    return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  }

  function apply(selector, value) {
    var els = document.querySelectorAll(selector);
    for (var i = 0; i < els.length; i++) {
      els[i].textContent = value;
    }
  }

  function fail(selector) {
    apply(selector, '—');
  }

  /* ---------------- 计数逻辑 ---------------- */

  var host = (location.hostname || '').toLowerCase();
  var isLocal =
    location.protocol === 'file:' ||
    host === '' ||
    host === 'localhost' ||
    host === '127.0.0.1' ||
    host === '0.0.0.0' ||
    host === '::1' ||
    host === '[::1]';

  // 本地只读，线上才 +1
  function track(key) {
    return apiRequest(keyUrl(isLocal ? 'get' : 'hit', key));
  }

  // UV：同一个浏览器只计一次（localStorage 标记）
  function trackUnique(key) {
    var seen = false;
    try {
      seen = !!localStorage.getItem(VISITOR_STORAGE_KEY);
    } catch (e) {
      /* 隐私模式下不可用，按未访问处理 */
    }
    if (seen || isLocal) return apiRequest(keyUrl('get', key));
    return apiRequest(keyUrl('hit', key)).then(function (value) {
      try {
        localStorage.setItem(VISITOR_STORAGE_KEY, '1');
      } catch (e) {
        /* 忽略 */
      }
      return value;
    });
  }

  function init() {
    var path = normalizePath(location.pathname);

    // 文章自身的阅读量
    if (document.querySelector('[data-page-views]')) {
      var extra = 0;
      var custom = pageOffsets[path] || pageOffsets[path.replace(/\/$/, '')];
      if (isFinite(Number(custom))) extra = Number(custom);
      track(pageKey(path))
        .then(function (value) {
          apply('[data-page-views]', formatNumber(value + pageOffset + extra));
        })
        .catch(function () {
          fail('[data-page-views]');
          if (window.console) console.warn('[visitor-counter] 文章阅读量获取失败');
        });
    }

    // 站点总访问量
    if (document.querySelector('[data-site-pv]')) {
      track(SITE_PV_KEY)
        .then(function (value) {
          apply('[data-site-pv]', formatNumber(value + sitePvOffset));
        })
        .catch(function () {
          fail('[data-site-pv]');
        });
    }

    // 站点总访客数
    if (document.querySelector('[data-site-uv]')) {
      trackUnique(SITE_UV_KEY)
        .then(function (value) {
          apply('[data-site-uv]', formatNumber(value + siteUvOffset));
        })
        .catch(function () {
          fail('[data-site-uv]');
        });
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
