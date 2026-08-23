/** @type {import('prettier').Config} */
const config = {
  trailingComma: 'none',
  singleQuote: true,
  endOfLine: 'auto',
  printWidth: 100,
  overrides: [
    {
      files: ['tsconfig.json', 'jsconfig.json', 'tsconfig.*.json'],
      options: {
        parser: 'jsonc'
      }
    }
  ]
};

export default config;
