' Scheduled tasks: run a .bat with no console window (2026-11-26). Usage: wscript.exe hidden.vbs <bat path>
' Output goes to <bat name>.task.log next to the bat (overwritten each run).
Set sh = CreateObject("WScript.Shell")
b = WScript.Arguments(0)
lg = Left(b, Len(b) - 4) & ".task.log"
WScript.Quit sh.Run("cmd.exe /c """"" & b & """ > """ & lg & """ 2>&1""", 0, True)
