// @ts-check
import { defineConfig, globalIgnores } from "eslint/config";
import js from "@eslint/js";
import tseslint from "typescript-eslint";
import prettier from "eslint-config-prettier";

// Custom project-specific ESLint rules
import { noListAudioFiles, noProcessEnv } from "./eslint-plugin/rules/index.js";

/**
 * Project-specific architectural constraints encoded as ESLint rules.
 * These mirror the layering documented in AGENTS.md:
 *   api -> services -> adapters (downward only, no upward edges)
 * Services and adapters must never import from api.
 */

export default defineConfig(
  // Global ignores apply to every configuration object
  globalIgnores(["dist/", "node_modules/", "tests/browser/", "browser-test/"]),

  // Base JS + TS recommended rules (no type info needed)
  {
    files: ["**/*.{js,cjs,mjs,jsx,ts,cts,mts,tsx}"],
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
  },

  // Type-aware TypeScript linting. recommendedTypeChecked + stylisticTypeChecked
  // add powerful rules (no-floating-promises, no-misused-promises,
  // prefer-nullish-coalescing, etc.) that need the type checker. These are
  // set to `warn` below so they surface in CI output but don't block merges
  // while the codebase is gradually brought into compliance. Existing
  // correctness rules (no-unused-vars, no-explicit-any, custom project rules)
  // remain `error`.
  {
    files: ["**/*.{ts,cts,mts,tsx}"],
    extends: [
      ...tseslint.configs.recommendedTypeChecked,
      ...tseslint.configs.stylisticTypeChecked,
    ],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    plugins: {
      "nma-audio": {
        rules: {
          "no-list-audio-files": noListAudioFiles,
        },
      },
      "nma-env": {
        rules: {
          "no-process-env": noProcessEnv,
        },
      },
    },
    rules: {
      // Core correctness — errors, not warnings. These were already errors
      // before type-aware linting was added and the codebase is clean on them.
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      "@typescript-eslint/no-explicit-any": "error",
      // consistent-type-imports is warn (not error) — it's newly enabled by
      // recommendedTypeChecked and the codebase isn't yet compliant.
      "@typescript-eslint/consistent-type-imports": "warn",
      "nma-audio/no-list-audio-files": "error",
      "nma-env/no-process-env": "error",

      // Type-aware and stylistic rules newly enabled by recommendedTypeChecked
      // / stylisticTypeChecked. Set to warn so they surface in CI output but
      // don't block merges while the codebase is gradually brought into
      // compliance. Run `eslint --fix` to auto-correct the ~380 fixable ones.
      "@typescript-eslint/array-type": "warn",
      "@typescript-eslint/await-thenable": "warn",
      "@typescript-eslint/consistent-generic-constructors": "warn",
      "@typescript-eslint/consistent-indexed-object-style": "warn",
      "@typescript-eslint/consistent-type-assertions": "warn",
      "@typescript-eslint/consistent-type-definitions": "warn",
      "@typescript-eslint/dot-notation": "warn",
      "@typescript-eslint/no-base-to-string": "warn",
      "@typescript-eslint/no-empty-function": "warn",
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/no-floating-promises": "warn",
      "@typescript-eslint/no-implied-eval": "warn",
      "@typescript-eslint/no-inferrable-types": "warn",
      "@typescript-eslint/no-misused-promises": "warn",
      "@typescript-eslint/no-non-null-assertion": "warn",
      "@typescript-eslint/no-non-null-asserted-optional-chain": "warn",
      "@typescript-eslint/no-invalid-this": "warn",
      "@typescript-eslint/no-this-alias": "warn",
      "@typescript-eslint/unbound-method": "warn",
      "@typescript-eslint/no-redundant-type-constituents": "warn",
      "@typescript-eslint/no-unsafe-argument": "warn",
      "@typescript-eslint/no-unsafe-assignment": "warn",
      "@typescript-eslint/no-unsafe-call": "warn",
      "@typescript-eslint/no-unsafe-enum-comparison": "warn",
      "@typescript-eslint/no-unsafe-member-access": "warn",
      "@typescript-eslint/no-unsafe-return": "warn",
      "@typescript-eslint/no-unsafe-unary-minus": "warn",
      "@typescript-eslint/no-unnecessary-condition": "warn",
      "@typescript-eslint/no-unnecessary-type-assertion": "warn",
      "@typescript-eslint/no-unnecessary-type-arguments": "warn",
      "@typescript-eslint/non-nullable-type-assertion-style": "warn",
      "@typescript-eslint/prefer-for-of": "warn",
      "@typescript-eslint/prefer-includes": "warn",
      "@typescript-eslint/prefer-nullish-coalescing": "warn",
      "@typescript-eslint/prefer-optional-chain": "warn",
      "@typescript-eslint/prefer-regexp-exec": "warn",
      "@typescript-eslint/prefer-string-starts-ends-with": "warn",
      "@typescript-eslint/promise-function-async": "warn",
      "@typescript-eslint/require-await": "warn",
      "@typescript-eslint/restrict-template-expressions": "warn",
      "@typescript-eslint/switch-exhaustiveness-check": "warn",
      "@typescript-eslint/unified-signatures": "warn",
    },
  },

  // Turn off type-aware rules for plain JavaScript files
  {
    files: ["**/*.{js,cjs,mjs,jsx}"],
    extends: [tseslint.configs.disableTypeChecked],
  },

  {
    files: [
      "src/features/three-js-studio/**/*.ts",
      "src/features/three-js-studio/**/*.tsx",
      "src/features/visualizer/**/*.ts",
      "src/features/visualizer/**/*.tsx",
    ],
    rules: {
      // 3D/visualizer code legitimately uses `any` for untyped shader/webgl data
      "@typescript-eslint/no-explicit-any": "off",
    },
  },

  // prettier must be last so it can override conflicting formatting rules
  prettier,
);
