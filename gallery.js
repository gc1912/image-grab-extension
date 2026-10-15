/**
 * 预览页：读取提取结果，网格展示、勾选并请求后台下载为 PNG。
 */
(function () {
  "use strict";

  const gridEl = document.getElementById("grid");
  const emptyEl = document.getElementById("empty");
  const countEl = document.getElementById("count-text");
  const metaEl = document.getElementById("page-meta");
  const statusEl = document.getElementById("status-bar");
  const btnAll = document.getElementById("btn-all");
  const btnInvert = document.getElementById("btn-invert");
  const btnDownload = document.getElementById("btn-download");

  let images = [];
  let downloading = false;

  function setStatus(text, mode) {
    if (!text) {
      statusEl.hidden = true;
      statusEl.textContent = "";
      statusEl.className = "status-bar";
      return;
    }
    statusEl.hidden = false;
    statusEl.textContent = text;
    statusEl.className = "status-bar" + (mode ? " " + mode : "");
  }

  function selectedIndexes() {
    return Array.from(gridEl.querySelectorAll("input[type='checkbox']:checked")).map(function (el) {
      return Number(el.value);
    });
  }

  function updateCount() {
    const selected = selectedIndexes().length;
    countEl.textContent = "已选 " + selected + " / " + images.length;
    btnDownload.disabled = downloading || selected === 0;
  }

  function createCard(url, index) {
    const card = document.createElement("article");
    card.className = "card is-checked";

    const wrap = document.createElement("div");
    wrap.className = "thumb-wrap";
    const img = document.createElement("img");
    img.alt = "商品图 " + (index + 1);
    img.src = url;

    const sizeText = document.createElement("span");
    sizeText.className = "size-text";
    sizeText.textContent = "读取尺寸中…";

    img.addEventListener("load", function () {
      sizeText.textContent = img.naturalWidth + " × " + img.naturalHeight;
    });
    img.addEventListener("error", function () {
      sizeText.textContent = "缩略图加载失败";
    });

    wrap.appendChild(img);

    const meta = document.createElement("div");
    meta.className = "card-meta";
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.checked = true;
    checkbox.value = String(index);
    checkbox.addEventListener("click", function (e) {
      e.stopPropagation();
    });
    checkbox.addEventListener("change", function () {
      card.classList.toggle("is-checked", checkbox.checked);
      updateCount();
    });

    meta.appendChild(sizeText);
    meta.appendChild(checkbox);

    card.appendChild(wrap);
    card.appendChild(meta);
    card.addEventListener("click", function () {
      checkbox.checked = !checkbox.checked;
      card.classList.toggle("is-checked", checkbox.checked);
      updateCount();
    });

    return card;
  }

  function render() {
    gridEl.innerHTML = "";
    if (!images.length) {
      emptyEl.hidden = false;
      updateCount();
      return;
    }
    emptyEl.hidden = true;
    images.forEach(function (url, index) {
      gridEl.appendChild(createCard(url, index));
    });
    updateCount();
  }

  function setAll(checked) {
    gridEl.querySelectorAll("input[type='checkbox']").forEach(function (el) {
      el.checked = checked;
      el.closest(".card").classList.toggle("is-checked", checked);
    });
    updateCount();
  }

  function invert() {
    gridEl.querySelectorAll("input[type='checkbox']").forEach(function (el) {
      el.checked = !el.checked;
      el.closest(".card").classList.toggle("is-checked", el.checked);
    });
    updateCount();
  }

  function startDownload() {
    if (downloading) return;
    const urls = selectedIndexes().map(function (i) {
      return images[i];
    });
    if (!urls.length) {
      setStatus("请先勾选要下载的图片", "is-error");
      return;
    }
    downloading = true;
    btnDownload.disabled = true;
    btnAll.disabled = true;
    btnInvert.disabled = true;
    setStatus("准备下载 " + urls.length + " 张图片…");

    chrome.runtime.sendMessage({ type: "DOWNLOAD_IMAGES", urls: urls }, function (res) {
      if (chrome.runtime.lastError) {
        downloading = false;
        btnAll.disabled = false;
        btnInvert.disabled = false;
        updateCount();
        setStatus("下载请求失败，请重试", "is-error");
        return;
      }
      if (res && res.ok === false) {
        downloading = false;
        btnAll.disabled = false;
        btnInvert.disabled = false;
        updateCount();
        setStatus(res.error || "下载失败", "is-error");
      }
    });
  }

  chrome.runtime.onMessage.addListener(function (message) {
    if (!message || !message.type) return;
    if (message.type === "DOWNLOAD_PROGRESS") {
      setStatus("正在下载 " + message.current + " / " + message.total + "（成功 " + message.success + "）");
    }
    if (message.type === "DOWNLOAD_COMPLETE") {
      downloading = false;
      btnAll.disabled = false;
      btnInvert.disabled = false;
      updateCount();
      const mode = message.fail ? "is-error" : "is-done";
      setStatus(
        "下载完成：成功 " + message.success + " 张，失败 " + message.fail + " 张",
        mode
      );
    }
  });

  btnAll.addEventListener("click", function () {
    setAll(true);
  });
  btnInvert.addEventListener("click", function () {
    invert();
  });
  btnDownload.addEventListener("click", startDownload);

  chrome.runtime.sendMessage({ type: "GET_GALLERY_DATA" }, function (res) {
    if (chrome.runtime.lastError || !res || !res.ok || !res.payload) {
      emptyEl.hidden = false;
      emptyEl.textContent = "没有可展示的图片，请从商品详情页点击「获取图片」";
      updateCount();
      return;
    }
    images = res.payload.images || [];
    const title = res.payload.pageTitle || "";
    metaEl.textContent = title ? "来源：" + title : "";
    document.title = "商品图片预览" + (title ? " - " + title : "");
    render();
  });
})();
