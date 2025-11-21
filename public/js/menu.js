(() => {
  const trigger = document.getElementById("cm-avatar-btn");
  const menu = document.getElementById("cm-menu");
  if (!trigger || !menu) return;

  let isOpen = false;

  const close = () => {
    if (!isOpen) return;
    isOpen = false;
    menu.hidden = true;
    trigger.setAttribute("aria-expanded", "false");
    document.removeEventListener("click", handleDocClick, true);
    document.removeEventListener("keydown", handleKey, true);
  };

  const open = () => {
    if (isOpen) return;
    isOpen = true;
    menu.hidden = false;
    trigger.setAttribute("aria-expanded", "true");
    document.addEventListener("click", handleDocClick, true);
    document.addEventListener("keydown", handleKey, true);
  };

  const handleDocClick = (event) => {
    if (menu.contains(event.target) || event.target === trigger) return;
    close();
  };

  const handleKey = (event) => {
    if (event.key === "Escape") {
      event.preventDefault();
      close();
    }
  };

  trigger.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    isOpen ? close() : open();
  });

  menu.addEventListener("click", async (event) => {
    const btn = event.target.closest(".js-switch-role");
    if (!btn) return;
    event.preventDefault();
    const role = (btn.dataset.role || "").toLowerCase();
    if (!role) return;
    if (btn.hasAttribute("data-needs-setup")) {
      window.location.href = `/account/roles/${role}/setup`;
      return;
    }
    try {
      const response = await fetch("/account/roles/switch", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json"
        },
        body: JSON.stringify({ role })
      });
      if (response.status === 409) {
        const data = await response.json().catch(() => ({}));
        if (data?.needsSetup && role === "researcher") {
          window.location.href = "/account/roles/researcher/setup";
          return;
        }
        throw new Error("Requires setup");
      }
      if (!response.ok) throw new Error("Switch failed");
      const data = await response.json();
      window.location.href =
        data.redirect || (role === "researcher" ? "/researcher" : "/participant");
    } catch (error) {
      alert("Unable to switch roles right now.");
    } finally {
      close();
    }
  });
})();
