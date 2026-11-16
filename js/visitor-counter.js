/**
 * 博客浏览量统计（文章阅读量 + 站点总 PV/UV）
 *
 * 设计要点：
 * 1. 计数 key 只由「路径」决定，不含域名 —— 所以 zomnap.top、zomnap.github.io、
 *    本地 localhost 看到的都是同一份总数据，不会再出现「每个域名各算一套」。
 * 2. 本地预览（localhost / 127.0.0.1 / file://）只读取不写入，方便调试又不污染真实数据。
 * 3. 速度：HTML 里已由构建脚本渲染好历史基线（见 scripts/pageviews.js），
 *    再加上 localStorage 缓存上次真实值，数字「立刻就有」，接口返回后静默替换；
 *    接口慢（国内访问 2~8 秒）或失败都不会让页面上出现空值或假 0。
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
  var CACHE_STORAGE_KEY = 'zomnap-blog:cache';
  var REQUEST_TIMEOUT = 8000;

  var pageOffset = Number(cfg.page_pv_offset) || 0;
  var sitePvOffset = Number(cfg.site_pv_offset) || 0;
  var siteUvOffset = Number(cfg.site_uv_offset) || 0;

  // 单篇文章的起始偏移（把历史阅读量接过来），key 做大小写/斜杠归一化，
  // 配置里写 "/2026/04/05/xss/" 或 "/2026/04/05/XSS" 都能命中
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

  // 带超时的请求：超时直接放弃（页面上已经有基线/缓存数字，不会开天窗）
  function apiFetch(url) {
    var controller = typeof AbortController === 'function' ? new AbortController() : null;
    var options = { cache: 'no-store', credentials: 'omit' };
    if (controller) options.signal = controller.signal;

    var raw = fetch(url, options)
      .then(function (res) {
        if (res.status === 404) return { value: 0 }; // key 还不存在，视为 0
        if (!res.ok) throw new Error('HTTP ' + res.status);
        return res.json();
      })
      .then(function (data) {
        var value = Number(data && data.value);
        if (!isFinite(value)) throw new Error('invalid payload');
        return value;
      });

    if (!controller) return raw;

    return new Promise(function (resolve, reject) {
      var timer = setTimeout(function () {
        controller.abort();
        reject(new Error('timeout'));
      }, REQUEST_TIMEOUT);

      raw.then(
        function (value) {
          clearTimeout(timer);
          resolve(value);
        },
        function (err) {
          clearTimeout(timer);
          reject(err);
        }
      );
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
      if (els[i].textContent !== value) els[i].textContent = value;
    }
  }

  /* ---------------- 本地缓存（上次拿到的真实值） ---------------- */

  function readCache() {
    try {
      return JSON.parse(localStorage.getItem(CACHE_STORAGE_KEY) || '{}') || {};
    } catch (e) {
      return {};
    }
  }

  function writeCache(map) {
    try {
      localStorage.setItem(CACHE_STORAGE_KEY, JSON.stringify(map));
    } catch (e) {
      /* 隐私模式或超额，忽略 */
    }
  }

  function cachedValue(map, key) {
    var item = map[key];
    if (!item) return null;
    var value = Number(item.v);
    return isFinite(value) ? value : null;
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
    return apiFetch(keyUrl(isLocal ? 'get' : 'hit', key));
  }

  // UV：同一个浏览器只计一次（localStorage 标记）
  function trackUnique(key) {
    var seen = false;
    try {
      seen = !!localStorage.getItem(VISITOR_STORAGE_KEY);
    } catch (e) {
      /* 隐私模式下不可用，按未访问处理 */
    }
    if (seen || isLocal) return apiFetch(keyUrl('get', key));
    return apiFetch(keyUrl('hit', key)).then(function (value) {
      try {
        localStorage.setItem(VISITOR_STORAGE_KEY, '1');
      } catch (e) {
        /* 忽略 */
      }
      return value;
    });
  }

  /**
   * 「先显示、后校正」：页面上已有构建期渲染的基线，
   * 这里拿不到新值就保持原样，绝不把已显示的数字改回占位符。
   */
  function runCounter(opts, cache) {
    if (!document.querySelector(opts.selector)) return;

    var cached = cachedValue(cache, opts.cacheKey);
    if (cached !== null && cached > 0) {
      apply(opts.selector, formatNumber(cached));
    }

    var request = opts.unique ? trackUnique(opts.key) : track(opts.key);
    request
      .then(function (value) {
        var display = value + opts.offset;
        apply(opts.selector, formatNumber(display));
        cache[opts.cacheKey] = { v: display, t: Date.now() };
        writeCache(cache);
      })
      .catch(function () {
        /* 保留基线/缓存值 */
      });
  }

  function init() {
    var path = normalizePath(location.pathname);
    var cache = readCache();
    var pageExtra = pageOffsets[path] || 0;

    runCounter(
      {
        selector: '[data-page-views]',
        cacheKey: 'page:' + pageKey(path),
        key: pageKey(path),
        offset: pageOffset + pageExtra,
      },
      cache
    );

    runCounter(
      {
        selector: '[data-site-pv]',
        cacheKey: 'site:pv',
        key: SITE_PV_KEY,
        offset: sitePvOffset,
      },
      cache
    );

    runCounter(
      {
        selector: '[data-site-uv]',
        cacheKey: 'site:uv',
        key: SITE_UV_KEY,
        offset: siteUvOffset,
        unique: true,
      },
      cache
    );
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
