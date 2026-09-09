import re, pathlib
html = pathlib.Path(r"D:\Backup of Important Data for Windows 11 Upgrade\Native Media AI Studio\tools\hyperframes-built-this-from-a-dream\v2\index.html").read_text()
m = re.search(r"<script>(.*?)</script>", html, re.S)
js = m.group(1) if m else ""
out = pathlib.Path(r"D:\Backup of Important Data for Windows 11 Upgrade\Native Media AI Studio\tools\hyperframes-built-this-from-a-dream\v2\test.js")
out.write_text(js)
print("wrote", len(js), "chars")
