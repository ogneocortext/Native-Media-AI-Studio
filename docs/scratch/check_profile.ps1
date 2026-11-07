$PROFILE | Format-List *
"--- profile files ---"
Get-ChildItem "$env:USERPROFILE\Documents\PowerShell" -ErrorAction SilentlyContinue | Select-Object Name, Length
"--- env ---"
"User PYTHONUTF8: " + [Environment]::GetEnvironmentVariable('PYTHONUTF8','User')
"Machine PYTHONUTF8: " + [Environment]::GetEnvironmentVariable('PYTHONUTF8','Machine')
"Process PYTHONUTF8: " + $env:PYTHONUTF8
