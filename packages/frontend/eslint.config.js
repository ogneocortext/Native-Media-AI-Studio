import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import prettier from 'eslint-config-prettier';

// Custom project-specific ESLint rules
import { noListAudioFiles, noProcessEnv } from './eslint-plugin/rules/index.js';

// Project-specific architectural constraints encoded as ESLint rules.
// These mirror the layering documented in AGENTS.md:
//   api -> services -> adapters (downward only, no upward edges)
// Services and adapters must never import from api.
export default tseslint.config(
  { ignores: ['dist', 'node_modules', 'tests/browser', 'browser-test'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  prettier, // disables ESLint formatting rules that conflict with Prettier (must be last)
  {
    plugins: {
      'nma-audio': {
        rules: {
          'no-list-audio-files': noListAudioFiles,
        },
      },
      'nma-env': {
        rules: {
          'no-process-env': noProcessEnv,
        },
      },
    },
    rules: {
      // Core correctness — errors, not warnings
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      // AI-friendly: no `any` is an error (AI agents love escaping types)
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/explicit-function-return-type': 'off',
      // Prettier handles formatting; ESLint handles correctness only
      // Custom project rules
      'nma-audio/no-list-audio-files': 'error',
      'nma-env/no-process-env': 'error',
    },
  },
  {
    files: ['src/features/three-js-studio/**/*.ts', 'src/features/three-js-studio/**/*.tsx', 'src/features/visualizer/**/*.ts', 'src/features/visualizer/**/*.tsx'],
    rules: {
      // 3D/visualizer code legitimately uses `any` for untyped shader/webgl data
      '@typescript-eslint/no-explicit-any': 'off',
    },
  },
);
