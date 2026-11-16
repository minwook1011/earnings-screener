/* 선행지표 화면 테마 — 기본 어둡게, 이 브라우저에 고른 값 저장(ld-theme). 그리기 전에 먼저 적용 */
(function () {
  var t = "dark";
  try { t = localStorage.getItem("ld-theme") || "dark"; } catch (e) {}
  document.documentElement.setAttribute("data-theme", t === "light" ? "light" : "dark");
})();
