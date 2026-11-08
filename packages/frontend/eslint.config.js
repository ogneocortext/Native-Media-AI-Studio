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
  // prefer-nullish-coalescing, etc.) that need the type checker. The codebase
  // was brought to full compliance under T-LINT-01 (0 warnings across src),
  // so every rule below is `error` — any regression fails the lint gate.
  // Core correctness rules (no-unused-vars, no-explicit-any, custom project
  // rules) were already `error`.
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
      // consistent-type-imports — enabled by recommendedTypeChecked; the
      // codebase is compliant as of T-LINT-01.
      "@typescript-eslint/consistent-type-imports": "error",
      "nma-audio/no-list-audio-files": "error",
      "nma-env/no-process-env": "error",

      // Type-aware and stylistic rules from recommendedTypeChecked /
      // stylisticTypeChecked — all `error` since T-LINT-01 took the
      // codebase to zero warnings. Run `eslint --fix` for the auto-fixable
      // ones (consistent-type-imports, prefer-nullish-coalescing, etc.).
      "@typescript-eslint/array-type": "error",
      "@typescript-eslint/await-thenable": "error",
      "@typescript-eslint/consistent-generic-constructors": "error",
      "@typescript-eslint/consistent-indexed-object-style": "error",
      "@typescript-eslint/consistent-type-assertions": "error",
      "@typescript-eslint/consistent-type-definitions": "error",
      "@typescript-eslint/dot-notation": "error",
      "@typescript-eslint/no-base-to-string": "error",
      "@typescript-eslint/no-empty-function": "error",
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/no-floating-promises": "error",
      "@typescript-eslint/no-implied-eval": "error",
      "@typescript-eslint/no-inferrable-types": "error",
      "@typescript-eslint/no-misused-promises": "error",
      "@typescript-eslint/no-non-null-assertion": "error",
      "@typescript-eslint/no-non-null-asserted-optional-chain": "error",
      "@typescript-eslint/no-invalid-this": "error",
      "@typescript-eslint/no-this-alias": "error",
      "@typescript-eslint/unbound-method": "error",
      "@typescript-eslint/no-redundant-type-constituents": "error",
      "@typescript-eslint/no-unsafe-argument": "error",
      "@typescript-eslint/no-unsafe-assignment": "error",
      "@typescript-eslint/no-unsafe-call": "error",
      "@typescript-eslint/no-unsafe-enum-comparison": "error",
      "@typescript-eslint/no-unsafe-member-access": "error",
      "@typescript-eslint/no-unsafe-return": "error",
      "@typescript-eslint/no-unsafe-unary-minus": "error",
      "@typescript-eslint/no-unnecessary-condition": "error",
      "@typescript-eslint/no-unnecessary-type-assertion": "error",
      "@typescript-eslint/no-unnecessary-type-arguments": "error",
      "@typescript-eslint/non-nullable-type-assertion-style": "error",
      "@typescript-eslint/prefer-for-of": "error",
      "@typescript-eslint/prefer-includes": "error",
      "@typescript-eslint/prefer-nullish-coalescing": "error",
      "@typescript-eslint/prefer-optional-chain": "error",
      "@typescript-eslint/prefer-regexp-exec": "error",
      "@typescript-eslint/prefer-string-starts-ends-with": "error",
      "@typescript-eslint/promise-function-async": "error",
      "@typescript-eslint/require-await": "error",
      "@typescript-eslint/restrict-template-expressions": "error",
      "@typescript-eslint/switch-exhaustiveness-check": "error",
      "@typescript-eslint/unified-signatures": "error",
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
