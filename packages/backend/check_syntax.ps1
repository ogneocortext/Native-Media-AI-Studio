import re
with open(r'D:\Backup of Important Data for Windows 11 Upgrade\Native Media AI Studio\packages\backend\app\adapters\comfyui.py', 'r') as f:
    content = f.read()

count = content.count('"""')
print(f'Triple quotes: {count}')

in_string = False
for i, m in enumerate(re.finditer(r'"""', content)):
    line_num = content[:m.start()].count(chr(10)) + 1
    in_string = not in_string
    status = "OPEN " if in_string else "CLOSE"
    context = content[max(0,m.start()-20):m.start()+40].replace(chr(10), ' ')
    print(f'{status} {i+1}. Line {line_num}: ...{context}...')
