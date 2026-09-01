# Contributing to RCC

Thanks for improving Remote Console Client.

## Before opening a change

1. Search existing issues and pull requests.
2. Keep changes focused and explain the user-visible behavior.
3. Never include account tokens, `.env` files, proxy credentials or data from a live server.
4. Do not add code or branded assets copied from proprietary dashboards.

## Local workflow

```bash
pnpm install --frozen-lockfile
pnpm test
```

Use clear commit messages in the imperative mood, for example `Add server latency status`. Tests must pass and `git status` must remain clean after the test run.

## Pull requests

Describe the motivation, implementation, verification and any security impact. Add or update tests for backend behavior. For visual changes, include before/after screenshots without personal account information.
