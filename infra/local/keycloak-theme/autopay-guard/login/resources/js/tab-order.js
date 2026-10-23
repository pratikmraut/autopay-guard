/* Restore natural DOM tab order without reading credentials or changing forms. */
(() => {
  function restoreNaturalTabOrder() {
    document.querySelectorAll("[tabindex]").forEach((element) => {
      if (element.tabIndex > 0) {
        element.removeAttribute("tabindex");
      }
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", restoreNaturalTabOrder, {
      once: true,
    });
  } else {
    restoreNaturalTabOrder();
  }
})();
