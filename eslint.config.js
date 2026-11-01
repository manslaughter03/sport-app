import js from "@eslint/js";
import tseslint from "typescript-eslint";
import globals from "globals";
import reactHooks from "eslint-plugin-react-hooks";

export default tseslint.config(
  {
    ignores: [
      "dist/**",
      "coverage/**",
      "node_modules/**",
      ".npm-cache/**",
      "playwright-report/**",
      "test-results/**",
    ],
  },

  js.configs.recommended,
  ...tseslint.configs.recommended,

  {
    files: ["**/*.{ts,tsx}"],
    languageOptions: {
      ecmaVersion: 2022,
      globals: { ...globals.browser, ...globals.node },
    },
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      eqeqeq: ["error", "always", { null: "ignore" }],
      "no-console": ["warn", { allow: ["warn", "error"] }],
    },
  },

  // ---------------------------------------------------------------------------
  // Architecture boundaries (docs/architecture.md §4). Enforced here, not by
  // discipline: the domain layer must stay pure so it stays testable in
  // milliseconds and free of time-zone bugs.
  // ---------------------------------------------------------------------------
  {
    files: ["src/domain/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["**/data/**", "**/ui/**", "../data/*", "../ui/*"],
              message:
                "domain/ must not import from data/ or ui/. The domain is pure: no DB, no DOM.",
            },
            {
              group: ["dexie", "preact", "preact/*", "@preact/*"],
              message:
                "domain/ must not import framework or storage libraries. Keep it plain TypeScript.",
            },
          ],
        },
      ],
      // Time is always injected (docs/architecture.md §4). A stray `new Date()`
      // here is how day-boundary and DST bugs get in.
      "no-restricted-globals": [
        "error",
        {
          name: "Date",
          message:
            "domain/ must not read the wall clock. Pass `now`/`today` in as a parameter.",
        },
        {
          name: "performance",
          message: "domain/ must not read the wall clock. Inject time as a parameter.",
        },
      ],
      "no-restricted-syntax": [
        "error",
        {
          selector: "NewExpression[callee.name='Date']",
          message:
            "domain/ must not construct Date. Inject time (IsoDate/IsoInstant strings) instead.",
        },
        {
          selector:
            "CallExpression[callee.object.name='Date'][callee.property.name='now']",
          message: "domain/ must not call Date.now(). Inject time as a parameter.",
        },
      ],
    },
  },

  // Preact hooks share React's rules: the exhaustive-deps check is what catches
  // a liveQuery subscription that never rebuilds when its inputs change.
  {
    files: ["src/ui/**/*.{ts,tsx}"],
    plugins: { "react-hooks": reactHooks },
    rules: {
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "warn",
    },
  },

  // Tests may use the clock and import fixtures freely; they are not shipped.
  {
    files: ["**/*.{test,spec}.{ts,tsx}", "e2e/**/*.ts"],
    rules: {
      "no-restricted-globals": "off",
      "no-restricted-syntax": "off",
      "no-restricted-imports": "off",
      "@typescript-eslint/no-non-null-assertion": "off",
    },
  },

  {
    files: ["*.config.{ts,js}", "eslint.config.js"],
    languageOptions: { globals: globals.node },
  },
);
