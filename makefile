.PHONY: init install structure setup dev build start test lint format clean

# 1) Initialize a new Node/TypeScript project (npm init, git init, tsconfig, .gitignore, .env)
init:
	@bash scripts/init.sh

# 2) Install runtime + dev dependencies and write tool configs
install:
	@bash scripts/install.sh

# 3) Create the project structure (see scripts/structure.sh for the source guide)
structure:
	@bash scripts/structure.sh

# Run all three steps in order
setup: init install structure

dev:
	npm run dev

build:
	npm run build

start:
	npm run start

test:
	npm run test

lint:
	npm run lint

format:
	npm run format

clean:
	rm -rf node_modules dist
