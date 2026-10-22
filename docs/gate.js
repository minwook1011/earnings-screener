/* 잠금 화면 — 비밀번호를 맞춰야 사이트가 보인다. 평문은 어디에도 없고 PBKDF2 해시만 둔다.
 * 비밀번호 바꾸기: python tools/set_password.py (입력값은 화면에 안 보이고 해시만 이 파일에 씀)
 * 주의: 화면 잠금이다. 공개 저장소의 데이터 파일은 주소를 알면 직접 열 수 있다. */
(function () {
  "use strict";
  var GATE = { salt: "", iter: 300000, hash: "" };   // set_password.py 가 채움
  var KEY = "es_gate_v1";
  if (!GATE.hash) return;
  try { if (localStorage.getItem(KEY) === GATE.hash) return; } catch (e) {}
  document.documentElement.classList.add("locked");
  function hex(b) { return Array.prototype.map.call(new Uint8Array(b), function (x) { return ("0" + x.toString(16)).slice(-2); }).join(""); }
  function derive(pw) {
    var enc = new TextEncoder();
    return crypto.subtle.importKey("raw", enc.encode(pw), "PBKDF2", false, ["deriveBits"]).then(function (k) {
      return crypto.subtle.deriveBits({ name: "PBKDF2", salt: enc.encode(GATE.salt), iterations: GATE.iter, hash: "SHA-256" }, k, 256);
    }).then(hex);
  }
  function show() {
    var box = document.createElement("div");
    box.id = "gate";
    box.innerHTML = '<form id="gate-f"><b>실적발표스크리너</b><label for="gate-p">비밀번호</label>' +
      '<input id="gate-p" type="password" autocomplete="current-password" autofocus><button type="submit">열기</button><p id="gate-m"></p></form>';
    document.body.appendChild(box);
    document.getElementById("gate-f").addEventListener("submit", function (e) {
      e.preventDefault();
      var m = document.getElementById("gate-m"); m.textContent = "확인 중…";
      derive(document.getElementById("gate-p").value).then(function (h) {
        if (h !== GATE.hash) { m.textContent = "비밀번호가 맞지 않습니다."; return; }
        try { localStorage.setItem(KEY, h); } catch (err) {}
        document.documentElement.classList.remove("locked"); box.remove();
      });
    });
  }
  if (document.body) show(); else document.addEventListener("DOMContentLoaded", show);
})();
