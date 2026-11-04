(function (global) {
  "use strict";

  class TaskScope {
    constructor() {
      this.revision = 0;
      this.current = null;
    }

    begin() {
      this.cancel();
      const controller = new AbortController();
      const revision = this.revision;
      const task = {
        signal: controller.signal,
        abort: () => controller.abort(),
        isCurrent: () => this.current === task && revision === this.revision && !controller.signal.aborted,
        commit: (callback) => {
          if (!task.isCurrent()) return false;
          callback();
          return true;
        },
      };
      this.current = task;
      return task;
    }

    finish(task) {
      if (this.current === task) this.current = null;
    }

    cancel() {
      this.revision += 1;
      this.current?.abort();
      this.current = null;
    }
  }

  if (typeof module === "object" && module.exports) module.exports = TaskScope;
  else global.SpatialTaskScope = TaskScope;
})(typeof window === "object" ? window : globalThis);
