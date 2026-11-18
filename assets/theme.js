(function () {
  try {
    var t = localStorage.getItem("cto-review-theme");
    var meta = document.querySelector('meta[name="color-scheme"]');
    if (t === "dark" || t === "light") {
      document.documentElement.setAttribute("data-theme", t);
      if (meta) meta.setAttribute("content", t);
    }
  } catch (e) {}
})();
