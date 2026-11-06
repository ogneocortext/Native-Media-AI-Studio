with open('packages/backend/app/adapters/ollama_tools.py', 'r') as f:
    content = f.read()

idx = content.rfind('params.items()) if params else ""')
print(f'Position: {idx}')
print(repr(content[idx:idx+100]))