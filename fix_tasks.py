import os

files = [
    'D:\\Backup of Important Data for Windows 11 Upgrade\\Native Media AI Studio\\docs\\plans\\tasks\\audio-analysis-and-remix.md'
]

with open(files[0], 'r') as f:
    lines = f.readlines()

# Remove lines 111-145 (1-indexed), which are indices 110-144 (0-indexed)
new_lines = lines[:110] + lines[145:]

with open(files[0], 'w') as f:
    f.writelines(new_lines)

print(f'Original lines: {len(lines)}, New lines: {len(new_lines)}')
print(f'Removed {len(lines) - len(new_lines)} lines')
PYEOF