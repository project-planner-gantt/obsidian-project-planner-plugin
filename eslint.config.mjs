import obsidianmd from "eslint-plugin-obsidianmd";
export default [
  { ignores: ["node_modules/**", "dist/**", "vendor/**", ".test-runtime/**", "scripts/**", "tests/**", "*.config.*", "svelte.config.js", "eslint.config.mjs"] },
  ...obsidianmd.configs.recommended,
  {
    files: ["src/**/*.ts"],
    languageOptions: { parserOptions: { projectService: true } },
    rules: {
      "@typescript-eslint/no-unsafe-assignment": "error",
      "@typescript-eslint/no-unsafe-call": "error",
      "@typescript-eslint/no-unsafe-member-access": "error",
      "@typescript-eslint/no-unsafe-argument": "error",
      "@typescript-eslint/no-unsafe-return": "error",
    },
  },
];
