import json

with open('/tmp/eslint-warnings.json', encoding='utf-8', errors='replace') as f:
    data = json.load(f)

# Check prefer-optional-chain examples
count = 0
for f in data:
    for m in f.get('messages', []):
        if m.get('ruleId') == '@typescript-eslint/prefer-optional-chain' and m.get('severity') == 1:
            line_num = m['line']
            file_path = f['filePath']
            try:
                with open(file_path, encoding='utf-8', errors='replace') as fh:
                    lines = fh.readlines()
                    if line_num <= len(lines):
                        print(f'{file_path}:{line_num} >>> {lines[line_num - 1].rstrip()}')
            except Exception:
                pass
            count += 1
            if count >= 5:
                break
    if count >= 5:
        break

print("\n--- no-non-null-assertion ---")
count = 0
for f in data:
    for m in f.get('messages', []):
        if m.get('ruleId') == '@typescript-eslint/no-non-null-assertion' and m.get('severity') == 1:
            line_num = m['line']
            file_path = f['filePath']
            try:
                with open(file_path, encoding='utf-8', errors='replace') as fh:
                    lines = fh.readlines()
                    if line_num <= len(lines):
                        print(f'{file_path}:{line_num} >>> {lines[line_num - 1].rstrip()}')
            except Exception:
                pass
            count += 1
            if count >= 5:
                break
    if count >= 5:
        break
