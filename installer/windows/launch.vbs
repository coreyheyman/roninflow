' Starts the RoninFlow server hidden (if it isn't running) and, with "open", opens it in the browser.
Option Explicit
Dim sh, fso, app, node, data, url, http, running, i
Set sh = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
app = fso.GetParentFolderName(WScript.ScriptFullName)
node = app & "\node\node.exe"
data = sh.ExpandEnvironmentStrings("%LOCALAPPDATA%") & "\TradeJournal\data"
url = "http://localhost:5173/"

Function IsRunning()
  On Error Resume Next
  Dim h: Set h = CreateObject("MSXML2.ServerXMLHTTP.6.0")
  h.setTimeouts 1000, 1000, 1000, 1000
  h.Open "GET", url & "healthz", False
  h.Send
  IsRunning = (Err.Number = 0 And h.Status = 200)
  On Error GoTo 0
End Function

If Not IsRunning() Then
  If Not fso.FolderExists(data) Then sh.Run "cmd /c mkdir """ & data & """", 0, True
  sh.Environment("Process")("DATA_DIR") = data
  sh.CurrentDirectory = app
  sh.Run """" & node & """ """ & app & "\server.js""", 0, False
  For i = 1 To 40
    WScript.Sleep 250
    If IsRunning() Then Exit For
  Next
End If

If WScript.Arguments.Count > 0 Then
  If WScript.Arguments(0) = "open" Then sh.Run url, 1, False
End If
