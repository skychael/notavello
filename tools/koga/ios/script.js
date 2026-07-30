(() => {
  const links = window.KOGA_IOS_RELEASE_LINKS || {};

  document.querySelectorAll("[data-release-link]").forEach((anchor) => {
    const url = links[anchor.dataset.releaseLink];
    if (!url) return;

    anchor.href = url;
    if (/^https?:\/\//.test(url)) {
      anchor.target = "_blank";
      anchor.rel = "noopener";
    }
  });

  const year = document.querySelector("[data-current-year]");
  if (year) year.textContent = new Date().getFullYear();
})();
