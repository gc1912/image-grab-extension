/**
 * Service Worker：接收内容脚本消息、打开预览页、将图片转为 PNG 并触发下载。
 */

const STORAGE_KEY = "imgGrabGallery";

function getStore() {
  return chrome.storage.session || chrome.storage.local;
}

function padIndex(num) {
  return String(num).padStart(3, "0");
}

function blobToDataUrl(blob) {
  return new Promise(function (resolve, reject) {
    const reader = new FileReader();
    reader.onload = function () {
      resolve(reader.result);
    };
    reader.onerror = function () {
      reject(new Error("读取图片数据失败"));
    };
    reader.readAsDataURL(blob);
  });
}

/**
 * 拉取原图并在 OffscreenCanvas 中转为 PNG Blob。
 */
async function convertToPngBlob(imageUrl) {
  const response = await fetch(imageUrl, {
    mode: "cors",
    credentials: "omit",
    cache: "no-cache"
  });
  if (!response.ok) {
    throw new Error("请求图片失败：" + response.status);
  }
  const blob = await response.blob();
  const bitmap = await createImageBitmap(blob);
  const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    bitmap.close();
    throw new Error("无法创建画布");
  }
  ctx.drawImage(bitmap, 0, 0);
  bitmap.close();
  return canvas.convertToBlob({ type: "image/png" });
}

async function downloadOne(imageUrl, index) {
  const pngBlob = await convertToPngBlob(imageUrl);
  const dataUrl = await blobToDataUrl(pngBlob);
  const filename = "商品图_" + padIndex(index) + ".png";
  await chrome.downloads.download({
    url: dataUrl,
    filename: filename,
    saveAs: false,
    conflictAction: "uniquify"
  });
}

function notifyGallery(payload) {
  chrome.runtime.sendMessage(payload).catch(function () {
    /* 预览页未打开时忽略 */
  });
}

async function handleDownload(urls) {
  const total = urls.length;
  let success = 0;
  const failed = [];

  for (let i = 0; i < urls.length; i++) {
    const url = urls[i];
    notifyGallery({
      type: "DOWNLOAD_PROGRESS",
      current: i + 1,
      total: total,
      success: success,
      fail: failed.length
    });
    try {
      await downloadOne(url, i + 1);
      success += 1;
    } catch (err) {
      failed.push({
        url: url,
        message: err && err.message ? err.message : "未知错误"
      });
    }
  }

  notifyGallery({
    type: "DOWNLOAD_COMPLETE",
    total: total,
    success: success,
    fail: failed.length,
    failed: failed
  });

  return { ok: true, total: total, success: success, fail: failed.length };
}

async function openGallery(message) {
  const images = Array.isArray(message.images) ? message.images : [];
  if (!images.length) {
    return { ok: false, error: "没有可展示的图片" };
  }
  await getStore().set({
    [STORAGE_KEY]: {
      images: images,
      pageTitle: message.pageTitle || "",
      pageUrl: message.pageUrl || "",
      createdAt: Date.now()
    }
  });
  await chrome.tabs.create({
    url: chrome.runtime.getURL("gallery.html")
  });
  return { ok: true, count: images.length };
}

chrome.runtime.onMessage.addListener(function (message, sender, sendResponse) {
  if (!message || !message.type) return;

  if (message.type === "OPEN_GALLERY") {
    openGallery(message)
      .then(sendResponse)
      .catch(function (err) {
        sendResponse({ ok: false, error: err && err.message ? err.message : "打开失败" });
      });
    return true;
  }

  if (message.type === "GET_GALLERY_DATA") {
    getStore()
      .get(STORAGE_KEY)
      .then(function (data) {
        sendResponse({ ok: true, payload: data[STORAGE_KEY] || null });
      })
      .catch(function (err) {
        sendResponse({ ok: false, error: err && err.message ? err.message : "读取失败" });
      });
    return true;
  }

  if (message.type === "DOWNLOAD_IMAGES") {
    const urls = Array.isArray(message.urls) ? message.urls : [];
    if (!urls.length) {
      sendResponse({ ok: false, error: "未选择图片" });
      return;
    }
    handleDownload(urls)
      .then(sendResponse)
      .catch(function (err) {
        sendResponse({ ok: false, error: err && err.message ? err.message : "下载失败" });
      });
    return true;
  }
});
