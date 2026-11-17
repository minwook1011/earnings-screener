/* 일본 스크리닝 화면(선행지표 모양) — 그리기 전에 먼저 어둡게(깜빡임 방지). 저장값은 선행지표와 같은 ld-theme */
(function () {
  var m = (location.hash || "").slice(1).split("/")[0];
  if (!/^(jps|jpa|jpc|jpcal)$/.test(m)) return;
  var t = "dark";
  try { t = localStorage.getItem("ld-theme") || "dark"; } catch (e) {}
  document.documentElement.classList.add("lk");
  document.documentElement.setAttribute("data-theme", t === "light" ? "light" : "dark");
})();
