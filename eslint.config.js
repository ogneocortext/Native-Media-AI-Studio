import js from "@eslint/js";
import tseslint from "typescript-eslint";

export default [
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    ignores: [
      "**/*.md",
      "**/*.json",
      "**/*.yaml",
      "**/*.yml",
      "**/*.toml",
      "**/*.txt",
      "**/*.pdf",
      "**/*.png",
      "**/*.jpg",
      "**/*.svg",
      "**/*.ico",
      "**/*.lock",
      "dist/",
      "node_modules/",
      "build/",
      ".vscode/",
      ".git/",
      "*.config.js",
      "*.config.ts"
    ]
  }
];
