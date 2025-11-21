(() => {
  const dialog = document.getElementById("cm-confirm");

  if (!dialog) {
    window.showConfirm = (options = {}) => {
      const text = options?.body || "Are you sure?";
      return Promise.resolve(window.confirm(text));
    };
    window.CMConfirm =
      window.CMConfirm ||
      ((text) => window.showConfirm({ body: text || "Are you sure?" }));
    window.cmConfirmDialog = null;
    return;
  }

  const titleEl = dialog.querySelector("[data-confirm-title]");
  const messageEl = dialog.querySelector("[data-confirm-text]");
  const extraEl = dialog.querySelector("[data-confirm-extra]");
  const errorEl = dialog.querySelector("[data-confirm-error]");
  const confirmBtn = dialog.querySelector(".js-confirm");
  const cancelBtn = dialog.querySelector(".js-cancel");

  const api = {
    dialog,
    confirmBtn,
    cancelBtn,
    setTitle(value) {
      if (titleEl) titleEl.textContent = value || "Confirm action";
    },
    setMessage(value) {
      if (messageEl) messageEl.textContent = value || "Are you sure?";
    },
    setConfirmLabel(value) {
      if (this.confirmBtn) this.confirmBtn.textContent = value || "Confirm";
    },
    setCancelLabel(value) {
      if (this.cancelBtn) this.cancelBtn.textContent = value || "Cancel";
    },
    setExtra(node) {
      if (!extraEl) return;
      extraEl.innerHTML = "";
      if (node) {
        extraEl.hidden = false;
        extraEl.appendChild(node);
      } else {
        extraEl.hidden = true;
      }
    },
    setError(message) {
      if (!errorEl) return;
      if (message) {
        errorEl.textContent = message;
        errorEl.hidden = false;
        errorEl.classList.add("is-visible");
      } else {
        errorEl.textContent = "";
        errorEl.hidden = true;
        errorEl.classList.remove("is-visible");
      }
    },
    disableConfirm(state) {
      if (this.confirmBtn) this.confirmBtn.disabled = !!state;
    },
    reset() {
      this.setExtra(null);
      this.setError(null);
      this.disableConfirm(false);
      this.setConfirmLabel();
      this.setCancelLabel();
      this.setTitle();
      this.setMessage();
    },
    open() {
      if (dialog.open) dialog.close();
      dialog.showModal();
    },
    close() {
      if (dialog.open) dialog.close();
    }
  };

  window.cmConfirmDialog = api;

  const simpleConfirm = (options = {}) =>
    new Promise((resolve) => {
      api.reset();
      api.setTitle(options.title);
      api.setMessage(options.body);
      api.setConfirmLabel(options.confirmText);
      api.setCancelLabel(options.cancelText);

      const cleanup = () => {
        api.confirmBtn?.removeEventListener("click", onConfirm);
        api.cancelBtn?.removeEventListener("click", onCancel);
        dialog.removeEventListener("cancel", onCancel);
        api.close();
      };

      const onConfirm = () => {
        cleanup();
        resolve(true);
      };

      const onCancel = () => {
        cleanup();
        resolve(false);
      };

      api.confirmBtn?.addEventListener("click", onConfirm);
      api.cancelBtn?.addEventListener("click", onCancel);
      dialog.addEventListener("cancel", onCancel, { once: true });

      api.open();
    });

  window.showConfirm = (options = {}) => simpleConfirm(options);
  window.CMConfirm =
    window.CMConfirm ||
    ((text) => window.showConfirm({ body: text || "Are you sure?" }));
})();

(() => {
  if (typeof window.cmToast === "function") {
    window.toast = window.toast || window.cmToast;
    return;
  }

  const ensureRoot = () => {
    let root = document.getElementById("cm-toast-root");
    if (!root) {
      root = document.createElement("div");
      root.id = "cm-toast-root";
      root.className = "cm-toasts";
      document.body.appendChild(root);
    }
    if (!root.classList.contains("cm-toasts")) {
      root.classList.add("cm-toasts");
    }
    return root;
  };

  let stack = null;

  const toast = (message, tone = "info") => {
    if (!message) return;
    const root = ensureRoot();
    if (!stack || !root.contains(stack)) {
      stack = document.createElement("div");
      stack.className = "cm-toast-stack";
      root.appendChild(stack);
    }
    const item = document.createElement("div");
    item.className = `cm-toast cm-toast--${tone}`;
    item.textContent = message;
    stack.appendChild(item);
    requestAnimationFrame(() => item.classList.add("is-visible"));
    setTimeout(() => {
      item.classList.remove("is-visible");
      setTimeout(() => {
        item.remove();
        if (stack && !stack.childElementCount) {
          stack.remove();
          stack = null;
        }
      }, 320);
    }, 3200);
  };

  window.cmToast = toast;
  if (!window.toast) {
    window.toast = toast;
  }
})();
