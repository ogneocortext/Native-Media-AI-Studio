# Fix 1: Add proper frontmatter to remix-prompt-architecture-2026.md
path = 'D:/Backup of Important Data for Windows 11 Upgrade/Native Media AI Studio/docs/knowledge-library/remix-prompt-architecture-2026.md'
with open(path, 'r') as f:
    content = f.read()
if not content.startswith('---\n'):
    frontmatter = """---\ntitle: Remix Prompt Architecture\ntags:\n  - remix\n  - prompt-engineering\n  - architecture\n  - 2026\naliases:\n  - remix-prompt-architecture\ndate: 2026-10-30\n---\n\n"""
    with open(path, 'w') as f:
        f.write(frontmatter + content)
    print('Added frontmatter to remix-prompt-architecture-2026.md')
else:
    print('Already has frontmatter')

# Fix 2: Fix analyze-visualizer-frames.mjs path reference
path2 = 'D:/Backup of Important Data for Windows 11 Upgrade/Native Media AI Studio/packages/frontend/src/features/visualizer/visualizerHelpers.ts'
with open(path2, 'r', encoding='utf-8', errors='replace') as f:
    content2 = f.read()
if 'packages/frontend/node_modules/playwright/index.js' in content2:
    content2 = content2.replace('packages/frontend/node_modules/playwright/index.js', 'packages/frontend/eslint-plugin/rules/index.js')
    with open(path2, 'w', encoding='utf-8') as f:
        f.write(content2)
    print('Fixed visualizerHelpers.ts path')
else:
    print('visualizerHelpers.ts path already fixed or not present')