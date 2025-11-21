(() => {
  const overlay = document.getElementById("cm-search-lite");
  if (!overlay) return;

  const trigger = document.querySelector("[data-global-search-input]");
  const input = overlay.querySelector("[data-search-lite-input]");
  const results = overlay.querySelector("[data-results]");
  const meta = overlay.querySelector("[data-meta]");
  const body = overlay.querySelector(".cm-search-overlay__body");
  const filters = overlay.querySelector(".cm-search-overlay__filters");

  const PAGE_SIZE = 12;
  const CACHE_TTL = 60 * 1000;
  const cache = new Map();

  const escapeSelector = (value = "") => {
    if (window.CSS && typeof window.CSS.escape === "function") {
      return window.CSS.escape(value);
    }
    return String(value).replace(/[^a-zA-Z0-9_\-]/g, "\\$&");
  };

  let sort = "relevance";
  let controller = null;
  let loading = false;
  let done = false;
  let offset = 0;
  let total = 0;
  let fetched = 0;
  let activeIndex = -1;
  let lastQuery = "";

  const escapeHtml = (value = "") =>
    String(value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");

  const mark = (text, query) => {
    if (!text) return "";
    if (!query) return escapeHtml(text);
    const escaped = escapeHtml(text);
    try {
      const pattern = query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      return escaped.replace(
        new RegExp(`(${pattern})`, "gi"),
        "<span class=\"cm-mark\">$1</span>"
      );
    } catch {
      return escaped;
    }
  };

  const pageTag = document.body?.dataset?.page || "";
  const searchScope = pageTag === "researcher-dash" ? "mine" : "";

  const cacheKey = (query, sortValue, pageOffset) =>
    `${searchScope || "global"}::${sortValue}::${pageOffset}::${query}`;

  const setCache = (key, data) => {
    cache.set(key, { data, expires: Date.now() + CACHE_TTL });
  };

  const getCache = (key) => {
    const entry = cache.get(key);
    if (!entry) return null;
    if (entry.expires < Date.now()) {
      cache.delete(key);
      return null;
    }
    return entry.data;
  };

  const openOverlay = (seed = "") => {
    overlay.hidden = false;
    document.body.classList.add("cm-search-lite-open");
    input.value = seed;
    input.focus();
    resetState(seed.trim());
    if (seed.trim().length) {
      fetchPage(true);
    } else {
      renderPlaceholder();
    }
  };

  const closeOverlay = () => {
    overlay.hidden = true;
    document.body.classList.remove("cm-search-lite-open");
    cancelPending();
    clearResults();
  };

  const cancelPending = () => {
    if (controller) {
      controller.abort();
      controller = null;
    }
  };

  const resetState = (query) => {
    cancelPending();
    lastQuery = query;
    loading = false;
    done = false;
    offset = 0;
    fetched = 0;
    total = 0;
    activeIndex = -1;
    results.innerHTML = "";
    meta.textContent = "";
  };

  const renderPlaceholder = () => {
    results.innerHTML = `<div class="cm-search-item"><em>Type to search studies.</em></div>`;
    meta.textContent = "";
  };

  const clearResults = () => {
    results.innerHTML = "";
    meta.textContent = "";
    fetched = 0;
    total = 0;
  };

  const loaderRow = () =>
    `<div class="cm-search-item"><em>Searching…</em></div>`;
  const emptyRow = (query) =>
    `<div class="cm-search-item"><em>No results for “${escapeHtml(query)}”.</em></div>`;
  const errorRow = () =>
    `<div class="cm-search-item"><em>Network error. Try again.</em></div>`;

  const renderItem = (item, idx) => {
    const el = document.createElement("div");
    el.className = "cm-search-item";
    el.dataset.index = String(idx);
    el.dataset.studyId = item.id;
    el.setAttribute("role", "option");
    const snippet = (item.snippet || "").slice(0, 200);
    const ownerLine = [item.researcherName, item.institution]
      .filter(Boolean)
      .join(" • ");
    const dateLabel = item.createdAt
      ? new Date(item.createdAt).toLocaleDateString()
      : "";
    const tagChips = (item.tags || [])
      .slice(0, 4)
      .map((tag) => `<span class="cm-tag">${escapeHtml(tag)}</span>`)
      .join("");
    const permissionChips = (item.permissions || [])
      .map((perm) => `<span class="cm-tag">${mark(perm, lastQuery)}</span>`)
      .join("");
    const codeChip = item.code
      ? `<span class="cm-tag">Code: ${escapeHtml(item.code)}</span>`
      : "";

    el.innerHTML = `
      <div class="grow">
        <div><strong>${mark(item.title || "Untitled study", lastQuery)}</strong></div>
        <div class="cm-search-item__meta">
          ${
            ownerLine
              ? `${escapeHtml(ownerLine)} • `
              : `${escapeHtml(item.researcherName || "Research team")} • `
          }${escapeHtml(
      item.status || "Status unknown"
    )} • ${escapeHtml(dateLabel)}
        </div>
        ${
          snippet
            ? `<div class="cm-search-item__meta">${mark(snippet, lastQuery)}</div>`
            : ""
        }
        ${
          tagChips || permissionChips || codeChip
            ? `<div class="cm-search-item__meta cm-search-item__meta--tags">${codeChip}${tagChips}${permissionChips}</div>`
            : ""
        }
      </div>
      <button type="button" class="cm-btn cm-btn--ghost" data-view="${escapeHtml(
        item.id
      )}">View</button>
    `;
    el.addEventListener("mouseenter", () => setActive(parseInt(el.dataset.index, 10)));
    el.addEventListener("click", (event) => {
      const btn = event.target.closest("[data-view]");
      if (!btn) return;
      openStudy(btn.dataset.view);
    });
    return el;
  };

  const setActive = (index) => {
    const nodes = results.querySelectorAll(".cm-search-item");
    nodes.forEach((node) => node.classList.remove("is-active"));
    if (index < 0 || index >= nodes.length) {
      activeIndex = -1;
      return;
    }
    activeIndex = index;
    const node = nodes[index];
    node.classList.add("is-active");
    node.scrollIntoView({ block: "nearest" });
  };

  const activateActive = () => {
    if (activeIndex < 0) return;
    const activeNode = results.querySelector(
      `.cm-search-item[data-index="${activeIndex}"]`
    );
    if (!activeNode) return;
    const id = activeNode.dataset.studyId;
    if (id) openStudy(id);
  };

  const openStudy = (id) => {
    closeOverlay();
    if (window.CMStudyModal?.openById) {
      window.CMStudyModal.openById(id);
      return;
    }
    const triggerBtn = document.querySelector(
      `[data-view-study-id="${escapeSelector(id)}"]`
    );
    triggerBtn?.click();
  };

  const fetchPage = async (reset = false) => {
    const query = input.value.trim();
    if (!query) {
      renderPlaceholder();
      return;
    }
    if (loading || done) return;
    if (reset) {
      resetState(query);
    }

    const params = new URLSearchParams({
      q: query,
      limit: String(PAGE_SIZE),
      offset: String(offset),
      sort
    });
    if (searchScope) {
      params.set("scope", searchScope);
    }
    const key = cacheKey(query, sort, offset);
    const cached = getCache(key);

    if (reset) {
      results.innerHTML = loaderRow();
    }

    if (cached) {
      appendResults(cached, reset);
      return;
    }

    try {
      controller = new AbortController();
      loading = true;
      const resp = await fetch(`/api/search-lite?${params.toString()}`, {
        signal: controller.signal
      });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const data = await resp.json();
      setCache(key, data);
      appendResults(data, reset);
    } catch (error) {
      if (error.name === "AbortError") return;
      results.innerHTML = errorRow();
      meta.textContent = "";
    } finally {
      loading = false;
    }
  };

  const appendResults = (data, reset) => {
    const { items = [], total: count = 0 } = data || {};
    if (reset) {
      results.innerHTML = "";
      activeIndex = -1;
    }
    total = count;
    fetched += items.length;
    if (items.length) {
      const fragment = document.createDocumentFragment();
      items.forEach((item, idx) =>
        fragment.appendChild(renderItem(item, offset + idx))
      );
      results.appendChild(fragment);
      offset += items.length;
    }
    if (!items.length && reset) {
      results.innerHTML = emptyRow(lastQuery);
    }
    meta.textContent = total
      ? `${Math.min(fetched, total)} of ${total} results`
      : "No results";
    if (offset >= total || !items.length) {
      done = true;
    }
  };

  const handleScroll = () => {
    if (overlay.hidden || done || loading) return;
    const threshold = 80;
    if (
      body.scrollTop + body.clientHeight >=
      body.scrollHeight - threshold
    ) {
      fetchPage(false);
    }
  };

  body.addEventListener("scroll", handleScroll);

  overlay.addEventListener("click", (event) => {
    if (event.target.hasAttribute("data-close")) {
      closeOverlay();
    }
  });

  filters?.addEventListener("click", (event) => {
    const btn = event.target.closest("button[data-sort]");
    if (!btn) return;
    if (btn.dataset.sort === sort) return;
    filters.querySelectorAll("button").forEach((node) =>
      node.classList.toggle("is-active", node === btn)
    );
    sort = btn.dataset.sort;
    fetchPage(true);
  });

  input.addEventListener("input", () => {
    done = false;
    fetched = 0;
    offset = 0;
    fetchPage(true);
  });

  input.addEventListener("keydown", (event) => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      moveActive(1);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      moveActive(-1);
    } else if (event.key === "Enter" && activeIndex >= 0) {
      event.preventDefault();
      activateActive();
    }
  });

  const moveActive = (delta) => {
    const nodes = results.querySelectorAll(".cm-search-item");
    if (!nodes.length) {
      activeIndex = -1;
      return;
    }
    let next = activeIndex + delta;
    if (next < 0) next = nodes.length - 1;
    if (next >= nodes.length) next = 0;
    setActive(next);
  };

  document.addEventListener("keydown", (event) => {
    if (overlay.hidden) {
      if (
        event.key === "/" &&
        !event.metaKey &&
        !event.ctrlKey &&
        !event.altKey &&
        !/(input|textarea|select)/i.test(event.target.tagName || "")
      ) {
        event.preventDefault();
        trigger?.focus();
      }
      return;
    }
    if (event.key === "Escape") {
      closeOverlay();
    } else if (event.key === "ArrowDown") {
      event.preventDefault();
      moveActive(1);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      moveActive(-1);
    } else if (event.key === "Enter" && activeIndex >= 0 && event.target !== input) {
      event.preventDefault();
      activateActive();
    }
  });

  const triggerHandler = (event) => {
    event.preventDefault();
    openOverlay(trigger.value);
    trigger.blur();
  };

  trigger?.addEventListener("focus", triggerHandler);
  trigger?.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      triggerHandler(event);
    }
  });

  window.CMSearchLite = {
    open: (seed = "") => openOverlay(seed)
  };
})();
