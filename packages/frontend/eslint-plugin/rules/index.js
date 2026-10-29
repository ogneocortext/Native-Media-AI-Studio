/**
 * Custom ESLint rules for Native Media AI Studio project-specific patterns.
 *
 * Rules in this file:
 *   1. no-list-audio-files — Forbids calling listAudioFiles() from components
 *      (only allowed in state/audioLibraryStore.ts per AGENTS.md D16)
 *   2. no-process-env — Forbids process.env usage (use DI instead)
 *
 * Usage in eslint.config.js:
 *   import { noListAudioFiles, noProcessEnv } from './eslint-plugin/rules/index.js';
 *   ...
 *   plugins: {
 *     'nma-audio': { rules: { 'no-list-audio-files': noListAudioFiles } },
 *     'nma-env': { rules: { 'no-process-env': noProcessEnv } },
 *   },
 *   rules: {
 *     'nma-audio/no-list-audio-files': 'error',
 *     'nma-env/no-process-env': 'error',
 *   },
 */

const STORE_FILE = "state/audioLibraryStore.ts";
const STORE_TEST_FILE = "state/audioLibraryStore.test.ts";

/**
 * Rule: no-list-audio-files
 * Forbid calling listAudioFiles() directly from components.
 */
export const noListAudioFiles = {
  meta: {
    type: "problem",
    docs: {
      description: "Forbid calling listAudioFiles() from components; use useAudioLibrary() instead",
      category: "Best Practices",
      recommended: true,
    },
    schema: [],
    messages: {
      noListAudioFiles:
        "Do not call listAudioFiles() from a component. Use useAudioLibrary() instead (AGENTS.md D16). listAudioFiles() has exactly one caller: state/audioLibraryStore.ts.",
    },
  },
  create(context) {
    const filename = (context.filename || "").replace(/\\/g, "/");

    if (filename.includes(STORE_FILE) || filename.includes(STORE_TEST_FILE)) {
      return {};
    }

    return {
      CallExpression(node) {
        const callee = node.callee;
        if (
          callee.type === "Identifier" &&
          callee.name === "listAudioFiles"
        ) {
          context.report({
            node,
            messageId: "noListAudioFiles",
          });
        }
      },
    };
  },
};

/**
 * Rule: no-process-env
 * Forbid process.env usage; use dependency injection instead.
 */
export const noProcessEnv = {
  meta: {
    type: "problem",
    docs: {
      description: "Forbid process.env usage; use dependency injection instead",
      category: "Best Practices",
      recommended: true,
    },
    schema: [],
    messages: {
      noProcessEnv:
        "Do not use process.env directly. Inject configuration via dependency injection instead.",
    },
  },
  create(context) {
    return {
      MemberExpression(node) {
        if (
          node.object.type === "Identifier" &&
          node.object.name === "process" &&
          node.property.type === "Identifier" &&
          node.property.name === "env"
        ) {
          context.report({
            node,
            messageId: "noProcessEnv",
          });
        }
      },
    };
  },
};
