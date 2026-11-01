import os

# All files with stale path references - comprehensive list
files = [
    # .claude directory
    'D:\\Backup of Important Data for Windows 11 Upgrade\\Native Media AI Studio\\packages\\frontend\\.claude\\skills\\remotion-best-practices\\remotion-maps\\techniques\\cesium\\TECHNIQUE.md',
    'D:/Backup of Important Data for Windows 11 Upgrade/Native Media AI Studio/packages/frontend/.claude/skills/remotion-best-practices/remotion-maps/techniques/cesium/TECHNIQUE.md',
    'D:/Backup of Important Data for Windows 11 Upgrade/Native Media AI Studio/packages/frontend/.claude/skills/remotion-best-practices/remotion-maps/techniques/maptiler/TECHNIQUE.md',
    'D:/Backup of Important Data for Windows 11 Upgrade/Native Media AI Studio/packages/frontend/.claude/skills/remotion-best-practices/remotion-maps/techniques/maptiler/scripts/prep-geo.mjs',
    'D:/Backup of Important Data for Windows 11 Upgrade/Native Media AI Studio/packages/frontend/.agents/skills/remotion-maps/techniques/cesium/TECHNIQUE.md',
    # .agent directory (no dots)
    'D:/Backup of Important Data for Windows 11 Upgrade/Native Media AI Studio/packages/frontend/agent/skills/remotion-maps/techniques/cesium/TECHNIQUE.md',
    'D:/Backup of Important Data for Windows 11 Upgrade/Native Media AI Studio/packages/frontend/agent/skills/remotion-maps/techniques/maptiler/TECHNIQUE.md',
    'D:/Backup of Important Data for Windows 11 Upgrade/Native Media AI Studio/packages/frontend/agent/skills/remotion-maps/techniques/maptiler/scripts/prep-geo.mjs',
    'D:/Backup of Important Data for Windows 11 Upgrade/Native Media AI Studio/packages/frontend/agent/skills/remotion-markup/remotion-maps/techniques/cesium/TECHNIQUE.md',
    'D:/Backup of Important Data for Windows 11 Upgrade/Native Media AI Studio/packages/frontend/agent/skills/remotion-markup/remotion-maps/techniques/cesium/TECHNIQUE.md',
    'D:/Backup of Important Data for Windows 11 Upgrade/Native Media AI Studio/packages/frontend/agent/skills/remotion-markup/remotion-maps/techniques/maptiler/TECHNIQUE.md',
    'D:/Backup of Important Data for Windows 11 Upgrade/Native Media AI Studio/packages/frontend/agent/skills/remotion-markup/remotion-maps/techniques/maptiler/scripts/prep-geo.mjs',
    # scripts file
    'D:/Backup of Important Data for Windows 11 Upgrade/Native Media AI Studio/packages/frontend/agent/skills/remotion-best-practices/remotion-maps/techniques/maptiler/scripts/prep-geo.mjs',
]

replacements = [
    ('scripts/prep-cesium-path.mjs', 'packages/frontend/.claude/skills/remotion-best-practices/remotion-maps/techniques/cesium/scripts/prep-cesium-path.mjs'),
    ('scripts/prep-geo.mjs', 'packages/frontend/.claude/skills/remotion-best-practices/remotion-maps/techniques/maptiler/scripts/prep-geo.mjs'),
]

fixed = 0
for f in files:
    if not os.path.exists(f):
        print(f'NOT FOUND: {f}')
        continue
    with open(f, 'r') as fh:
        content = fh.read()
    original = content
    content = content.replace(replacements[0][0], replacements[0][1])
    content = content.replace(replacements[1][0], replacements[1][1])
    if content != original:
        with open(f, 'w') as fh:
            fh.write(content)
        print(f'UPDATED: {f}')
        fixed += 1
    else:
        print(f'UNCHANGED: {f}')

print(f'\nTotal updated: {fixed}')
PYEOF