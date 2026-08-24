# Repository Reorganization Plan

## Issues Identified

1. **Root `src/` is misleading** - Only contains Python egg-info, not actual source code
2. **Duplicate `config/` directories** - root `config/` and `backend/config/` both exist with ports.json
7. **Multiple `output/` directories** - root `output/`, `backend/output/`, `signal-breaking-video/renders/`
7. **Frontend and signal-breaking-video are separate React projects** - causing confusion
7. **Multiple `node_modules`** - at root, in signal-breaking-video, and frontend
7. **Documentation scattered** - docs/ at root, docs in frontend/public/, signal-breaking-video README
7. **Test files scattered at root** - test_*.py files
8. **Root `src/` is misleading** - Only contains Python egg-info
8. **Multiple cache directories** - huggingface_cache, node_modules at multiple locations
8. **Documentation scattered** - docs/ at root, frontend/public/docs/
9. **Multiple cache directories** - huggingface_cache, multiple node_modules

## Target Structure

```
Native-Media-AI-Studio/
├── .github/                    # GitHub workflows
├── .vscode/                    # VS Code settings
├── .zed/                       # Zed editor settings
├── config/                     # Shared configuration (single source of truth)
│   ├── ports.json              # Port configuration
│   └── settings.json           # Shared settings
├── docs/                       # All documentation (single source)
│   ├── architecture/
│   ├── guides/
│   ├── api/
│   └── visual-storytelling/
├── packages/                   # Monorepo packages
│   ├── frontend/               # React/Vite UI (main frontend)
│   │   ├── src/
│   │   ├── public/
│   │   ├── package.json
│   │   └── ...
│   ├── backend/                # FastAPI backend
│   │   ├── app/
│   │   ├── config/
│   │   ├── tests/
│   │   ├── requirements.txt
│   │   └── pyproject.toml
│   └── video-editor/           # Remotion video project (renamed from signal-breaking-video)
│       ├── src/
│       ├── public/
│       ├── renders/
│       ├── package.json
│       └── ...
├── scripts/                    # Utility scripts
├── output/                     # Generated content (single source)
│   ├── images/
│   ├── video/
│   ├── audio/
│   └── logs/
├── shared/                     # Shared types (TypeScript from Pydantic)
├── tools/                      # External tool integrations
├── tests/                      # Root-level tests
├── .github/
├── .vscode/
├── .gitignore
├── package.json                # Root package.json for workspace
├── pnpm-workspace.yaml         # PNPM workspace config
├── turbo.json                  # Turborepo config (optional)
├── README.md
├── Guidelines.md
├── CHANGELOG.md
├── pyproject.toml              # Root Python config
├── docker-compose.yml          # For future containerization
└── .gitignore
```

## Migration Steps

1. **Create new directory structure**
2. **Consolidate config** - merge config/ and backend/config/ into root config/
9. **Consolidate documentation** - move all docs to root docs/
7. **Consolidate output** - move all output to root output/
7. **Reorganize packages** - move frontend, backend, signal-breaking-video into packages/
5. **Create shared types package** - shared types from Pydantic
5. **Create root package.json** with workspace configuration
5. **Update imports and paths** in all packages
5. **Clean up root level** - remove misleading src/, duplicate configs, test files
5. **Update scripts and config files** with new paths
5. **Verify build works** for all packages