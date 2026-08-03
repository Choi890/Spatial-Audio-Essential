(function () {
  const API_ORIGIN = window.location.protocol === "file:" ? "http://127.0.0.1:8768" : "";

  function $(selector) {
    return document.querySelector(selector);
  }

  function apiPath(path) {
    return `${API_ORIGIN}${path}`;
  }

  function setText(node, value) {
    if (!node) return;
    const text = String(value);
    if (node.textContent !== text) {
      node.textContent = text;
    }
  }

  function setStyleProperty(node, name, value) {
    if (!node) return;
    if (!node._styleCache) node._styleCache = {};
    if (node._styleCache[name] !== value) {
      node._styleCache[name] = value;
      node.style.setProperty(name, value);
    }
  }

  function toggleClass(node, className, enabled) {
    if (!node) return;
    if (!node._classCache) node._classCache = {};
    if (node._classCache[className] !== enabled) {
      node._classCache[className] = enabled;
      node.classList.toggle(className, enabled);
    }
  }

  function mapRange(value, inMin, inMax, outMin, outMax) {
    return outMin + ((value - inMin) / (inMax - inMin)) * (outMax - outMin);
  }

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  function dbToGain(db) {
    return 10 ** (Number(db || 0) / 20);
  }

  function cssColor(name, fallback) {
    const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    return value || fallback;
  }

  function formatTime(seconds) {
    if (!Number.isFinite(seconds)) return "0:00";
    const total = Math.max(0, Math.floor(seconds));
    const minutes = Math.floor(total / 60);
    const secs = total % 60;
    return `${minutes}:${String(secs).padStart(2, "0")}`;
  }

  function formatBytes(bytes) {
    if (!bytes) return "0 B";
    const units = ["B", "KB", "MB", "GB"];
    const index = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
    return `${(bytes / (1024 ** index)).toFixed(index ? 1 : 0)} ${units[index]}`;
  }

  function formatNumber(value) {
    return new Intl.NumberFormat("ko-KR").format(value);
  }

  function escapeHtml(value) {
    return String(value)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  window.SpatialAudioUtils = {
    $,
    apiPath,
    clamp,
    cssColor,
    dbToGain,
    escapeHtml,
    formatBytes,
    formatNumber,
    formatTime,
    mapRange,
    setStyleProperty,
    setText,
    toggleClass
  };
})();
