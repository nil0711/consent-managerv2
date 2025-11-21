(() => {
  const host = document.querySelector("[data-study-modal-host]");
  if (!host) return;

  const CSS_ESCAPE =
    typeof CSS !== "undefined" && typeof CSS.escape === "function"
      ? (value) => CSS.escape(String(value))
      : (value) => String(value).replace(/[^a-zA-Z0-9_-]/g, "_");

  const jsonRequest = async (url, { method = "GET", body } = {}) => {
    const response = await fetch(url, {
      method,
      credentials: "include",
      headers: {
        "Content-Type": "application/json"
      },
      body: body ? JSON.stringify(body) : undefined
    });
    if (!response.ok) {
      let reason = response.statusText || "Request failed";
      try {
        const data = await response.json();
        if (data?.error) reason = data.error;
      } catch {
        /* ignore */
      }
      throw new Error(reason);
    }
    return response.json();
  };

  const loadScript = (src) =>
    new Promise((resolve, reject) => {
      const already = document.querySelector(`script[data-src="${src}"]`);
      if (already && already.dataset.loaded === "true") {
        resolve();
        return;
      }
      const script = already || document.createElement("script");
      script.src = src;
      script.async = true;
      script.dataset.src = src;
      script.onload = () => {
        script.dataset.loaded = "true";
        resolve();
      };
      script.onerror = () => reject(new Error(`Failed to load ${src}`));
      if (!already) document.head.appendChild(script);
    });

  const ensureVendors = (() => {
    let promise = null;
    return () => {
      if (window.marked && window.DOMPurify) {
        return Promise.resolve({
          marked: window.marked,
          DOMPurify: window.DOMPurify
        });
      }
      if (!promise) {
        promise = Promise.all([
          loadScript("/static/js/vendor/marked.umd.js"),
          loadScript("/static/js/vendor/purify.min.js")
        ]).then(() => ({
          marked: window.marked,
          DOMPurify: window.DOMPurify
        }));
      }
      return promise;
    };
  })();

  const ensureToastRoot = () => {
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

  const buildToast = () => {
    let container = null;
    return (message, tone = "info") => {
      const root = ensureToastRoot();
      if (!container || !root.contains(container)) {
        container = document.createElement("div");
        container.className = "cm-toast-stack";
        root.appendChild(container);
      }
      const toast = document.createElement("div");
      toast.className = `cm-toast cm-toast--${tone}`;
      toast.textContent = message;
      container.appendChild(toast);
      requestAnimationFrame(() => {
        toast.classList.add("is-visible");
      });
      setTimeout(() => {
        toast.classList.remove("is-visible");
        setTimeout(() => {
          toast.remove();
          if (!container.childElementCount) {
            container.remove();
            container = null;
          }
        }, 320);
      }, 3200);
    };
  };

  const createToast =
    typeof window.cmToast === "function" ? window.cmToast : buildToast();

  if (typeof window.cmToast !== "function") {
    window.cmToast = createToast;
  }

  const state = {
    dialog: null,
    studyId: null,
    contextVersion: null,
    enrollmentStatus: "UNENROLLED",
    permissions: new Map(),
    pending: new Map(),
    saveTimer: null,
    saving: false,
    chatHistory: [],
    streaming: false,
    chatSource: null,
    bodyOverflow: null,
    escapeHandler: null,
    returnFocus: null
  };

  const resetState = () => {
    if (state.chatSource) {
      try {
        state.chatSource.close();
      } catch {
        /* noop */
      }
    }
    if (state.saveTimer) {
      clearTimeout(state.saveTimer);
      state.saveTimer = null;
    }
    if (state.escapeHandler) {
      document.removeEventListener("keydown", state.escapeHandler, true);
      state.escapeHandler = null;
    }
    if (state.dialog?.__trapDestroy) {
      try {
        state.dialog.__trapDestroy();
      } catch {
        /* noop */
      }
    }
    state.chatSource = null;
    state.dialog = null;
    state.studyId = null;
    state.contextVersion = null;
    state.enrollmentStatus = "UNENROLLED";
    state.permissions.clear();
    state.pending.clear();
    state.saving = false;
    state.chatHistory = [];
    state.streaming = false;
    state.returnFocus = null;
    if (state.bodyOverflow !== null) {
      document.body.style.overflow = state.bodyOverflow || "";
      state.bodyOverflow = null;
    }
  };

  const closeModal = () => {
    if (!state.dialog) return;
    const root = state.dialog;
    const focusTarget = state.returnFocus;
    if (root.parentElement) {
      root.parentElement.removeChild(root);
    }
    host.innerHTML = "";
    resetState();
    if (focusTarget && typeof focusTarget.focus === "function") {
      try {
        focusTarget.focus();
      } catch {
        /* noop */
      }
    }
  };

  const escapeHtml = (value) =>
    String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");

  const trapFocus = (root) => {
    const focusables = root.querySelectorAll(
      "a,button,input,select,textarea,[tabindex]:not([tabindex='-1'])"
    );
    if (!focusables.length) return;
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    const onKey = (event) => {
      if (event.key !== "Tab") return;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    root.addEventListener("keydown", onKey);
    root.__trapDestroy = () => root.removeEventListener("keydown", onKey);
  };

  const setToggleVisual = (row, input, value) => {
    if (!row || !input) return;
    const next = Boolean(value);
    input.checked = next;
    if (input.setAttribute) {
      input.setAttribute("aria-checked", String(next));
    }
    row.classList.toggle("is-on", next);
    const switcher = row.querySelector(".cm-switch");
    if (switcher) {
      switcher.classList.toggle("is-on", next);
      switcher.setAttribute("aria-checked", String(next));
    }
  };

  const updatePermissionInteractivity = () => {
    if (!state.dialog) return;
    const locked = state.enrollmentStatus !== "ENROLLED";
    state.dialog.querySelectorAll(".cm-perm").forEach((row) => {
      const input = row.querySelector(".js-perm");
      const switcher = row.querySelector(".cm-switch");
      if (!input) return;
      const required = input.dataset.required === "true";
      row.classList.toggle("is-required", required);
      if (required) {
        input.disabled = true;
        switcher?.classList.add("is-locked");
        switcher?.setAttribute("aria-disabled", "true");
        return;
      }
      if (locked) {
        input.disabled = true;
        row.classList.add("is-disabled");
        switcher?.classList.add("is-locked");
        switcher?.setAttribute("aria-disabled", "true");
      } else {
        input.disabled = false;
        row.classList.remove("is-disabled");
        switcher?.classList.remove("is-locked");
        switcher?.removeAttribute("aria-disabled");
      }
      const isOn = Boolean(input.checked);
      switcher?.classList.toggle("is-on", isOn);
      switcher?.setAttribute("aria-checked", String(isOn));
    });
  };

  const applyPermissionsFromServer = (list) => {
    if (!Array.isArray(list)) return;
    list.forEach((perm) => {
      const key = perm?.key;
      if (!key) return;
      const granted = Boolean(perm.granted);
      state.permissions.set(key, granted);
      const row = state.dialog?.querySelector(`.cm-perm[data-key="${CSS_ESCAPE(key)}"]`);
      const input = row?.querySelector(".js-perm");
      if (row && input) {
        setToggleVisual(row, input, granted);
      }
    });
  };

  const syncFilterRows = (status) => {
    if (!state.studyId) return;
    const normalized = String(status || "").toLowerCase();
    const rows = document.querySelectorAll(
      `.cm-row[data-study-id="${CSS_ESCAPE(state.studyId)}"]`
    );
    rows.forEach((row) => {
      row.dataset.status = normalized;
      const badge = row.querySelector(".status");
      if (badge) {
        const label = status
          ? status.charAt(0) + status.slice(1).toLowerCase()
          : "";
        badge.textContent = label;
        badge.className = `status status--${normalized}`;
      }
    });
    document.dispatchEvent(
      new CustomEvent("cm:study-status-changed", {
        detail: { studyId: state.studyId, status }
      })
    );
  };

  const confirmAction = async (message) => {
    const confirm = window.CMConfirm;
    if (typeof confirm === "function") {
      return confirm(message);
    }
    return window.confirm(message);
  };

  const updateEnrollmentStatus = (status) => {
    state.enrollmentStatus = status || "UNENROLLED";
    if (!state.dialog) return;
    state.dialog.dataset.enrollmentStatus = state.enrollmentStatus;
    const primary =
      state.dialog.querySelector(".js-primary") ||
      state.dialog.querySelector("[data-enroll]") ||
      state.dialog.querySelector("[data-unenroll]");
    if (primary) {
      const enrolled = state.enrollmentStatus === "ENROLLED";
      primary.dataset.action = enrolled ? "unenroll" : "enroll";
      primary.textContent = enrolled ? "Unenroll" : "Enroll";
      primary.classList.toggle("cm-btn--danger", enrolled);
      primary.classList.toggle("cm-btn--primary", !enrolled);
      if (enrolled) {
        primary.removeAttribute("data-enroll");
        primary.setAttribute("data-unenroll", "");
        primary.removeAttribute("aria-label");
      } else {
        primary.removeAttribute("data-unenroll");
        primary.setAttribute("data-enroll", "");
        primary.setAttribute("aria-label", "Enroll");
      }
    }
    updatePermissionInteractivity();
    syncFilterRows(state.enrollmentStatus);
  };

  const runPermissionSave = async () => {
    if (state.saving || !state.pending.size) return;
    const payload = { granted: [], declined: [] };
    for (const [key, change] of state.pending.entries()) {
      if (!key) continue;
      if (change.value === change.previous) continue;
      (change.value ? payload.granted : payload.declined).push(key);
    }
    if (!payload.granted.length && !payload.declined.length) {
      state.pending.clear();
      return;
    }
    state.saving = true;
    try {
      const response = await jsonRequest(
        `/participant/studies/${state.studyId}/permissions`,
        { method: "POST", body: payload }
      );
      state.pending.clear();
      applyPermissionsFromServer(response?.permissions);
      if (response?.enrollmentStatus) {
        updateEnrollmentStatus(response.enrollmentStatus);
      }
    } catch (error) {
      state.pending.forEach((change, key) => {
        const fallback = Boolean(change.previous);
        state.permissions.set(key, fallback);
        const row = state.dialog?.querySelector(`.cm-perm[data-key="${CSS_ESCAPE(key)}"]`);
        const input = row?.querySelector(".js-perm");
        if (row && input) {
          setToggleVisual(row, input, fallback);
        }
      });
      state.pending.clear();
      createToast("Couldn't update permissions. Try again.", "error");
    } finally {
      state.saving = false;
    }
  };

  const schedulePermissionSave = () => {
    if (state.saveTimer) clearTimeout(state.saveTimer);
    state.saveTimer = setTimeout(runPermissionSave, 500);
  };

  const handlePermissionChange = (event) => {
    const input = event.currentTarget;
    const row = input.closest(".cm-perm");
    if (!row) return;
    const key = row.dataset.key;
    if (!key) return;
    if (input.dataset.required === "true") {
      input.checked = true;
      return;
    }
    if (input.disabled) {
      input.checked = Boolean(state.permissions.get(key));
      return;
    }

    const current = state.permissions.get(key);
    const next = Boolean(input.checked);
    setToggleVisual(row, input, next);
    if (state.pending.has(key)) {
      const entry = state.pending.get(key);
      entry.value = next;
      if (entry.previous === next) {
        state.pending.delete(key);
      }
    } else {
      state.pending.set(key, { previous: current, value: next });
    }
    state.permissions.set(key, next);
    schedulePermissionSave();
  };

  const getPermissionEntries = () => {
    const rows = Array.from(
      state.dialog?.querySelectorAll(".cm-perm[data-key]") ?? []
    );
    return rows.map((row) => {
      const key = row.dataset.key;
      const input = row.querySelector(".js-perm");
      const label =
        row.querySelector(".cm-perm__title span")?.textContent?.trim() || key;
      return {
        key,
        label,
        checked: Boolean(input?.checked)
      };
    });
  };

  const renderChipHtml = (items, prefix = "") =>
    items
      .map((label) => `<span class="chip">${prefix}${escapeHtml(label)}</span>`)
      .join("");

  const openCompare = (data, selection, versionsHost) => {
    if (!Array.isArray(selection) || selection.length !== 2) {
      return;
    }
    const [aId, bId] = selection;
    const a = data.versions.find((entry) => entry.id === aId);
    const b = data.versions.find((entry) => entry.id === bId);
    if (!a || !b) return;

    const labels = data.labels || {};
    const aSet = new Set(
      Array.isArray(a.ids) ? a.ids.map((id) => String(id)) : []
    );
    const bSet = new Set(
      Array.isArray(b.ids) ? b.ids.map((id) => String(id)) : []
    );
    const allKeys = Array.from(new Set([...aSet, ...bSet]));

    const addedKeys = allKeys.filter((key) => !aSet.has(key) && bSet.has(key));
    const removedKeys = allKeys.filter((key) => aSet.has(key) && !bSet.has(key));

    const rowsHtml = allKeys
      .map((key) => {
        const inA = aSet.has(key);
        const inB = bSet.has(key);
        const rowClass = inA === inB ? "row--same" : "row--diff";
        const label = labels[key] || key;
        const statusA = inA ? "Granted" : "Not granted";
        const statusB = inB ? "Granted" : "Not granted";
        return `
          <div class="diff-row ${rowClass}">
            <span>${escapeHtml(label)}</span>
            <span>v${escapeHtml(String(a.version ?? "–"))}: ${statusA}</span>
            <span>v${escapeHtml(String(b.version ?? "–"))}: ${statusB}</span>
          </div>
        `;
      })
      .join("");

    const diffHref = `/participant/studies/${encodeURIComponent(
      data.studyId
    )}/pdf/diff?vA=${encodeURIComponent(aId)}&vB=${encodeURIComponent(bId)}`;

    const host = document.createElement("section");
    host.className = "cm-diff";
    host.setAttribute("role", "dialog");
    host.setAttribute("aria-modal", "true");
    host.setAttribute("aria-labelledby", "cmp-title");
    host.innerHTML = `
      <div class="cm-diff__card" tabindex="-1">
        <header class="cm-diff__head">
          <h3 id="cmp-title" class="cm-title">Compare ${escapeHtml(
            a.label
          )} ↔ ${escapeHtml(b.label)}</h3>
          <button class="cm-btn cm-btn--ghost" data-close-diff aria-label="Close">×</button>
        </header>
        <div class="cm-diff__summary">
          <span class="chip">+ ${addedKeys.length} added</span>
          <span class="chip">- ${removedKeys.length} removed</span>
        </div>
        <div class="diff-rows">
          ${
            rowsHtml ||
            '<p class="version-meta">Permissions are identical.</p>'
          }
        </div>
        <footer class="cm-diff__footer">
          <button class="cm-btn" data-download-diff>Download diff PDF</button>
          <button class="cm-btn" data-close-diff type="button">Close</button>
        </footer>
      </div>
    `;

    const card = host.querySelector(".cm-diff__card");
    const downloadBtn = host.querySelector("[data-download-diff]");
    const closeButtons = host.querySelectorAll("[data-close-diff]");
    const returnFocus =
      versionsHost?.querySelector("[data-compare]") ||
      versionsHost?.querySelector(`[data-version-checkbox][value="${CSS_ESCAPE(bId)}"]`);

    const close = () => {
      document.removeEventListener("keydown", onKey, true);
      if (card?.__trapDestroy) {
        try {
          card.__trapDestroy();
        } catch {
          /* noop */
        }
      }
      if (host.parentElement) {
        host.parentElement.removeChild(host);
      }
      if (returnFocus && typeof returnFocus.focus === "function") {
        try {
          returnFocus.focus();
        } catch {
          /* noop */
        }
      }
    };

    const onKey = (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        close();
      }
    };

    document.addEventListener("keydown", onKey, true);
    host.addEventListener("click", (event) => {
      if (event.target === host) {
        event.preventDefault();
        close();
      }
    });

    closeButtons.forEach((btn) =>
      btn.addEventListener("click", (event) => {
        event.preventDefault();
        close();
      })
    );

    downloadBtn?.addEventListener("click", (event) => {
      event.preventDefault();
      window.open(diffHref, "_blank", "noopener");
    });

    document.body.appendChild(host);
    trapFocus(card);
    card?.focus({ preventScroll: true });
  };

  const openVersions = async (studyId, source) => {
    let data;
    try {
      data = await jsonRequest(`/participant/studies/${studyId}/versions.json`);
    } catch (error) {
      throw error;
    }

    if (!Array.isArray(data?.versions) || !data.versions.length) {
      createToast("No saved versions yet.", "info");
      return;
    }

    const host = document.createElement("section");
    host.className = "cm-drawer";
    host.setAttribute("role", "dialog");
    host.setAttribute("aria-modal", "true");
    host.setAttribute("aria-labelledby", "sv-title");
    host.innerHTML = `
      <div class="cm-drawer__card" tabindex="-1">
        <header class="cm-drawer__head">
          <h3 id="sv-title" class="cm-title">Saved versions</h3>
          <button class="cm-btn cm-btn--ghost" data-close-versions aria-label="Close">×</button>
        </header>
        <div class="cm-drawer__body js-version-list"></div>
        <footer class="cm-drawer__footer">
          <button class="cm-btn cm-btn--ghost" data-close-versions>Close</button>
          <button class="cm-btn cm-btn--compare" data-compare>Compare</button>
        </footer>
      </div>
    `;

    const card = host.querySelector(".cm-drawer__card");
    const list = host.querySelector(".js-version-list");
    const compareBtn = host.querySelector("[data-compare]");
    const closeButtons = host.querySelectorAll("[data-close-versions]");
    const returnFocus =
      source instanceof HTMLElement
        ? source
        : document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;

    const labels = data.labels || {};
    data.studyId = data.studyId || studyId;

    const selected = new Set();
    const selectionOrder = [];

    const updateCompareState = () => {
      if (!compareBtn) return;
      const ready = selected.size >= 2 && selected.size <= 6;
      compareBtn.classList.toggle("cm-btn--active", ready);
      compareBtn.setAttribute("aria-disabled", ready ? "false" : "true");
      compareBtn.disabled = !ready;
    };

    const handleSelection = (checkbox) => {
      if (!checkbox) return;
      const value = checkbox.value;
      if (!value) return;
      if (checkbox.checked) {
        if (selected.has(value)) {
          updateCompareState();
          return;
        }
        if (selected.size >= 6) {
          checkbox.checked = false;
          createToast("You can compare up to 6 versions.", "info");
          return;
        }
        selected.add(value);
        selectionOrder.push(value);
      } else {
        selected.delete(value);
        const idx = selectionOrder.indexOf(value);
        if (idx >= 0) selectionOrder.splice(idx, 1);
      }
      updateCompareState();
    };

    list.innerHTML = "";
    data.versions.forEach((version) => {
      const chips = Array.isArray(version.chips) && version.chips.length
        ? version.chips
        : (Array.isArray(version.ids) ? version.ids : []).map(
            (id) => labels[id] || id
          );
      const savedText = version.savedAtText || "";
      const meta = savedText
        ? `${escapeHtml(version.label)} • ${escapeHtml(savedText)}`
        : escapeHtml(version.label);
      const chipsHtml = chips.length
        ? renderChipHtml(chips)
        : '<span class="version-meta">No permissions selected</span>';
      const snapshotHref = `/participant/studies/${encodeURIComponent(
        data.studyId
      )}/pdf/snapshot?version=${encodeURIComponent(version.id)}`;

      const item = document.createElement("article");
      item.className = "version-item";
      item.dataset.versionId = version.id;
      item.innerHTML = `
        <div>
          <div class="version-meta">${meta}</div>
          <div class="version-chips">${chipsHtml}</div>
        </div>
        <div class="version-actions">
          <label class="flex gap-1 items-center">
            <input type="checkbox" data-version-checkbox value="${escapeHtml(version.id)}">
            <span>Compare</span>
          </label>
          <a
            class="cm-btn cm-btn--ghost"
            href="${escapeHtml(snapshotHref)}"
            target="_blank"
            rel="noopener"
          >Download</a>
        </div>
      `;
      const checkbox = item.querySelector("[data-version-checkbox]");
      checkbox?.addEventListener("change", () => handleSelection(checkbox));
      list.appendChild(item);
    });

    const close = () => {
      document.removeEventListener("keydown", onKey, true);
      if (card?.__trapDestroy) {
        try {
          card.__trapDestroy();
        } catch {
          /* noop */
        }
      }
      if (host.parentElement) {
        host.parentElement.removeChild(host);
      }
      if (returnFocus && typeof returnFocus.focus === "function") {
        try {
          returnFocus.focus();
        } catch {
          /* noop */
        }
      }
    };

    const onKey = (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        close();
      }
    };

    document.addEventListener("keydown", onKey, true);
    host.addEventListener("click", (event) => {
      if (event.target === host) {
        event.preventDefault();
        close();
      }
    });

    closeButtons.forEach((btn) =>
      btn.addEventListener("click", (event) => {
        event.preventDefault();
        close();
      })
    );

    compareBtn?.addEventListener("click", (event) => {
      event.preventDefault();
      if (selected.size < 2) {
        createToast("Select at least two versions to compare.", "info");
        return;
      }
      if (selected.size > 6) {
        createToast("Please compare six or fewer versions.", "info");
        return;
      }
      const picks =
        selectionOrder.length >= 2
          ? selectionOrder.slice(-2)
          : Array.from(selected).slice(0, 2);
      openCompare(data, picks, host);
    });

    document.body.appendChild(host);
    trapFocus(card);
    card?.focus({ preventScroll: true });
    updateCompareState();
  };

  const appendMessage = (container, role, content, options = {}) => {
    const el = document.createElement("div");
    const roleClass = role === "assistant" ? "cm-chat__msg--ai" : "cm-chat__msg--user";
    el.className = `cm-chat__msg ${roleClass}`;
    el.classList.add("cm-msg", role === "assistant" ? "cm-msg--bot" : "cm-msg--user");
    if (role === "assistant" && options.pending) {
      el.dataset.pending = "true";
      el.innerHTML = '<span class="cm-loading">…</span>';
    } else if (options.asHtml) {
      el.innerHTML = content;
    } else {
      el.textContent = content;
    }
    container.appendChild(el);
    container.scrollTop = container.scrollHeight;
    return el;
  };

  const renderAssistant = (element, markdown) => {
    ensureVendors()
      .then(({ marked, DOMPurify }) => {
        const html = DOMPurify.sanitize(marked.parse(markdown));
        element.innerHTML = html;
      })
      .catch(() => {
        element.textContent = markdown;
      })
      .finally(() => {
        element.removeAttribute("data-pending");
      });
  };

  const handleChat = (dialog) => {
    const chatLog = dialog.querySelector("#cm-chat");
    const form = dialog.querySelector("#cm-chat-form");
    const input = dialog.querySelector("#cm-chat-input");
    const hasCoarsePointer =
      typeof window.matchMedia === "function" &&
      window.matchMedia("(pointer: coarse)").matches;
    const sendBtn = hasCoarsePointer
      ? dialog.querySelector("#cm-chat-send")
      : null;
    if (!chatLog || !form || !input) return;

    const autogrow = () => {
      input.style.height = "auto";
      input.style.height = `${Math.min(input.scrollHeight, 120)}px`;
    };

    input.addEventListener("input", autogrow);
    autogrow();

    const finishStream = (assistantEl, buffer, fallback) => {
      if (state.chatSource) {
        try {
          state.chatSource.close();
        } catch {
          /* noop */
        }
        state.chatSource = null;
      }
      state.streaming = false;
      input.removeAttribute("disabled");
      sendBtn?.removeAttribute("disabled");
      input.focus();
      autogrow();
      assistantEl?.removeAttribute("data-pending");
      if (fallback) {
        renderAssistant(assistantEl, fallback);
      } else if (!buffer) {
        renderAssistant(
          assistantEl,
          "Chat service failed to respond. Please try again later."
        );
      }
    };

    const sendMessage = (question) => {
      const text = question.trim();
      if (!text || state.streaming) return;

      if (state.chatSource) {
        try {
          state.chatSource.close();
        } catch {
          /* noop */
        }
        state.chatSource = null;
      }

      state.streaming = true;
      input.value = "";
      autogrow();
      input.setAttribute("disabled", "true");
      sendBtn?.setAttribute("disabled", "true");

      state.chatHistory.push({ role: "user", content: text });
      appendMessage(chatLog, "user", text);
      const assistantEl = appendMessage(chatLog, "assistant", "", {
        pending: true
      });

      let buffer = "";

      const url = new URL(
        `/participant/studies/${state.studyId}/chat`,
        window.location.origin
      );
      url.searchParams.set("q", text);
      url.searchParams.set("t", Date.now().toString());

      const attemptDelays = [200, 1000, 2000];
      let attempt = 0;

      const fallbackSource = state.dialog?.dataset.chatFallback?.trim() || "";
      const fallbackText = fallbackSource
        ? `Model not available—here’s what we know:\n${fallbackSource}`
        : "Model not available—here’s what we know. Please review the study details above.";

      const startStream = () => {
        const source = new EventSource(url.toString());
        state.chatSource = source;

        source.onmessage = (event) => {
          try {
            const payload = JSON.parse(event.data);
            if (payload?.content) {
              buffer += payload.content;
              renderAssistant(assistantEl, buffer);
              chatLog.scrollTop = chatLog.scrollHeight;
            }
          } catch {
            /* noop */
          }
        };

        source.addEventListener("alert", (event) => {
          let message = fallbackText;
          try {
            const parsed = JSON.parse(event.data);
            if (typeof parsed === "string") message = parsed;
          } catch {
            if (event.data) message = event.data;
          }
          finishStream(assistantEl, buffer, message);
        });

        source.addEventListener("done", () => {
          if (buffer) {
            state.chatHistory.push({ role: "assistant", content: buffer });
          }
          finishStream(assistantEl, buffer);
        });

        source.onerror = () => {
          source.close();
          state.chatSource = null;
          if (!state.streaming) {
            return;
          }
          if (attempt < attemptDelays.length) {
            const delay = attemptDelays[attempt++];
            setTimeout(startStream, delay);
          } else {
            finishStream(assistantEl, buffer, fallbackText);
          }
        };
      };

      startStream();
    };

    form.addEventListener("submit", (event) => {
      event.preventDefault();
      sendMessage(input.value);
    });

    input.addEventListener("keydown", (event) => {
      if (event.key === "Enter" && !event.shiftKey) {
        event.preventDefault();
        sendMessage(input.value);
      }
    });

    sendBtn?.addEventListener("click", () => {
      sendMessage(input.value);
    });
  };

  const wireFooter = (dialog) => {
    const primary =
      dialog.querySelector("[data-enroll]:not([disabled])") ||
      dialog.querySelector("[data-unenroll]:not([disabled])") ||
      dialog.querySelector(".js-primary");
    const saveBtn = dialog.querySelector("#btnSaveVersion") || dialog.querySelector(".js-save-version");
    const versionsBtn = dialog.querySelector(".js-open-versions");
    const downloadBtn = dialog.querySelector("#btnDownload");

    saveBtn?.addEventListener("click", async (event) => {
      event.preventDefault();
      const entries = getPermissionEntries();
      const selected = entries.filter((entry) => entry.checked).map((entry) => entry.key);
      try {
        await jsonRequest(`/participant/studies/${state.studyId}/versions`, {
          method: "POST",
          body: {
            selectedPermissionIds: selected
          }
        });
        createToast("Version saved.", "success");
      } catch (error) {
        createToast(error.message || "Failed to save version.", "error");
      }
    });

    versionsBtn?.addEventListener("click", async (event) => {
      event.preventDefault();
      if (!state.studyId) return;
      try {
        await openVersions(state.studyId, event.currentTarget);
      } catch (error) {
        const message = error?.message || "Couldn't load versions.";
        createToast(message, "error");
      }
    });

    downloadBtn?.addEventListener("click", (event) => {
      event.preventDefault();
      const href = downloadBtn.dataset.downloadHref;
      if (!href) return;
      window.open(href, "_blank", "noopener");
    });

    primary?.addEventListener("click", async (event) => {
      event.preventDefault();
      const action = primary.dataset.action;
      if (!action) return;

      const title =
        state.dialog?.querySelector("#study-modal-title")?.textContent || "this study";
      const message =
        action === "unenroll"
          ? `Unenroll from “${title}”? This revokes access but keeps your consent history.`
          : `Enroll in “${title}”?`;
      const ok = await confirmAction(message);
      if (!ok) return;

      primary.disabled = true;
      try {
        const response = await jsonRequest(
          `/api/studies/${state.studyId}/${action}`,
          { method: "POST" }
        );
        const status = response?.enrollmentStatus || null;
        updateEnrollmentStatus(status);
        createToast(
          action === "unenroll" ? "Unenrolled from study." : "Enrolled successfully.",
          "success"
        );
      } catch {
        createToast("Action failed. Please try again.", "error");
      } finally {
        primary.disabled = false;
      }
    });
  };

  const initModal = (dialog) => {
    state.dialog = dialog;
    state.studyId = dialog.dataset.studyId;
    state.contextVersion = Number(dialog.dataset.contextVersion || Date.now());
    state.enrollmentStatus = dialog.dataset.enrollmentStatus || "UNENROLLED";
    window.__studyId = state.studyId;

    if (!dialog.hasAttribute("tabindex")) {
      dialog.setAttribute("tabindex", "-1");
    }
    trapFocus(dialog);
    dialog.focus({ preventScroll: true });

    dialog.querySelectorAll(".js-perm").forEach((input) => {
      const row = input.closest(".cm-perm");
      const key = input.dataset.permKey;
      if (!row || !key) return;
      const granted = Boolean(input.checked);
      state.permissions.set(key, granted);
      const switcher = row.querySelector(".cm-switch");
      if (switcher) {
        switcher.classList.toggle("is-on", granted);
        switcher.setAttribute("aria-checked", String(granted));
        if (input.dataset.required === "true") {
          switcher.classList.add("is-locked");
          switcher.setAttribute("aria-disabled", "true");
        }
        const triggerToggle = () => {
          if (switcher.classList.contains("is-locked") || input.disabled) {
            return;
          }
          input.checked = !input.checked;
          input.dispatchEvent(new Event("change", { bubbles: false }));
        };
        switcher.addEventListener("click", (event) => {
          event.preventDefault();
          triggerToggle();
        });
        switcher.addEventListener("keydown", (event) => {
          if (event.key !== "Enter" && event.key !== " ") return;
          event.preventDefault();
          triggerToggle();
        });
      }
      input.addEventListener("change", handlePermissionChange);
    });

    updatePermissionInteractivity();
    handleChat(dialog);
    wireFooter(dialog);

    const closeBtn = dialog.querySelector(".js-close");
    closeBtn?.addEventListener("click", (event) => {
      event.preventDefault();
      closeModal();
    });

    dialog.addEventListener("click", (event) => {
      if (event.target === dialog) {
        closeModal();
      }
    });

    const onKey = (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        closeModal();
      }
    };
    state.escapeHandler = onKey;
    document.addEventListener("keydown", onKey, true);
  };

  const loadModalMarkup = async (studyId) => {
    const pageTag = document.body?.dataset?.page || "";
    const isResearcherDash =
      pageTag === "researcher-dash" || window.location.pathname.startsWith("/researcher");
    const basePath = isResearcherDash ? "/researcher/studies" : "/participant/studies";
    const url = `${basePath}/${encodeURIComponent(studyId)}/modal`;
    try {
      const response = await fetch(url, {
        method: "GET",
        headers: {
          Accept: "text/html",
          "X-Requested-With": "XMLHttpRequest"
        },
        credentials: "same-origin",
        cache: "no-store"
      });

      const body = await response.text();

      if (!response.ok) {
        console.error("[study-modal] non-OK", response.status, body.slice(0, 500));
        const error = new Error(`Unable to load study (${response.status})`);
        error.status = response.status;
        error.body = body;
        throw error;
      }

      const loginRedirect =
        body.includes("<form") && body.toLowerCase().includes('action="/login"');
      if (loginRedirect) {
        createToast("Session expired. Please sign in again.", "warn");
        window.location.href = "/login";
        const error = new Error("SESSION_EXPIRED");
        error.handled = true;
        throw error;
      }

      return body;
    } catch (error) {
      if (!error?.handled) {
        console.error("[study-modal] fetch-throw", error);
      }
      throw error;
    }
  };

  const openStudy = async (studyId, source) => {
    try {
      if (state.dialog) {
        closeModal();
      }
      host.innerHTML = "";
      const markup = await loadModalMarkup(studyId);
      host.innerHTML = markup;
      const dialog = host.querySelector(".cm-modal-host");
      if (!dialog) throw new Error("Modal missing");
      state.bodyOverflow = document.body.style.overflow || "";
      document.body.style.overflow = "hidden";
      const focusSource =
        source instanceof HTMLElement
          ? source
          : document.activeElement instanceof HTMLElement
          ? document.activeElement
          : null;
      state.returnFocus = focusSource;
      initModal(dialog);
      window.__studyId = studyId;
    } catch (error) {
      if (error?.handled) {
        return;
      }

      if (typeof error?.status === "number") {
        if (error.body) {
          console.warn("[study-modal] modal load failed", error.status, String(error.body).slice(0, 500));
        }
        createToast(`Unable to load study (${error.status}).`, "error");
      } else {
        createToast("Network error while loading the study.", "error");
      }
      host.innerHTML = "";
      resetState();
    }
  };

  document.addEventListener("click", (event) => {
    const trigger =
      event.target.closest("[data-cm-view-study]") ||
      event.target.closest("[data-view-study-id]") ||
      event.target.closest(".view-study");
    if (!trigger) return;
    event.preventDefault();
    const studyId =
      trigger.dataset.viewStudyId ||
      trigger.dataset.studyId ||
      trigger.getAttribute("data-study-id");
    if (!studyId) {
      console.warn("[study-modal] view trigger missing study id");
      return;
    }
    openStudy(studyId, trigger);
  });

  window.CMStudyModal = {
    openById: (id, source) => openStudy(id, source)
  };
})();
