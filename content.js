/**
 * 电商详情页内容脚本：按 URL 判断是否为详情页，注入「获取图片」按钮并提取商品图。
 */
(function () {
  "use strict";

  const MIN_SIZE = 100;
  const BTN_ID = "img-grab-ext-btn";
  const TOAST_ID = "img-grab-ext-toast";

  const LAZY_ATTRS = [
    "src",
    "data-src",
    "data-lazy-src",
    "data-original",
    "data-lazyload",
    "data-ks-lazyload",
    "data-lazy-img",
    "data-img",
    "data-url",
    "data-image",
    "data-src-retina",
    "data-actualsrc",
    "data-init-src",
    "data-origin",
    "data-zoom-image"
  ];

  const SKIP_URL_RE =
    /logo|icon|avatar|sprite|placeholder|spacer|blank|favicon|loading\.gif|default_user|qrcode|captcha/i;

  /**
   * 按各平台 URL 特征判断是否为商品详情页。
   */
  function isProductDetailPage() {
    const host = location.hostname.toLowerCase();
    const path = location.pathname;
    const search = location.search;
    const href = location.href;

    // 淘宝 / 天猫详情
    if (host.includes("taobao.com") || host.includes("tmall.com")) {
      return (
        /item\.taobao\.com/i.test(host) ||
        /detail\.(tmall|taobao)/i.test(host) ||
        /chaoshi\.tmall\.com/i.test(host) ||
        /world\.taobao\.com/i.test(host) ||
        /\/item\.htm/i.test(path) ||
        /\/item\//i.test(path)
      );
    }

    // 京东商品详情
    if (host.includes("jd.com") || host.includes("jd.hk")) {
      return (
        /^item\./i.test(host) ||
        /npcitem\./i.test(host) ||
        /\/\d+\.html/i.test(path)
      );
    }

    // 拼多多商家后台（mms）
    if (host.includes("mms.pinduoduo.com")) {
      return /goods|product|detail|commodity|sku|mars/i.test(path + href);
    }

    // 拼多多买家详情（yangkeduo / mobile.yangkeduo）
    if (host.includes("yangkeduo.com")) {
      return (
        /goods\.html/i.test(path) ||
        /\/goods\b/i.test(path) ||
        /goods_id=/i.test(search)
      );
    }

    return false;
  }

  function showToast(text) {
    let toast = document.getElementById(TOAST_ID);
    if (!toast) {
      toast = document.createElement("div");
      toast.id = TOAST_ID;
      toast.className = "img-grab-ext-toast";
      document.documentElement.appendChild(toast);
    }
    toast.textContent = text;
    toast.classList.add("is-show");
    clearTimeout(showToast._timer);
    showToast._timer = setTimeout(function () {
      toast.classList.remove("is-show");
    }, 2200);
  }

  /**
   * 将相对路径补全为绝对 URL，非法地址返回空。
   */
  function toAbsoluteUrl(raw) {
    if (!raw || typeof raw !== "string") return "";
    const trimmed = raw.trim().replace(/^['"]|['"]$/g, "");
    if (!trimmed || trimmed === "none" || trimmed.startsWith("data:") || trimmed.startsWith("blob:")) {
      return "";
    }
    if (trimmed.startsWith("chrome-extension:") || trimmed.startsWith("about:")) {
      return "";
    }
    try {
      const url = new URL(trimmed, location.href);
      if (url.protocol !== "http:" && url.protocol !== "https:") return "";
      return url.href;
    } catch (e) {
      return "";
    }
  }

  /**
   * 尽量把各平台缩略图地址还原为大图。
   */
  function upgradeImageUrl(url) {
    if (!url) return url;
    let next = url;

    // 淘宝 / 天猫：xxx.jpg_50x50.jpg、_sum.jpg、_q50.jpg 等
    next = next.replace(/_\d+x\d+q\d+\.(jpg|jpeg|png|webp|gif)/i, ".$1");
    next = next.replace(/_\d+x\d+\.(jpg|jpeg|png|webp|gif)/i, ".$1");
    next = next.replace(/_(sum|b|m)\.(jpg|jpeg|png|webp|gif)/i, ".$2");
    next = next.replace(/\.(jpg|jpeg|png|webp)_[^.?#]+/i, ".$1");

    // 京东：s50x50_jfs、/n5/、/n7/ 等较小规格
    next = next.replace(/\/s\d+x\d+_jfs\//i, "/jfs/");
    next = next.replace(/\/n[2-9]\//i, "/n1/");
    next = next.replace(/\/s\d+x\d+_/i, "/");

    // 拼多多常见缩略参数
    next = next.replace(/[?&]imageView2\/[^#]*/i, "");
    next = next.replace(/\/resize\/[^/]+/i, "");

    return next;
  }

  function isLikelyUselessUrl(url) {
    if (!url) return true;
    const lower = url.toLowerCase();
    if (SKIP_URL_RE.test(lower)) return true;
    if (/\.svg(\?|$)/i.test(lower)) return true;
    if (/1x1|pixel\.gif|transparent/i.test(lower)) return true;
    return false;
  }

  /**
   * 解析 srcset，收集候选并优先记最大宽度那张。
   */
  function collectFromSrcset(srcset, bucket) {
    if (!srcset) return;
    const parts = srcset.split(",");
    let bestUrl = "";
    let bestW = -1;
    parts.forEach(function (part) {
      const bits = part.trim().split(/\s+/);
      if (!bits[0]) return;
      const abs = toAbsoluteUrl(bits[0]);
      if (!abs) return;
      let w = 0;
      if (bits[1] && /w$/i.test(bits[1])) w = parseInt(bits[1], 10) || 0;
      if (bits[1] && /x$/i.test(bits[1])) w = (parseFloat(bits[1]) || 0) * 1000;
      if (w >= bestW) {
        bestW = w;
        bestUrl = abs;
      }
      bucket.add(upgradeImageUrl(abs));
    });
    if (bestUrl) bucket.add(upgradeImageUrl(bestUrl));
  }

  function collectRawCandidate(raw, bucket) {
    if (!raw) return;
    const text = String(raw);
    if (text.includes("url(")) {
      const matches = text.match(/url\(([^)]+)\)/gi) || [];
      matches.forEach(function (m) {
        const inner = m.replace(/^url\(/i, "").replace(/\)$/, "");
        const abs = toAbsoluteUrl(inner);
        if (abs && !isLikelyUselessUrl(abs)) bucket.add(upgradeImageUrl(abs));
      });
      return;
    }
    const abs = toAbsoluteUrl(text);
    if (abs && !isLikelyUselessUrl(abs)) bucket.add(upgradeImageUrl(abs));
  }

  /**
   * 已渲染且宽或高 < 100 才视为过小；naturalWidth=0 的懒加载图先保留。
   * 若能升级为更大地址，则保留升级后的 URL。
   */
  function filterSmallRendered(img, urls) {
    const rendered = img.naturalWidth > 0 && img.naturalHeight > 0;
    if (!rendered) return urls;
    if (img.naturalWidth >= MIN_SIZE && img.naturalHeight >= MIN_SIZE) return urls;
    const kept = [];
    urls.forEach(function (url) {
      const upgraded = upgradeImageUrl(url);
      if (upgraded !== url) {
        kept.push(upgraded);
        return;
      }
      const current = img.currentSrc || img.src;
      if (current && upgradeImageUrl(toAbsoluteUrl(current)) !== upgraded) {
        kept.push(upgraded);
      }
    });
    return kept;
  }

  function collectFromImgElement(img) {
    const found = new Set();
    LAZY_ATTRS.forEach(function (name) {
      collectRawCandidate(img.getAttribute(name), found);
    });
    if (img.currentSrc) collectRawCandidate(img.currentSrc, found);
    collectFromSrcset(img.getAttribute("srcset"), found);
    collectFromSrcset(img.getAttribute("data-srcset"), found);
    return filterSmallRendered(img, Array.from(found));
  }

  function collectBackground(el, bucket) {
    try {
      const bg = window.getComputedStyle(el).backgroundImage;
      collectRawCandidate(bg, bucket);
    } catch (e) {
      /* 跨域 iframe 内样式可能读不到，忽略 */
    }
    ["data-src", "data-lazy-src", "data-original"].forEach(function (name) {
      collectRawCandidate(el.getAttribute(name), bucket);
    });
  }

  /**
   * 扫描当前页商品相关图片，去重后返回绝对 URL 列表。
   */
  function extractImages() {
    const bucket = new Set();

    document.querySelectorAll("img").forEach(function (img) {
      collectFromImgElement(img).forEach(function (u) {
        bucket.add(u);
      });
    });

    document.querySelectorAll("source").forEach(function (source) {
      collectFromSrcset(source.getAttribute("srcset"), bucket);
      collectRawCandidate(source.getAttribute("src"), bucket);
      collectRawCandidate(source.getAttribute("data-src"), bucket);
    });

    document.querySelectorAll("*").forEach(function (el) {
      if (el.tagName === "IMG" || el.tagName === "SOURCE") return;
      const styleAttr = el.getAttribute("style") || "";
      if (styleAttr.includes("background") || styleAttr.includes("url(")) {
        collectBackground(el, bucket);
        return;
      }
      if (el.className && /lazy|img|pic|photo|gallery|desc/i.test(String(el.className))) {
        collectBackground(el, bucket);
      }
    });

    return Array.from(bucket);
  }

  function setButtonBusy(btn, busy) {
    btn.disabled = busy;
    btn.textContent = busy ? "提取中…" : "获取图片";
  }

  function onGrabClick(btn) {
    if (btn.disabled) return;
    setButtonBusy(btn, true);
    try {
      const images = extractImages();
      if (!images.length) {
        showToast("未找到符合条件的商品图片");
        setButtonBusy(btn, false);
        return;
      }
      chrome.runtime.sendMessage(
        {
          type: "OPEN_GALLERY",
          images: images,
          pageTitle: document.title || "",
          pageUrl: location.href
        },
        function (res) {
          setButtonBusy(btn, false);
          if (chrome.runtime.lastError) {
            showToast("打开预览页失败，请刷新后重试");
            return;
          }
          if (!res || !res.ok) {
            showToast((res && res.error) || "打开预览页失败");
          }
        }
      );
    } catch (err) {
      setButtonBusy(btn, false);
      showToast("提取图片时出错");
    }
  }

  function injectButton() {
    if (document.getElementById(BTN_ID)) return;
    const btn = document.createElement("button");
    btn.type = "button";
    btn.id = BTN_ID;
    btn.className = "img-grab-ext-btn";
    btn.textContent = "获取图片";
    btn.addEventListener("click", function (e) {
      e.preventDefault();
      e.stopPropagation();
      onGrabClick(btn);
    });
    (document.body || document.documentElement).appendChild(btn);
  }

  function init() {
    if (!isProductDetailPage()) return;
    injectButton();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
