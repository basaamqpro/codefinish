// menu.js
// Left menu: 3-state toggle + collapsible categories
// Works even if loaded in <head> (waits for DOM ready)

(function () {
  "use strict";

  document.addEventListener("DOMContentLoaded", () => {
    /* ===== 3-state menu toggle (Hidden → 20% → 100%) ===== */
    const body = document.body;
    const btn = document.getElementById("menudisplay");
    const states = ["hidden", "compact", "full"];

    function initialIndex() {
      const cls = Array.from(body.classList).find((c) => c.startsWith("state-"));
      const name = (cls || "state-compact").replace("state-", "");
      const i = states.indexOf(name);
      return i >= 0 ? i : 1; // default to "compact"
    }

    let idx = initialIndex();

    function applyState() {
      states.forEach((s) => body.classList.remove("state-" + s));
      body.classList.add("state-" + states[idx]);
      if (btn) {
        const label = `Menu: ${states[idx]}. Tap to change`;
        btn.setAttribute("aria-label", label);
        btn.title = label;
      }
    }

    applyState();

    if (btn) {
      btn.addEventListener("click", () => {
        idx = (idx + 1) % states.length;
        applyState();
      });
    }

    // Keyboard: M to cycle, Esc to hide
    window.addEventListener("keydown", (e) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const k = e.key.toLowerCase();
      if (k === "m") {
        idx = (idx + 1) % states.length;
      ///  applyState();
      } else if (k === "escape") {
        idx = 0; // force hidden
       // applyState();
      }
    });

    /* ===== Collapsible categories ===== */
    const groups = document.querySelectorAll(".menustudycategorycontainer");

    groups.forEach((group) => {
      const headerBtn = group.querySelector(".menustudycategory");
      const panel = group.querySelector(".menustudy");

      // Set initial aria-expanded based on presence of .open
      function setAria() {
        const isOpen = group.classList.contains("open");
        if (headerBtn) headerBtn.setAttribute("aria-expanded", String(isOpen));
      }
      setAria();

      function toggle() {
        const isOpen = group.classList.toggle("open");
        if (headerBtn) headerBtn.setAttribute("aria-expanded", String(isOpen));
        if (isOpen && panel) {
          const firstLink = panel.querySelector("a");
          if (firstLink) firstLink.focus({ preventScroll: true });
        }
      }

      if (headerBtn) {
        headerBtn.addEventListener("click", (e) => {
          e.preventDefault();
          toggle();
        });

        headerBtn.addEventListener("keydown", (e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
           // toggle();
          }
        });
      }
    });
  });
})();
