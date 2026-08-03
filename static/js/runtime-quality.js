(function registerSpatialRuntimeQuality(global) {
  "use strict";

  const DEFAULT_TIER_ORDER = Object.freeze(["safe", "balanced", "full"]);

  class SpatialRuntimeQualityController {
    constructor(options = {}) {
      this.tierOrder = Array.isArray(options.tierOrder) && options.tierOrder.length
        ? [...options.tierOrder]
        : [...DEFAULT_TIER_ORDER];
      this.tier = this.normalizeTier(options.initialTier || "balanced");
      this.ceilingTier = this.normalizeTier(options.ceilingTier || this.tier);
      this.cooldownMs = Number.isFinite(options.cooldownMs) ? options.cooldownMs : 30000;
      this.highWindowLimit = Number.isFinite(options.highWindowLimit) ? options.highWindowLimit : 3;
      this.lowWindowLimit = Number.isFinite(options.lowWindowLimit) ? options.lowWindowLimit : 20;
      this.onTierChange = typeof options.onTierChange === "function" ? options.onTierChange : () => {};
      this.highWindows = 0;
      this.lowWindows = 0;
      this.lastTierChangeAt = 0;
      this.capacity = null;
      this.boundUpdate = (event) => this.handleUpdate(event);
      this.metrics = { supported: false, averageLoad: 0, peakLoad: 0, underrunRatio: 0 };
    }

    normalizeTier(tier) {
      return this.tierOrder.includes(tier) ? tier : this.tierOrder[Math.min(1, this.tierOrder.length - 1)];
    }

    attach(context) {
      const capacity = context && context.renderCapacity;
      if (!capacity || typeof capacity.start !== "function") return false;
      this.detach();
      this.capacity = capacity;
      this.metrics.supported = true;
      if (typeof capacity.addEventListener === "function") {
        capacity.addEventListener("update", this.boundUpdate);
      } else {
        capacity.onupdate = this.boundUpdate;
      }
      try {
        capacity.start({ updateInterval: 1 });
        return true;
      } catch (error) {
        this.detach();
        return false;
      }
    }

    detach() {
      if (!this.capacity) return;
      try {
        if (typeof this.capacity.removeEventListener === "function") {
          this.capacity.removeEventListener("update", this.boundUpdate);
        } else if (this.capacity.onupdate === this.boundUpdate) {
          this.capacity.onupdate = null;
        }
        if (typeof this.capacity.stop === "function") this.capacity.stop();
      } catch (error) {
        // Capacity reporting is optional and must never interrupt playback.
      }
      this.capacity = null;
    }

    handleUpdate(event = {}, now = (global.performance?.now?.() || Date.now())) {
      const averageLoad = this.clampMetric(event.averageLoad);
      const peakLoad = this.clampMetric(event.peakLoad);
      const underrunRatio = this.clampMetric(event.underrunRatio);
      this.metrics = { supported: true, averageLoad, peakLoad, underrunRatio };

      const overloaded = underrunRatio > 0 || peakLoad >= 0.92 || averageLoad >= 0.78;
      const relaxed = underrunRatio === 0 && peakLoad <= 0.55 && averageLoad <= 0.45;
      this.highWindows = overloaded ? this.highWindows + 1 : 0;
      this.lowWindows = relaxed ? this.lowWindows + 1 : 0;

      const cooldownComplete = !this.lastTierChangeAt || now - this.lastTierChangeAt >= this.cooldownMs;
      if (overloaded && this.highWindows >= this.highWindowLimit && cooldownComplete) {
        this.shiftTier(-1, "render-overload", now);
      } else if (relaxed && this.lowWindows >= this.lowWindowLimit && cooldownComplete) {
        this.shiftTier(1, "render-headroom", now);
      }
      return this.snapshot();
    }

    shiftTier(direction, reason, now) {
      const currentIndex = this.tierOrder.indexOf(this.tier);
      const ceilingIndex = this.tierOrder.indexOf(this.ceilingTier);
      const nextIndex = Math.max(0, Math.min(ceilingIndex, currentIndex + direction));
      if (nextIndex === currentIndex) {
        this.highWindows = 0;
        this.lowWindows = 0;
        return false;
      }
      const previousTier = this.tier;
      this.tier = this.tierOrder[nextIndex];
      this.lastTierChangeAt = now;
      this.highWindows = 0;
      this.lowWindows = 0;
      this.onTierChange({ tier: this.tier, previousTier, reason, metrics: { ...this.metrics } });
      return true;
    }

    clampMetric(value) {
      const numeric = Number(value);
      return Number.isFinite(numeric) ? Math.max(0, Math.min(1, numeric)) : 0;
    }

    snapshot() {
      return { tier: this.tier, ceilingTier: this.ceilingTier, ...this.metrics };
    }
  }

  global.SpatialRuntimeQualityController = SpatialRuntimeQualityController;
})(window);
