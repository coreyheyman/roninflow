# Stops the background RoninFlow server started by the installer's launcher.
Get-CimInstance Win32_Process -Filter "Name='node.exe'" |
  Where-Object { $_.CommandLine -like '*TradeJournal*server.js*' } |
  ForEach-Object { Stop-Process -Id $_.ProcessId -Force }
