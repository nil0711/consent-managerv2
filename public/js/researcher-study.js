(() => {
  const page = document.body?.dataset?.page;
  if (page !== "researcher-dash") return;

  const host = document.querySelector("[data-study-modal-host]");
  if (!host) return;

  const toast =
    typeof window.cmToast === "function" ? window.cmToast : (message) => window.alert(message);

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
        throw new Error(data?.error || response.statusText || "Request failed");
      }
      return data;
    });

  const STATE = {
    returnFocus: null,
    overflow: null
  };

  const ESCAPE_LOOKUP = {
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  };

  const escapeHtml = (value = "") =>
    String(value).replace(/[&<>"']/g, (char) => ESCAPE_LOOKUP[char] || char);

  const escapeAttr = (value = "") => escapeHtml(value).replace(/"/g, "&quot;");

  const restoreBodyScroll = () => {
    if (STATE.overflow !== null) {
      document.body.style.overflow = STATE.overflow || "";
      STATE.overflow = null;
    }
  };

  const onKeydown = (event) => {
    if (event.key === "Escape") {
      event.preventDefault();
      closeModal();
    }
  };

  const closeModal = () => {
    host.innerHTML = "";
    document.removeEventListener("keydown", onKeydown, true);
    restoreBodyScroll();
    if (STATE.returnFocus && typeof STATE.returnFocus.focus === "function") {
      try {
        STATE.returnFocus.focus();
      } catch {
        /* noop */
      }
    }
    STATE.returnFocus = null;
  };

  const fetchModal = async (studyId) => {
    const response = await fetch(`/researcher/studies/${encodeURIComponent(studyId)}/modal`, {
      method: "GET",
      credentials: "same-origin",
      headers: {
        "X-Requested-With": "XMLHttpRequest"
      }
    });
    const body = await response.text();
    if (!response.ok) {
      throw new Error(body || "Unable to load study");
    }
    return body;
  };

  const openModal = async (studyId, trigger) => {
    if (!studyId) return;
    try {
      const markup = await fetchModal(studyId);
      host.innerHTML = markup;
      const modal = host.querySelector("[data-researcher-study-modal]");
      if (!modal) {
        throw new Error("Modal failed to render");
      }
      STATE.returnFocus = trigger instanceof HTMLElement ? trigger : null;
      STATE.overflow = document.body.style.overflow || "";
      document.body.style.overflow = "hidden";
      document.addEventListener("keydown", onKeydown, true);
      bindModal(modal, studyId);
    } catch (error) {
      host.innerHTML = "";
      restoreBodyScroll();
      toast(error?.message || "Unable to open study");
    }
  };

  const toggleButtonState = (button, disabled) => {
    if (!button) return;
    button.disabled = disabled;
    button.classList.toggle("is-busy", disabled);
  };

  const saveFlags = async (studyId, permId, delta) =>
    fetcher(`/researcher/api/studies/${studyId}/permissions/${permId}/flags`, {
      method: "POST",
      body: JSON.stringify(delta)
    });

  const updateArchiveState = (modal, updatedStudy) => {
    const archived = updatedStudy?.status === "ARCHIVED";
    modal.dataset.archived = archived ? "true" : "false";
    const archiveBtn = modal.querySelector('[data-act="archive"]');
    const unarchiveBtn = modal.querySelector('[data-act="unarchive"]');
    archiveBtn?.classList.toggle("is-hidden", archived);
    unarchiveBtn?.classList.toggle("is-hidden", !archived);
    const statusNode = modal.querySelector("[data-study-status-label]");
    if (statusNode) {
      statusNode.textContent =
        updatedStudy?.statusLabel || (archived ? "Archived" : "Active");
    }
  };

  const updateListRow = (study) => {
    const studyId = study?.id;
    if (!studyId) return;
    const selector = `[data-study-id="${CSS.escape(studyId)}"]`;
    const row = document.querySelector(selector);
    if (!row) return;
    if (row.dataset) {
      row.dataset.status = study.status?.toLowerCase() || "";
    }
    const statusNode = row.querySelector(".status");
    if (statusNode) {
      statusNode.textContent = study.statusLabel || study.status || "";
      statusNode.className = `status status--${study.status?.toLowerCase() || ""}`;
    }
  };

  const removeListRow = (studyId) => {
    const selector = `[data-study-id="${CSS.escape(studyId)}"]`;
    document.querySelector(selector)?.remove();
  };

  const bindModal = (modal, studyId) => {
    modal.addEventListener("click", (event) => {
      if (event.target === modal) {
        closeModal();
      }
    });

    modal.querySelector('[data-act="close"]')?.addEventListener("click", closeModal);

    const archiveBtn = modal.querySelector('[data-act="archive"]');
    archiveBtn?.addEventListener("click", async () => {
      toggleButtonState(archiveBtn, true);
      try {
        const payload = await fetcher(`/researcher/api/studies/${studyId}/archive`, { method: "POST" });
        if (payload?.study) {
          updateArchiveState(modal, payload.study);
          updateListRow(payload.study);
        }
        toast("Study archived");
      } catch (error) {
        toast(error?.message || "Unable to archive study");
      } finally {
        toggleButtonState(archiveBtn, false);
      }
    });

    const unarchiveBtn = modal.querySelector('[data-act="unarchive"]');
    unarchiveBtn?.addEventListener("click", async () => {
      toggleButtonState(unarchiveBtn, true);
      try {
        const payload = await fetcher(`/researcher/api/studies/${studyId}/unarchive`, { method: "POST" });
        if (payload?.study) {
          updateArchiveState(modal, payload.study);
          updateListRow(payload.study);
        }
        toast("Study unarchived");
      } catch (error) {
        toast(error?.message || "Unable to unarchive study");
      } finally {
        toggleButtonState(unarchiveBtn, false);
      }
    });

    const cloneBtn = modal.querySelector('[data-act="clone"]');
    cloneBtn?.addEventListener("click", async () => {
      toggleButtonState(cloneBtn, true);
      try {
        await fetcher(`/researcher/studies/${studyId}/clone`, { method: "POST" });
        toast("Study cloned");
      } catch (error) {
        toast(error?.message || "Unable to clone study");
      } finally {
        toggleButtonState(cloneBtn, false);
      }
    });

    modal.querySelector('[data-act="export"]')?.addEventListener("click", () => {
      window.open(
        `/researcher/api/studies/${encodeURIComponent(studyId)}/export?format=csv`,
        "_blank",
        "noopener"
      );
    });

    const dropBtn = modal.querySelector('[data-act="drop"]');
    dropBtn?.addEventListener("click", async () => {
      const confirmText = window.prompt('Type "DROP" to confirm drop');
      if ((confirmText || "").trim().toUpperCase() !== "DROP") return;
      toggleButtonState(dropBtn, true);
      try {
        await fetcher(`/researcher/api/studies/${studyId}`, { method: "DELETE" });
        toast("Study dropped");
        removeListRow(studyId);
        closeModal();
      } catch (error) {
        toast(error?.message || "Unable to remove study");
      } finally {
        toggleButtonState(dropBtn, false);
      }
    });

    bindPermissionEditing(modal, studyId);
  };

  const bindPermissionEditing = (modal, studyId) => {
    const editToggle = modal.querySelector("[data-perm-edit]");
    if (editToggle) {
      editToggle.addEventListener("change", () => {
        enableEditMode(modal, editToggle.checked);
      });
    }
    enableEditMode(modal, false);

    modal.querySelectorAll("input[data-toggle]").forEach((input) => {
      bindToggleInput(input, studyId, modal);
    });

    const isArchived = modal.dataset.archived === "true";
    if (!isArchived) {
      setupPermissionSearch(modal, studyId);
    }
  };

  const enableEditMode = (modal, isOn) => {
    modal.classList.toggle("is-edit", isOn);
    modal.querySelectorAll("input[data-toggle]").forEach((input) => {
      input.disabled = !isOn;
      const wrap = input.closest("[data-perm-toggles]");
      if (wrap) {
        wrap.classList.toggle("is-hidden", !isOn);
      }
    });
  };

  const bindToggleInput = (input, studyId, modal) => {
    if (!input || input.dataset.bound === "true") return;
    input.dataset.bound = "true";
    input.addEventListener("change", async () => {
      const permId = input.dataset.perm;
      const field = input.dataset.toggle;
      if (!permId || !field) return;
      const value = input.checked;
      const item = input.closest("[data-perm-item]");
      updatePillState(item, field, value);
      input.classList.add("is-saving");
      try {
        const payload = await saveFlags(studyId, permId, {
          [field === "required" ? "required" : "sensitive"]: value
        });
        if (payload?.ok) {
          updatePillState(item, "required", payload.required);
          updatePillState(item, "sensitive", payload.sensitive);
        }
      } catch (error) {
        input.checked = !value;
        updatePillState(item, field, input.checked);
        toast(error?.message || "Unable to save change");
      } finally {
        input.classList.remove("is-saving");
      }
    });
  };

  const updatePillState = (item, field, active) => {
    if (!item) return;
    const pill = item.querySelector(`[data-pill="${field}"]`);
    pill?.classList.toggle("cm-chip--on", Boolean(active));
  };

  const setupPermissionSearch = (modal, studyId) => {
    const search = modal.querySelector("#perm-search");
    const dropdown = modal.querySelector("[data-perm-suggest]");
    const createPrompt = modal.querySelector("[data-perm-create]");
    const createLabel = modal.querySelector("[data-perm-create-label]");
    const createConfirmBtn = modal.querySelector('[data-act="perm-create-confirm"]');
    const createCancelBtn = modal.querySelector('[data-act="perm-create-cancel"]');
    if (!search || !dropdown || !createPrompt) return;

    let debounceId = null;
    let pendingCreate = "";

    const hideSuggestions = () => {
      dropdown.classList.add("is-hidden");
      dropdown.innerHTML = "";
    };

    const showCreatePrompt = (title) => {
      pendingCreate = title;
      if (createLabel) {
        createLabel.textContent = `Create "${title}"?`;
      }
      createPrompt.classList.remove("is-hidden");
    };

    const hideCreatePrompt = () => {
      pendingCreate = "";
      createPrompt.classList.add("is-hidden");
    };

    const addCustomPermission = async (title) => {
      const payload = await fetcher(`/researcher/api/studies/${studyId}/permissions`, {
        method: "POST",
        body: JSON.stringify({ title })
      });
      if (payload?.permission) {
        prependPermissionCard(modal, payload.permission, studyId);
        toast("Permission added");
      }
    };

    const handleResults = (results) => {
      if (!results.length) {
        hideSuggestions();
        return;
      }
      dropdown.innerHTML = results
        .map((item) => {
          const attrs = `data-template="${escapeAttr(item.id)}" data-title="${escapeAttr(item.title)}" data-source="${escapeAttr(item.source || "custom")}"`;
          return `
            <div class="perm-suggest__item" ${attrs}>
              <div class="perm-suggest__item-title">${escapeHtml(item.title)}</div>
              <div class="perm-suggest__item-kind">${escapeHtml(item.source || "custom")}</div>
            </div>`;
        })
        .join("");
      dropdown.classList.remove("is-hidden");
    };

    search.addEventListener("input", () => {
      const query = search.value.trim();
      clearTimeout(debounceId);
      hideCreatePrompt();
      if (!query) {
        hideSuggestions();
        return;
      }
      debounceId = setTimeout(async () => {
        try {
          const data = await fetcher(
            `/researcher/api/permissions/search?q=${encodeURIComponent(query)}`
          );
          handleResults(data?.results || []);
        } catch (error) {
          hideSuggestions();
          console.warn("[permissions] search failed", error);
        }
      }, 200);
    });

    search.addEventListener("keydown", (event) => {
      if (event.key !== "Enter") return;
      const query = search.value.trim();
      if (!query) return;
      event.preventDefault();
      hideSuggestions();
      showCreatePrompt(query);
    });

    dropdown.addEventListener("click", async (event) => {
      const item = event.target.closest(".perm-suggest__item");
      if (!item) return;
      const templateId = item.dataset.template || "";
      const title = item.dataset.title || "";
      try {
        const payload = await fetcher(`/researcher/api/studies/${studyId}/permissions`, {
          method: "POST",
          body: JSON.stringify(
            templateId ? { permissionId: templateId } : { title }
          )
        });
        if (payload?.permission) {
          prependPermissionCard(modal, payload.permission, studyId);
          toast("Permission added");
        }
      } catch (error) {
        toast(error?.message || "Unable to add permission");
      } finally {
        search.value = "";
        hideSuggestions();
        hideCreatePrompt();
      }
    });

    createConfirmBtn?.addEventListener("click", async () => {
      const title = pendingCreate.trim();
      if (!title) return;
      createConfirmBtn.disabled = true;
      try {
        await addCustomPermission(title);
        search.value = "";
        hideCreatePrompt();
      } catch (error) {
        toast(error?.message || "Unable to add permission");
      } finally {
        createConfirmBtn.disabled = false;
      }
    });

    createCancelBtn?.addEventListener("click", () => {
      hideCreatePrompt();
    });

    modal.addEventListener("click", (event) => {
      if (!event.target.closest(".perm-toolbar__search")) {
        hideSuggestions();
        hideCreatePrompt();
      }
    });
  };

  const normalizePermissionPayload = (permission) => {
    const permId = permission.permissionId || permission.id;
    return {
      id: permId,
      linkId: permission.linkId || permission.studyPermissionId,
      slug: permission.slug || permission.permissionSlug || "",
      label: permission.title || permission.label || "Permission",
      description: permission.description || "",
      blurb: permission.blurb || "",
      required: Boolean(permission.flags?.required ?? permission.required),
      sensitive: Boolean(permission.flags?.sensitive ?? permission.sensitive)
    };
  };

  const prependPermissionCard = (modal, permission, studyId) => {
    const scroll = modal.querySelector("[data-perms-scroll]");
    if (!scroll || !permission) return;

    let list = scroll.querySelector("[data-perm-list]");
    if (!list) {
      list = document.createElement("ul");
      list.className = "cm-perms";
      list.dataset.permList = "";
      scroll.innerHTML = "";
      scroll.appendChild(list);
    }

    const empty = scroll.querySelector("[data-perm-empty]");
    empty?.remove();

    const li = document.createElement("li");
    const permData = normalizePermissionPayload(permission);

    li.className = "cm-perm cm-perm--readonly is-new";
    li.dataset.permItem = "";
    li.dataset.permId = permData.id;
    if (permData.slug) {
      li.dataset.permSlug = permData.slug;
    }
    if (permData.linkId) {
      li.dataset.permLink = permData.linkId;
    }
    const badges = [
      permData.required ? '<span class="cm-badge">required</span>' : "",
      permData.sensitive ? '<span class="cm-badge cm-badge--warn">sensitive</span>' : ""
    ].join("");

    li.innerHTML = `
      <div class="cm-perm__meta">
        <div class="cm-perm__title">
          <span>${escapeHtml(permData.label)}</span>
          <div class="cm-perm__badges">${badges}</div>
        </div>
        ${permData.blurb ? `<p class="cm-perm__blurb">${escapeHtml(permData.blurb)}</p>` : ""}
        ${
          permData.description
            ? `<p class="cm-perm__detail">${escapeHtml(permData.description)}</p>`
            : ""
        }
        <div class="cm-perm__chips">
          <span class="cm-chip ${permData.required ? "cm-chip--on" : ""}" data-pill="required">Required</span>
          <span class="cm-chip cm-chip--warn ${
            permData.sensitive ? "cm-chip--on" : ""
          }" data-pill="sensitive">Sensitive</span>
        </div>
        <div class="cm-perm__toggles is-hidden" data-perm-toggles>
          <label class="tiny-switch">
            <input type="checkbox" data-toggle="required" data-perm="${escapeAttr(
              permData.id
            )}" ${permData.required ? "checked" : ""} disabled>
            <span>Required</span>
          </label>
          <label class="tiny-switch">
            <input type="checkbox" data-toggle="sensitive" data-perm="${escapeAttr(
              permData.id
            )}" ${permData.sensitive ? "checked" : ""} disabled>
            <span>Sensitive</span>
          </label>
        </div>
      </div>`;

    list.prepend(li);
    setTimeout(() => li.classList.remove("is-new"), 2200);

    const editToggle = modal.querySelector("[data-perm-edit]");
    if (editToggle?.checked) {
      li.querySelectorAll("[data-perm-toggles]").forEach((node) => node.classList.remove("is-hidden"));
      li.querySelectorAll("input[data-toggle]").forEach((input) => {
        input.disabled = false;
      });
    }

    li.querySelectorAll("input[data-toggle]").forEach((input) => {
      bindToggleInput(input, studyId, modal);
    });
  };

  document.addEventListener("click", (event) => {
    const trigger = event.target.closest("[data-cm-view-study], .view-study");
    if (!trigger) return;
    const studyId =
      trigger.getAttribute("data-study-id") || trigger.getAttribute("data-view-study-id");
    if (!studyId) return;
    event.preventDefault();
    openModal(studyId, trigger);
  });

  window.cmOpenResearcherStudy = (id, trigger) => openModal(id, trigger);
})();
