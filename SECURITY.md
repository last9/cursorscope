# Security Policy

## Supported versions

Only the latest release on npm is supported with security fixes.

## Reporting a vulnerability

**Do not open a public GitHub issue for security vulnerabilities.**

Email: security@last9.io

Include:
- Description of the vulnerability
- Steps to reproduce
- Potential impact
- Any suggested fix

You will receive a response within 5 business days. We will coordinate a fix and disclosure timeline with you.

## Scope

This project runs locally on developer machines and exports telemetry to an OTLP endpoint you configure. Key areas:

- **Credential handling** — OTLP auth tokens in `.env` and env vars
- **Privacy redaction** — prompt text, API keys, bearer tokens scrubbed from spans/logs
- **Hook input** — JSON from Cursor hook events processed by the ingestor

## Out of scope

- Attacks requiring physical access to the developer's machine
- Issues in dependencies (report to the upstream project)
