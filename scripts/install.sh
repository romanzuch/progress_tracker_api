#!/usr/bin/env bash
# Step 2: install runtime and dev dependencies, write tool configs
set -euo pipefail

npm install express zod dotenv cors helmet morgan
npm install -D typescript tsx vitest eslint @eslint/js typescript-eslint eslint-config-prettier prettier @types/node @types/express @types/cors @types/morgan

[ -f vitest.config.ts ] || cat > vitest.config.ts <<'EOF'
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
  },
});
EOF

[ -f eslint.config.js ] || cat > eslint.config.js <<'EOF'
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import eslintConfigPrettier from 'eslint-config-prettier';

export default tseslint.config(
  js.configs.recommended,
  ...tseslint.configs.recommended,
  eslintConfigPrettier,
  {
    ignores: ['dist/**', 'node_modules/**'],
  },
  {
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    },
  },
);
EOF

[ -f .prettierrc.json ] || cat > .prettierrc.json <<'EOF'
{
  "singleQuote": true,
  "semi": true,
  "trailingComma": "all"
}
EOF
