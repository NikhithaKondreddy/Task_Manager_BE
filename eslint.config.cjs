module.exports = [
  {
    files: ["**/*.js"],
    languageOptions: { ecmaVersion: 2022 },
    env: { node: true, es2021: true },
    rules: {
      "no-console": "warn",
      "no-unused-vars": ["warn", { "argsIgnorePattern": "^_" }],
      "no-undef": "error"
    }
  }
];
