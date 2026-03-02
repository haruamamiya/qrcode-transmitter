# Agent Guidelines (agent-ts)

## Commit Messages

Use [Conventional Commits 1.0.0](https://www.conventionalcommits.org/en/v1.0.0/#specification).

## Changelog

Update `CHANGELOG.md` per [Keep a Changelog 1.1.0](https://keepachangelog.com/en/1.1.0/) when changes are notable to users.

## Pre-commit Checklist

- Commit message follows Conventional Commits
- If user-notable: `CHANGELOG.md` updated under `[Unreleased]` — in the **same commit** as the code changes
- If breaking: `!` or `BREAKING CHANGE:` footer present
- If necessary: `README.md` updated

## Release to npm

1. Move `[Unreleased]` entries in `CHANGELOG.md` into a new `[x.y.z] - YYYY-MM-DD` section and update compare links at bottom
2. Bump version: `npm version patch` (or `minor` / `major`) — creates a git commit and tag
3. Build and test: `pnpm run build && pnpm test`
4. Publish: `npm publish --access public`
5. Push and tags: `git push && git push --tags`
