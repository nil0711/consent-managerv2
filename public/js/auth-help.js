(function () {
  const page = document.body.dataset.page || "";
  const infoBtn = document.querySelector(".cm-info");
  const panel   = document.querySelector("#cm-help");
  let overlay   = document.querySelector(".cm-overlay");

  if (!overlay) {
    overlay = document.createElement("div");
    overlay.className = "cm-overlay is-hidden";
    document.body.appendChild(overlay);
  }

  const show = () => {
    panel?.classList.remove("is-hidden"); panel?.classList.add("is-visible");
    overlay.classList.remove("is-hidden"); overlay.classList.add("is-visible");
    infoBtn?.setAttribute("aria-expanded", "true");
    panel?.focus({ preventScroll: true });
  };

  const hide = () => {
    panel?.classList.add("is-hidden"); panel?.classList.remove("is-visible");
    overlay.classList.add("is-hidden"); overlay.classList.remove("is-visible");
    infoBtn?.setAttribute("aria-expanded", "false");
  };

  infoBtn?.addEventListener("click", (e) => {
    e.preventDefault();
    const open = panel?.classList.contains("is-visible");
    open ? hide() : show();
  });

  document.addEventListener("click", (e) => {
    if (!panel || panel.classList.contains("is-hidden")) return;
    if (panel.contains(e.target) || infoBtn?.contains(e.target)) return;
    hide();
  });
  document.addEventListener("keydown", (e) => (e.key === "Escape") && hide());

  document.addEventListener("DOMContentLoaded", () => {
    const group = document.querySelector("#roleToggle");
    const roleInput = document.querySelector("#roleInput");
    if (!group || !roleInput) return;

    const tiles = Array.from(group.querySelectorAll("[data-role]"));
    if (tiles.length !== 2) return;

    function apply(role) {
      const target = (role || "PARTICIPANT").toUpperCase();
      tiles.forEach((btn) => {
        const on = btn.dataset.role === target;
        btn.classList.toggle("is-active", on);
        btn.setAttribute("aria-checked", String(on));
        btn.tabIndex = on ? 0 : -1;
        if (on) btn.focus();
      });
      roleInput.value = target;
    }

    group.addEventListener("click", (e) => {
      const btn = e.target.closest("[data-role]");
      if (!btn || !group.contains(btn)) return;
      e.preventDefault();
      apply(btn.dataset.role);
    });

    group.addEventListener("keydown", (e) => {
      if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
      e.preventDefault();
      const activeIdx = tiles.findIndex((t) => t.classList.contains("is-active"));
      const next = e.key === "ArrowRight"
        ? (activeIdx + 1) % tiles.length
        : (activeIdx - 1 + tiles.length) % tiles.length;
      apply(tiles[next].dataset.role);
    });

    apply(roleInput.value);

    document.addEventListener("click", (e) => {
      const el = e.target.closest("[data-help-action]");
      if (!el) return;
      const action = el.dataset.helpAction;
      if (window.location.pathname === "/signup" && (action === "select-researcher" || action === "select-participant")) {
        e.preventDefault();
        apply(action === "select-researcher" ? "RESEARCHER" : "PARTICIPANT");
        hide();
        const href = el.getAttribute("href");
        if (href) window.location.assign(href);
      }
    });
  });
})();
