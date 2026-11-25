import pathlib

content = pathlib.Path('packages/backend/app/adapters/ollama_tools.py').read_text()

idx = content.rfind('params.items()) if params else ""')
print(f'Position: {idx}')
print(repr(content[idx:idx + 100]))
