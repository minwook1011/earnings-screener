' Scheduled tasks: run a .bat with no console window (2026-11-26). Usage: wscript.exe hidden.vbs <bat path>
Set sh = CreateObject("WScript.Shell")
sh.Run "cmd.exe /c """ & WScript.Arguments(0) & """", 0, True
