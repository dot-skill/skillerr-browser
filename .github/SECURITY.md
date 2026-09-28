# Security policy

Skillerr is a browser that AI apps drive, so we take security reports seriously: prompt injection that gets past page
safety, ways around approvals, the local API or MCP bridge accepting what it shouldn't, and anything that could leak
research memory or notes.

## Reporting a vulnerability

**Please don't open a public issue.** Email **support@skillerr.com** with:

- what you found and its impact,
- steps to reproduce (a test page helps; see `demo/safety-demo.html` for the style),
- the Skillerr version and your operating system.

We aim to reply within a few days. We’ll keep you updated while we fix it, and credit you in the release notes
unless you'd rather not be named.

## Supported versions

Skillerr updates itself, and fixes ship in the latest release.

| Version | Supported |
|---|---|
| 0.1.x (latest) | Yes |
| Older, or betas that have been superseded | No: please update |

## Scope

In scope: this repository (the app, the MCP bridge and the install scripts). The hosted services on skillerr.com are
maintained separately; reports about them are welcome at the same address.
