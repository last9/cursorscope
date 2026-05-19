# Contributing to cursorscope

## Setup

```bash
git clone https://github.com/last9/cursorscope.git
cd cursorscope
npm install
cp .env.example .env
# Fill in an OTLP endpoint (local collector is fine)
```

Run tests:

```bash
npm test
npm run lint
```

Start the ingestor against a local OTel Collector:

```bash
docker compose up -d   # starts collector on :4317/:4318
npm start
```

## Making changes

- Keep PRs focused. One concern per PR.
- Add or update tests for any changed behaviour in `test/`.
- Run `npm test && npm run lint` before pushing.
- Do not commit `.env` or any file containing credentials.

## Reporting bugs

Open a GitHub issue. Include:
- Node.js version (`node --version`)
- Cursor version
- Steps to reproduce
- Expected vs actual behaviour
- Relevant log output (`DEBUG_OTEL=true npm start`)

## Pull request checklist

- [ ] Tests pass (`npm test`)
- [ ] Lint passes (`npm run lint`)
- [ ] No secrets in diff
- [ ] README updated if user-visible behaviour changed

## Code style

No build step, plain ESM. `node --test` for tests. No TypeScript compilation — JSDoc types only.
