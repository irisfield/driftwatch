# Contributing to driftwatch

## Setup

```bash
# Install dependencies
bun install

# Start a local pgvector instance (required for integration tests and scripts)
docker run -d --name driftwatch-pg -p 5432:5432 \
  -e POSTGRES_PASSWORD=postgres pgvector/pgvector:pg16

# Copy the env template and fill in your keys
cp .env.example .env
```

## Running tests

```bash
# Unit tests (eval-core only — no database required)
bun test --filter packages/eval-core
```

## Submitting pull requests

- One concern per PR. If a change touches two unrelated things, split it.
- Commit messages describe the change in plain terms. No spec references.
- Run `bun run type-check` and `bun test` locally before opening a PR.
- Breaking changes require a major version bump and a note in the PR description.

Issues are triaged weekly. If you open a PR without a prior issue, include enough context for a cold reviewer to understand the motivation.

## Release process (maintainers only)

```bash
cd packages/eval-core

# 1. Bump version in package.json and jsr.json (keep them in sync)
# 2. Build
bun run build

# 3. Verify the dist output is clean (.mjs and .d.ts only, no .cjs)
ls dist/

# 4. Publish to npm
npm publish --access public

# 5. Publish to JSR
npx jsr publish

# 6. Tag the release
git tag v<version> && git push origin v<version>
```
