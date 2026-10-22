# -*- coding: utf-8 -*-
"""잠금 화면 비밀번호 정하기 — 입력은 화면에 안 보이고, PBKDF2 해시만 docs/gate.js 에 쓴다(평문은 어디에도 안 남음).
  실행: python tools/set_password.py   → 비밀번호 두 번 입력 → 커밋·푸시
  비밀번호는 12자 이상 권장(해시가 공개 파일에 있어 짧으면 맞혀질 수 있다)."""
import getpass
import hashlib
import os
import re
import secrets

GATE = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "docs", "gate.js")
ITER = 300000

pw = getpass.getpass("새 비밀번호: ")
if pw != getpass.getpass("한 번 더: "):
    raise SystemExit("두 번 입력이 다릅니다.")
if len(pw) < 8:
    raise SystemExit("8자 이상으로 정하세요(12자 이상 권장).")
salt = secrets.token_hex(16)
h = hashlib.pbkdf2_hmac("sha256", pw.encode("utf-8"), salt.encode("utf-8"), ITER).hex()
src = open(GATE, encoding="utf-8").read()
src = re.sub(r'var GATE = \{[^}]*\};', 'var GATE = { salt: "%s", iter: %d, hash: "%s" };' % (salt, ITER, h), src, count=1)
open(GATE, "w", encoding="utf-8").write(src)
print("잠금 비밀번호를 바꿨습니다. 이제 커밋·푸시하면 적용됩니다(이미 연 브라우저도 다시 묻습니다).")
