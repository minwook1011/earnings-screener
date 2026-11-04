/* 미국 부동산 화면 시작 — 사이트 보안 정책(CSP)이 HTML 안의 style="…" 속성을 막으므로,
 * 화면에 새로 들어온 요소의 style 속성을 CSSOM(el.style.cssText)으로 다시 적용한다. */
window.KR_SCR_V = "1";
(function () {
  "use strict";
  function fix(n) {
    if (n.nodeType !== 1) return;
    if (n.hasAttribute("style")) n.style.cssText = n.getAttribute("style");
    var a = n.querySelectorAll ? n.querySelectorAll("[style]") : [];
    for (var i = 0; i < a.length; i++) a[i].style.cssText = a[i].getAttribute("style");
  }
  var mo = new MutationObserver(function (ms) {
    for (var i = 0; i < ms.length; i++) for (var j = 0; j < ms[i].addedNodes.length; j++) fix(ms[i].addedNodes[j]);
  });
  mo.observe(document.documentElement, { childList: true, subtree: true });
  document.addEventListener("DOMContentLoaded", function () { fix(document.body); });
})();
