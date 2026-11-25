import pathlib
import re

content = pathlib.Path('tools/mcp/frontend-3d-mcp.mjs').read_text()

# Count tools registered
tools_count = content.count('server.registerTool(')
print(f'Tools registered: {tools_count}')

# Check imports
imports = re.findall(r'import .* from [\"\'](.+?)[\"\']', content)
print('Imports:', imports)

# Check for proper URL construction
url_constructs = content.count('buildFrontendUrl(')
url_search = content.count('URLSearchParams')
print(f'buildFrontendUrl calls: {url_constructs}')
print(f'URLSearchParams usage: {url_search}')

# Check for proper error handling
if 'McpError' in content:
    print('Custom McpError class: YES')
else:
    print('Custom McpError class: NO')

# Check for graceful shutdown
if 'SIGTERM' in content and 'SIGINT' in content:
    print('Graceful shutdown: YES')
else:
    print('Graceful shutdown: NO')

# Check for auth headers
if 'Authorization' in content or 'API_KEY' in content:
    print('Auth header support: YES')
else:
    print('Auth header support: NO')

# Check for Vision MCP integration
if 'vision-mcp' in content.lower():
    print('Vision MCP integration: YES')
else:
    print('Vision MCP integration: NO')

# Check for backend endpoint warnings
endpoint_warnings = content.count('NOTE: Requires backend endpoint')
print(f'Backend endpoint warnings: {endpoint_warnings}')

# Check for URLSearchParams or URL constructor
url_constructor = content.count('new URL(')
print(f'URL constructor usage: {url_constructor}')
