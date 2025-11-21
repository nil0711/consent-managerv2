(() => {
  const pageTag = document.body?.dataset?.page || "";
  if (pageTag !== "researcher-dash") return;

  const fetcher =
    window.fetchJSON ||
    (async (url, opts = {}) => {
      const response = await fetch(url, {
        credentials: "same-origin",
        headers: { "Content-Type": "application/json", ...(opts.headers || {}) },
        ...opts
      });
      const data = await response.json();
      if (!response.ok || data?.ok === false) {
        throw new Error(data?.error || response.statusText);
      }
      return data;
    });

  const toast = (() => {
    let root = document.getElementById("toast-root");
    if (!root) {
      root = document.createElement("div");
      root.id = "toast-root";
      root.className = "cm-toast-stack";
      document.body.appendChild(root);
    }
    return (message, variant = "info") => {
      if (!root) return;
      const node = document.createElement("div");
      node.className = `cm-toast cm-toast--${variant}`;
      node.textContent = message;
      root.appendChild(node);
      requestAnimationFrame(() => {
        node.classList.add("is-visible");
      });
      setTimeout(() => {
        node.classList.remove("is-visible");
        setTimeout(() => node.remove(), 220);
      }, 2800);
    };
  })();
  window.cmToast = toast;

  const shareCooldown = new Map();
  const SHARE_COOLDOWN_MS = 1500;

  const copyCode = async (code) => {
    if (!code) return;
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(code);
      return;
    }
    const input = document.createElement("input");
    input.type = "text";
    input.value = code;
    document.body.appendChild(input);
    input.select();
    document.execCommand("copy");
    document.body.removeChild(input);
  };

  const handleShareClick = async (button) => {
    const code = button?.dataset?.shareCode || button?.dataset?.code;
    if (!code) return;
    const now = Date.now();
    const last = shareCooldown.get(code) || 0;
    if (now - last < SHARE_COOLDOWN_MS) return;
    shareCooldown.set(code, now);
    try {
      await copyCode(code);
      toast("Study code copied", "success");
    } catch (error) {
      console.warn("share copy failed", error);
      toast("Unable to copy code", "error");
    }
  };

  document.addEventListener("click", (event) => {
    const shareBtn = event.target.closest("[data-share-code]");
    if (shareBtn) {
      event.preventDefault();
      handleShareClick(shareBtn);
    }
  });

  const openStudy = (id, trigger) => {
    if (!id || !window.cmOpenResearcherStudy) return;
    window.cmOpenResearcherStudy(id, trigger || null);
  };

  const studiesContainer = document.querySelector("[data-studies-container]");
  const getStudyList = () => document.querySelector("[data-studies-list]");

  const renderStudyRow = (study) => {
    if (!studiesContainer || !study?.id) return null;
    const li = document.createElement("li");
    li.className = "dash-list-item cm-row cm-study-card";
    li.dataset.studyId = study.id;
    li.dataset.researcherCard = study.id;
    li.dataset.status = (study.status || "").toLowerCase();
    li.dataset.title = study.title || "Untitled";
    li.dataset.tags = (study.tags || []).join(",");
    li.dataset.summary = study.summary || "";
    li.dataset.code = study.joinCode || "";
    li.dataset.studyRow = "";
    li.innerHTML = `
      <div class="dash-list-main">
        <div class="dash-list-title cm-title cm-line-clamp-2">${study.title || "Untitled study"}</div>
        <div class="dash-list-meta cm-meta">
          <span class="status status--${(study.status || "").toLowerCase()}">${study.status || ""}</span>
          • 0 participants
        </div>
      </div>
      <div class="dash-list-actions cm-actions">
        <button
          type="button"
          class="cm-btn cm-btn--ghost"
          data-cm-view-study
          data-view-study-id="${study.id}"
          data-study-id="${study.id}">View</button>
        <button type="button" class="cm-btn cm-btn--ghost" data-share-code="${study.joinCode || ""}" data-study-title="${study.title || "Study"}">Share</button>
      </div>
    `;
    return li;
  };

  const prependStudyRow = (study) => {
    const row = renderStudyRow(study);
    if (!row) return;
    let list = getStudyList();
    if (!list) {
      list = document.createElement("ul");
      list.className = "dash-list";
      list.dataset.studiesList = "";
      studiesContainer.innerHTML = "";
      studiesContainer.appendChild(list);
    }
    list.prepend(row);
  };

  const createButton = document.querySelector("[data-act='create-study']");

  const openCreateModal = () => {
    if (!createButton) return;
    const overlay = document.createElement("div");
    overlay.className = "rs-create";
    overlay.innerHTML = `
      <div class="rs-create__dialog" role="dialog" aria-modal="true" aria-label="Create study">
        <form class="rs-create__form">
          <h3>Create study</h3>
          <label>
            <span>Title</span>
            <input type="text" name="title" required maxlength="140" placeholder="Name your study">
          </label>
          <label>
            <span>Summary <small>(optional)</small></span>
            <textarea name="summary" rows="3" maxlength="280" placeholder="One-line context for collaborators"></textarea>
          </label>
          <div class="rs-create__actions">
            <button type="button" class="cm-btn cm-btn--ghost" data-act="cancel-create">Cancel</button>
            <button type="submit" class="cm-btn cm-btn--primary">Create</button>
          </div>
        </form>
      </div>
    `;
    document.body.appendChild(overlay);
    const form = overlay.querySelector("form");
    const titleInput = form.querySelector("input[name='title']");
    titleInput.focus();

    const close = () => {
      overlay.removeEventListener("click", onOverlayClick);
      document.removeEventListener("keydown", onKeydown);
      overlay.remove();
    };

    const onOverlayClick = (event) => {
      if (event.target === overlay || event.target.closest("[data-act='cancel-create']")) {
        event.preventDefault();
        close();
      }
    };

    const onKeydown = (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        close();
      }
    };

    overlay.addEventListener("click", onOverlayClick);
    document.addEventListener("keydown", onKeydown);

    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      const submitBtn = form.querySelector("button[type='submit']");
      submitBtn.disabled = true;
      const payload = {
        title: titleInput.value.trim(),
        summary: form.querySelector("textarea[name='summary']").value.trim()
      };
      if (!payload.title) {
        submitBtn.disabled = false;
        titleInput.focus();
        return;
      }
      try {
        const response = await fetcher("/researcher/api/studies", {
          method: "POST",
          body: JSON.stringify(payload)
        });
        const study = response?.study;
        if (study) {
          prependStudyRow(study);
          toast(`Study created • CODE ${study.joinCode}`, "success");
          openStudy(study.id);
        }
        close();
      } catch (error) {
        console.error("create study failed", error);
        toast(error?.message || "Unable to create study", "error");
        submitBtn.disabled = false;
      }
    });
  };

  createButton?.addEventListener("click", openCreateModal);
})();
