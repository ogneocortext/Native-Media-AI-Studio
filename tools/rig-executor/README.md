# Rig executor (Route B, read-only)

Owner-run bridge that lets Maya + Bolt (Atomic Chat relay) inspect this
repo on the rig without Google Drive pulls. Read-only by construction:
`list_dir`, `read_file`, `grep`, `file_info`. No write, delete, or shell.

Run it on the rig, from this folder, in PowerShell 7:

```powershell
py rig_executor.py --root "D:\Backup of Important Data for Windows 11 Upgrade\Native Media AI Studio"
```

It binds the rig's Tailscale IPv4 on port 8799 and prints a fresh session
token once at startup. Paste that token to Maya in chat; it dies when the
window closes. Every call is appended to `executor-audit.jsonl` beside the
script. Full security model is in the script header.
