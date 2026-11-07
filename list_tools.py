import pathlib
import re

content = pathlib.Path('packages/backend/app/adapters/ollama_tools.py').read_text()

functions = re.findall(r'"name": "(\w+)"', content)
print('Available tools:')
for f in functions:
    print(f'  - {f}')
