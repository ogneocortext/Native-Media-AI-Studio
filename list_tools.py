import re
with open('packages/backend/app/adapters/ollama_tools.py', 'r') as f:
    content = f.read()

functions = re.findall(r'"name": "(\w+)"', content)
print('Available tools:')
for f in functions:
    print(f'  - {f}')