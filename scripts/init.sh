#!/usr/bin/env bash
# Step 1: initialize the Node/TypeScript project (npm init, git init, tsconfig, .gitignore, .env)
set -euo pipefail

npm init -y

npm pkg set type="module" \
  scripts.dev="tsx watch server.ts" \
  scripts.build="tsc" \
  scripts.start="node dist/server.js" \
  scripts.test="vitest run" \
  scripts.lint="eslint ." \
  scripts.format="prettier --write ."

[ -d .git ] || git init

[ -f .gitignore ] || cat > .gitignore <<'EOF'
node_modules/
dist/
.env
*.log
.DS_Store
EOF

[ -f tsconfig.json ] || cat > tsconfig.json <<'EOF'
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "lib": ["ES2022"],
    "outDir": "dist",
    "rootDir": ".",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "sourceMap": true
  },
  "include": ["server.ts", "app/**/*.ts", "tests/**/*.ts"],
  "exclude": ["node_modules", "dist"]
}
EOF

[ -f .env ] || cat > .env <<'EOF'
PORT=3000
EOF
