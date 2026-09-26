  // Stessa identica logica di rilevamento lingua di index.html/admin.html —
  // primaria del browser, non "presente ovunque nella lista".
  const primaryLang = navigator.language || (navigator.languages && navigator.languages[0]) || "en";
  const LANG = primaryLang.toLowerCase().startsWith("it") ? "it" : "en";

  if (LANG === "it") {
    document.documentElement.lang = "it";
    document.title = "Come funziona — Supplier Trust Registry";
    document.getElementById("content-en").style.display = "none";
    document.getElementById("content-it").style.display = "block";
    document.getElementById("btn-back-to-app").textContent = "Torna all'app";
  }

  const backToTop = document.getElementById("btn-back-to-top");
  window.addEventListener("scroll", () => {
    backToTop.style.display = window.scrollY > 400 ? "block" : "none";
  });
  backToTop.addEventListener("click", () => {
    window.scrollTo({ top: 0, behavior: "smooth" });
  });
