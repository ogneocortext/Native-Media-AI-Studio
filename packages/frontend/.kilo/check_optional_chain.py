import json

with open('/tmp/eslint-warnings.json', encoding='utf-8', errors='replace') as f:
    data = json.load(f)

# Show full lines for prefer-optional-chain
count = 0
for f in data:
    for m in f.get('messages', []):
        if m.get('ruleId') == '@typescript-eslint/prefer-optional-chain' and m.get('severity') == 1:
            line_num = m['line']
            col = m.get('column', 0)
            file_path = f['filePath']
            try:
                with open(file_path, encoding='utf-8', errors='replace') as fh:
                    lines = fh.readlines()
                    if line_num <= len(lines):
                        line = lines[line_num - 1].rstrip()
                        # Show context around the column
                        print(f'{file_path}:{line_num}:{col} >>> {line}')
                        print(f'  {" " ^ (col - 1)}^')
            except Exception:
                pass
            count += 1
            if count >= 8:
                break
    if count >= 8:
        break
