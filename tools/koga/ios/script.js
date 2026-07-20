(() => {
  const links = window.KOGA_IOS_RELEASE_LINKS || {};

  document.querySelectorAll("[data-release-link]").forEach((anchor) => {
    const key = anchor.dataset.releaseLink;
    const url = links[key];

    if (url) {
      anchor.href = url;
      anchor.removeAttribute("aria-disabled");
      anchor.classList.remove("disabled");
      if (anchor.dataset.labelReady) anchor.textContent = anchor.dataset.labelReady;
      if (/^https?:\/\//.test(url)) {
        anchor.target = "_blank";
        anchor.rel = "noopener";
      }
      return;
    }

    anchor.href = "#availability";
    anchor.setAttribute("aria-disabled", "true");
    anchor.classList.add("disabled");
    anchor.addEventListener("click", (event) => {
      event.preventDefault();
      document.querySelector("#availability")?.scrollIntoView({ behavior: "smooth" });
    });
  });

  const year = document.querySelector("[data-current-year]");
  if (year) year.textContent = new Date().getFullYear();
})();
