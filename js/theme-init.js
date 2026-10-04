// Classic (blocking) script loaded in <head> so the saved theme/language apply before first paint (no flash).
(function () {
  try {
    var theme = localStorage.getItem("medimind_theme");
    if (!theme) theme = window.matchMedia && matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
    document.documentElement.setAttribute("data-theme", theme);
    var lang = localStorage.getItem("medimind_lang") === "ur" ? "ur" : "en";
    document.documentElement.setAttribute("lang", lang);
    document.documentElement.setAttribute("dir", lang === "ur" ? "rtl" : "ltr");
  } catch (e) { /* storage blocked — defaults from the HTML apply */ }
})();
