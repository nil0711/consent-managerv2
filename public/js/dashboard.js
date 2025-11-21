(() => {
  const pageTag = document.body?.dataset?.page || "";
  const isDashPage = pageTag.startsWith("dash-") || pageTag.endsWith("-dash");
  if (!isDashPage) return;

  const trigger = document.getElementById("userMenuTrigger");
  const menu = document.getElementById("userMenu");
  const scrim = document.getElementById("menuScrim");
  if (!trigger || !menu || !scrim) return;

  const open = () => {
    menu.classList.add("open");
    menu.setAttribute("aria-hidden", "false");
    trigger.setAttribute("aria-expanded", "true");
    scrim.hidden = false;
  };

  const close = () => {
    menu.classList.remove("open");
    menu.setAttribute("aria-hidden", "true");
    trigger.setAttribute("aria-expanded", "false");
    scrim.hidden = true;
  };

  trigger.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    if (menu.classList.contains("open")) {
      close();
    } else {
      open();
    }
  });

  scrim.addEventListener("click", close);

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") close();
  });

  window.addEventListener("scroll", close, { passive: true });
  window.addEventListener("resize", close);

  document.addEventListener("click", (event) => {
    if (!menu.contains(event.target) && event.target !== trigger) {
      close();
    }
  });

  menu.addEventListener("click", (event) => {
    const link = event.target.closest(".menu-item");
    if (!link) return;
    event.preventDefault();
    close();

    const href = link.getAttribute("href") || "";
    if (href === "/logout") {
      fetch("/logout", { method: "POST", credentials: "same-origin" })
        .catch(() => {})
        .finally(() => {
          window.location.href = "/login";
        });
      return;
    }

    if (href === "/switch-role") {
      const next =
        window.location.pathname.includes("researcher") ?
          "/participant" :
          "/researcher";
      window.location.href = next;
      return;
    }

    if (href) {
      window.location.href = href;
    }
  });
})();

(() => {
  const http = window.CMHttp;
  if (!http || typeof http.jget !== "function") return;

  const pageTag = document.body?.dataset?.page || "";
  const isDashPage = pageTag.startsWith("dash-") || pageTag.endsWith("-dash");
  if (!isDashPage) return;

  const rail = document.querySelector("[data-trending-rail]");
  if (!rail) return;

  const scroller = rail.querySelector(".cm-pane__scroll");
  const list = rail.querySelector(".cm-list");
  if (!scroller || !list) return;

  const escapeHtml = (value) =>
    String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");

  const existingIds = new Set(
    Array.from(list.querySelectorAll("[data-study-id]")).map(
      (node) => node.dataset.studyId
    )
  );

  let offset = existingIds.size;
  let loading = false;
  let done = false;

  const sentinel = document.createElement("li");
  sentinel.className = "cm-trend-sentinel";
  sentinel.style.minHeight = "1px";
  list.appendChild(sentinel);

  const renderItem = (item) => {
    const id = item?.id;
    if (!id || existingIds.has(id)) return "";
    existingIds.add(id);
    const title = escapeHtml(item.title || "Untitled study");
    const summary = escapeHtml(item.summary || item.snippet || "");
    const tags = Array.isArray(item.tags)
      ? item.tags
          .slice(0, 4)
          .map((tag) => `<span class="cm-chip">${escapeHtml(tag)}</span>`)
          .join(" ")
      : "";
    return `
      <li class="cm-row" data-study-id="${escapeHtml(id)}">
        <div class="cm-row__main">
          <div class="cm-row__title">${title}</div>
          ${
            tags
              ? `<div class="cm-tags">${tags}</div>`
              : ""
          }
          ${
            summary
              ? `<p class="cm-row__snippet">${summary}</p>`
              : ""
          }
        </div>
        <div class="cm-row__actions">
          <button type="button" class="cm-btn cm-btn--ghost view-study" data-view-study-id="${escapeHtml(
            id
          )}" data-study-id="${escapeHtml(id)}">View</button>
        </div>
      </li>
    `;
  };

  const appendItems = (items) => {
    if (!Array.isArray(items) || !items.length) return 0;
    const rendered = items
      .map((item) => renderItem(item))
      .filter(Boolean);
    if (!rendered.length) return 0;
    sentinel.insertAdjacentHTML("beforebegin", rendered.join(""));
    return rendered.length;
  };

  const load = async () => {
    if (loading || done) return;
    loading = true;
    let needsMore = false;
    try {
      const batch = await http.jget(`/api/trending?offset=${offset}&limit=10`);
      if (!Array.isArray(batch) || batch.length === 0) {
        done = true;
        return;
      }
      const appended = appendItems(batch);
      offset += batch.length;
      if (appended === 0 && batch.length > 0) {
        needsMore = true;
      }
    } catch (error) {
      console.warn("Trending rail failed to load:", error);
      done = true;
    } finally {
      loading = false;
      if (needsMore && !done) {
        load();
      }
    }
  };

  load();

  const observer = new IntersectionObserver(
    (entries) => {
      if (entries.some((entry) => entry.isIntersecting)) {
        load();
      }
    },
    { root: scroller, threshold: 1 }
  );

  observer.observe(sentinel);
})();

(() => {
  const pageTag = document.body?.dataset?.page || "";
  const isDashPage = pageTag.startsWith("dash-") || pageTag.endsWith("-dash");
  if (!isDashPage) return;

  const input =
    document.querySelector("[data-studies-search]") ||
    document.getElementById("studiesSearch");
  const list = document.querySelector("[data-studies-list]");
  if (!input || !list) return;

  const rows = Array.from(list.querySelectorAll("[data-study-row]"));
  if (!rows.length) return;

  const dataset = rows.map((row) => ({
    el: row,
    text: (
      (row.dataset.title || "") +
      " " +
      (row.dataset.tags || "") +
      " " +
      (row.dataset.status || "")
    ).toLowerCase()
  }));

  let debounceId = null;

  const update = () => {
    const query = input.value.trim().toLowerCase();
    let shown = 0;
    dataset.forEach(({ el, text }) => {
      const match = !query || text.includes(query);
      el.style.display = match ? "" : "none";
      if (match) shown += 1;
    });
    renderCta(query, shown);
  };

  const renderCta = (query, visible) => {
    const existing = list.querySelector(".js-search-all");
    if (existing) existing.remove();
    if (visible || query.length < 2) return;
    const li = document.createElement("li");
    li.className = "js-search-all dash-list-item cm-row";
    li.innerHTML = `
      <div class="dash-list-main">
        <div class="dash-list-title">No local matches.</div>
        <div class="dash-list-meta">Search all studies?</div>
      </div>
      <div class="dash-list-actions">
        <button type="button" class="cm-btn cm-btn--ghost">Search all</button>
      </div>
    `;
    li.querySelector("button")?.addEventListener("click", () => {
      if (window.CMSearchLite?.open) {
        window.CMSearchLite.open(query);
      } else {
        const globalInput = document.querySelector("[data-global-search-input]");
        if (globalInput) {
          globalInput.value = query;
          globalInput.focus();
        }
      }
    });
    list.appendChild(li);
  };

  input.addEventListener("input", () => {
    clearTimeout(debounceId);
    debounceId = setTimeout(update, 120);
  });
})();

(() => {
  const http = window.CMHttp;
  if (!http || typeof http.jpost !== "function") return;

  const pageTag = document.body?.dataset?.page || "";
  const isDashPage = pageTag.startsWith("dash-") || pageTag.endsWith("-dash");
  if (!isDashPage) return;

  const joinInput = document.querySelector("[data-join-code]");
  const joinButton = document.querySelector("[data-join-btn]");
  if (!joinButton) return;

  const openStudy = (id) => {
    if (!id) return;
    const tryOpen = () => {
      if (window.CMStudyModal && typeof window.CMStudyModal.openById === "function") {
        window.CMStudyModal.openById(id);
      } else {
        setTimeout(tryOpen, 120);
      }
    };
    tryOpen();
  };

  joinButton.addEventListener("click", async () => {
    const raw = joinInput?.value || "";
    const code = raw.trim();
    if (!code) return;
    joinButton.disabled = true;
    try {
      const payload = await http.jpost("/api/studies/join", { code });
      if (payload?.id) {
        joinInput?.classList.remove("cm-input--error");
        openStudy(payload.id);
      }
    } catch (error) {
      console.error("Join by code failed", error);
      joinInput?.classList.add("cm-input--error");
      setTimeout(() => joinInput?.classList.remove("cm-input--error"), 1600);
    } finally {
      joinButton.disabled = false;
    }
  });
})();

(() => {
  const http = window.CMHttp;
  if (!http || typeof http.jget !== "function" || typeof http.jpost !== "function") {
    return;
  }

  const pageTag = document.body?.dataset?.page || "";
  const isDashPage = pageTag.startsWith("dash-") || pageTag.endsWith("-dash");
  if (!isDashPage) return;

  if (document.querySelector("[data-study-modal-host]")) return;

  const sheet = document.getElementById("study-sheet");
  if (!sheet) return;

  const confirm = window.CMConfirm;
  const titleEl = sheet.querySelector("[data-title]");
  const explainerEl = sheet.querySelector("[data-explainer]");
  const permissionsEl = sheet.querySelector("[data-permissions]");
  const primaryBtn = sheet.querySelector(".js-primary");

  const state = {
    current: null
  };

  const escapeHtml = (value) =>
    String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");

  const ensureTagsHtml = (tags) => {
    if (!Array.isArray(tags) || !tags.length) {
      return '<span class="cm-muted">none</span>';
    }
    return tags
      .slice(0, 8)
      .map((tag) => `<span class="cm-chip">${escapeHtml(tag)}</span>`)
      .join(" ");
  };

  const renderPermissions = (permissions) => {
    if (!permissionsEl) return;
    if (!Array.isArray(permissions) || !permissions.length) {
      permissionsEl.innerHTML =
        '<p class="cm-muted">No permissions listed for this study.</p>';
      return;
    }

    permissionsEl.innerHTML = permissions
      .map((perm) => {
        const key = escapeHtml(perm.key || "");
        const label = escapeHtml(perm.label || perm.key || "Permission");
        const required = perm.isRequired ? " disabled" : "";
        const checked = perm.granted ? " checked" : "";
        const suffix = perm.isRequired ? " (required)" : "";
        return `
          <label class="cm-perm">
            <input type="checkbox" data-perm="${key}"${checked}${required}>
            <span>${label}${suffix}</span>
          </label>
        `;
      })
      .join("");
  };

  const updatePrimary = (status) => {
    if (!primaryBtn || !state.current) return;
    const normalized = String(status || "").toUpperCase();
    state.current.enrollmentStatus = normalized;
    if (normalized === "ENROLLED") {
      primaryBtn.textContent = "Unenroll";
      primaryBtn.className = "cm-btn cm-btn--danger js-primary";
      primaryBtn.dataset.action = "unenroll";
    } else {
      primaryBtn.textContent = "Enroll";
      primaryBtn.className = "cm-btn cm-btn--accent js-primary";
      primaryBtn.dataset.action = "enroll";
    }
  };

  const syncRowStatus = (studyId, status) => {
    const rows = document.querySelectorAll(`.cm-row[data-study-id="${CSS.escape(studyId)}"]`);
    rows.forEach((row) => {
      row.dataset.status = String(status || "").toLowerCase();
    });
  };

  const renderStudy = (data) => {
    state.current = data;
    if (titleEl) {
      titleEl.textContent = data.title || "Study";
    }
    if (explainerEl) {
      const summary = data.summary
        ? escapeHtml(data.summary)
        : '<span class="cm-muted">coming soon…</span>';
      const tags = ensureTagsHtml(data.tags);
      explainerEl.innerHTML = `
        <div class="cm-expl">
          <div class="cm-expl__row"><strong>Summary:</strong> ${summary}</div>
          <div class="cm-expl__row"><strong>Tags:</strong> ${tags}</div>
        </div>
      `;
    }
    renderPermissions(data.permissions);
    updatePrimary(data.enrollmentStatus || "UNENROLLED");
  };

  const loadStudy = async (id) => {
    sheet.dataset.studyId = id;
    sheet.classList.add("is-loading");
    try {
      const data = await http.jget(`/api/studies/${id}`);
      renderStudy(data);
    } catch (error) {
      console.error("Failed to load study", error);
      sheet.close();
      alert("Could not load study details. Please try again.");
    } finally {
      sheet.classList.remove("is-loading");
    }
  };

  const performPrimary = async () => {
    if (!state.current || !primaryBtn) return;
    const action = primaryBtn.dataset.action;
    const { id, title } = state.current;
    if (!id || !action) return;

    const confirmMessage =
      action === "unenroll"
        ? `Unenroll from “${title}”? This revokes access but keeps your consent history.`
        : `Enroll in “${title}”?`;

    let ok = true;
    if (typeof confirm === "function") {
      ok = await confirm(confirmMessage);
    } else {
      ok = window.confirm(confirmMessage);
    }
    if (!ok) return;

    primaryBtn.disabled = true;
    try {
      const endpoint =
        action === "unenroll"
          ? `/api/studies/${id}/unenroll`
          : `/api/studies/${id}/enroll`;
      const response = await http.jpost(endpoint);
      const status = response?.enrollmentStatus || "UNENROLLED";
      updatePrimary(status);
      syncRowStatus(id, status);
    } catch (error) {
      console.error("Enrollment action failed", error);
      alert("Could not update enrollment. Please try again.");
    } finally {
      primaryBtn.disabled = false;
    }
  };

  sheet.addEventListener("change", async (event) => {
    if (!state.current) return;
    const input = event.target.closest("input[data-perm]");
    if (!input) return;

    const key = input.dataset.perm;
    const value = input.checked;
    try {
      await http.jpost(
        `/api/studies/${state.current.id}/permissions/${encodeURIComponent(key)}`,
        { granted: value }
      );
      const perm = (state.current.permissions || []).find(
        (row) => row.key === key
      );
      if (perm) perm.granted = value;
    } catch (error) {
      console.error("Permission toggle failed", error);
      input.checked = !value;
    }
  });

  primaryBtn?.addEventListener("click", (event) => {
    event.preventDefault();
    performPrimary();
  });

  sheet.querySelector(".js-versions")?.addEventListener("click", async (event) => {
    event.preventDefault();
    if (!state.current) return;
    try {
      const versions = await http.jget(
        `/api/studies/${state.current.id}/versions`
      );
      if (!Array.isArray(versions) || !versions.length) {
        alert("No consent versions available yet.");
        return;
      }
      const lines = versions.map((entry) => {
        const stamp = entry.createdAt ? new Date(entry.createdAt).toLocaleString() : "unknown";
        return `v${entry.version} – ${stamp}`;
      });
      alert(lines.join("\n"));
    } catch (error) {
      console.error("Failed to load versions", error);
      alert("Could not load versions. Please try again.");
    }
  });

  sheet.querySelector(".js-download")?.addEventListener("click", (event) => {
    event.preventDefault();
    if (!state.current) return;
    window.location.assign(`/api/studies/${state.current.id}/consent/latest`);
  });

  sheet.querySelector(".js-close")?.addEventListener("click", (event) => {
    event.preventDefault();
    sheet.close();
  });

  document.addEventListener("click", (event) => {
    const trigger =
      event.target.closest("[data-view-study-id]") ||
      event.target.closest("[data-study-id]");
    if (!trigger) return;
    const studyId =
      trigger.dataset.viewStudyId ||
      trigger.dataset.studyId ||
      trigger.getAttribute("data-study-id");
    if (!studyId) return;
    event.preventDefault();
    if (!sheet.open) {
      sheet.showModal();
    }
    loadStudy(studyId);
  });
})();
(() => {
  const pageTag = document.body?.dataset?.page || "";
  const isDashPage = pageTag.startsWith("dash-") || pageTag.endsWith("-dash");
  if (!isDashPage) return;

  const stack = document.getElementById("dashStack");
  const studiesCard = document.getElementById("ongoingCard");
  if (!stack || !studiesCard) return;

  const focusStudies = (on) => {
    const isActive = !!on;
    stack.classList.toggle("focus-ongoing", isActive);
    studiesCard.classList.toggle("is-focus", isActive);
  };

  studiesCard.addEventListener("mouseenter", () => focusStudies(true));
  studiesCard.addEventListener("focusin", () => focusStudies(true));
  stack.addEventListener("mouseleave", () => focusStudies(false));
  stack.addEventListener("focusout", () => {
    if (!stack.contains(document.activeElement)) {
      focusStudies(false);
    }
  });
})();

(() => {
  const pane = document.querySelector("[data-studies-pane]");
  if (!pane) return;

  const chipRow = pane.querySelector(".cm-chips");
  const rows = Array.from(pane.querySelectorAll(".cm-row"));
  if (!chipRow || !rows.length) return;

  const filters = ["all", "enrolled", "completed", "withdrawn"];
  let currentFilter = "all";

  const mapStatus = (status) => {
    switch (status) {
      case "enrolled":
        return "enrolled";
      case "completed":
        return "completed";
      case "withdrawn":
      case "unenrolled":
        return "withdrawn";
      default:
        return "other";
    }
  };

  const apply = (filter) => {
    currentFilter = filters.includes(filter) ? filter : "all";
    rows.forEach((row) => {
      const category = mapStatus((row.dataset.status || "").toLowerCase());
      const visible =
        currentFilter === "all" ||
        (category !== "other" && category === currentFilter);
      row.style.display = visible ? "" : "none";
    });

    chipRow
      .querySelectorAll("button[data-filter]")
      .forEach((btn) => btn.classList.toggle("is-active", btn.dataset.filter === currentFilter));
  };

  chipRow.addEventListener("click", (event) => {
    const btn = event.target.closest("button[data-filter]");
    if (!btn) return;
    event.preventDefault();
    apply(btn.dataset.filter);
  });

  document.addEventListener("cm:study-status-changed", () => {
    apply(currentFilter);
  });

  const initial = filters.includes(chipRow.dataset.activeFilter) ?
    chipRow.dataset.activeFilter :
    "all";
  apply(initial);
})();

(() => {
  document.addEventListener("click", async (event) => {
    const btn = event.target.closest(".js-unenroll");
    if (!btn) return;
    event.preventDefault();
    const title = btn.dataset.title || "this study";
    const prompt = `Unenroll from “${title}”?`;
    let confirmed = true;
    if (typeof window.CMConfirm === "function") {
      confirmed = await window.CMConfirm(prompt);
    } else {
      confirmed = window.confirm(prompt);
    }
    if (!confirmed) return;
    const form = btn.closest("form");
    form?.submit();
  });
})();

(() => {
  const pageTag = document.body?.dataset?.page || "";
  if (pageTag !== "dash-participant") return;

  const toast =
    typeof window.cmToast === "function"
      ? window.cmToast
      : typeof window.toast === "function"
        ? window.toast
        : () => {};

  document.querySelectorAll(".js-remove-study").forEach((btn) => {
    btn.addEventListener("click", async (event) => {
      event.preventDefault();
      const url = btn.dataset.url || btn.closest("form")?.action;
      if (!url) return;
      const title = btn.dataset.title || "this study";
      let confirmed = true;
      if (typeof window.showConfirm === "function") {
        confirmed = await window.showConfirm({
          title: "Remove from list?",
          body: `This permanently removes ${title} from your dashboard. This does not withdraw consent already granted.`,
          confirmText: "Remove",
          cancelText: "Cancel"
        });
      } else {
        confirmed = window.confirm(`Remove ${title}?`);
      }
      if (!confirmed) return;
      btn.disabled = true;
      try {
        const response = await fetch(url, {
          method: "POST",
          headers: {
            "X-Requested-With": "fetch",
            Accept: "application/json"
          },
          credentials: "same-origin"
        });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok || !payload?.ok) {
          throw new Error(payload?.error || "Failed to remove study.");
        }
        btn.closest("[data-study-row]")?.remove();
        toast("Removed", "success");
      } catch (error) {
        toast(error?.message || "Failed to remove study.", "error");
        btn.disabled = false;
      }
    });
  });
})();

(() => {
  document.querySelectorAll(".cm-pane__scroll").forEach((scroller) => {
    const update = () => {
      const top = scroller.scrollTop <= 0;
      const bottom =
        scroller.scrollTop + scroller.clientHeight >= scroller.scrollHeight - 1;
      scroller.classList.toggle("is-top", top);
      scroller.classList.toggle("is-bottom", bottom);
    };

    scroller.addEventListener("scroll", update, { passive: true });
    window.addEventListener("resize", update, { passive: true });
    update();
  });
})();

(() => {
  const root = document.documentElement;
  const measure = () => {
    const anchor =
      document.querySelector(".cm-header") ||
      document.querySelector(".dash-header") ||
      document.querySelector("header");
    const rect = anchor ? anchor.getBoundingClientRect() : { bottom: 160 };
    const topPx = Math.max(140, rect.bottom + 12);
    root.style.setProperty("--dash-top", `${topPx}px`);
  };

  measure();
  window.addEventListener("resize", measure, { passive: true });
  window.addEventListener("load", measure);
})();
