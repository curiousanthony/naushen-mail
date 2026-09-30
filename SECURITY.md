# Security Policy

## Reporting a vulnerability
Please **do not open a public issue**. Report privately through GitHub:
<https://github.com/curiousanthony/naushen-mail/security/advisories/new> ("Report a vulnerability" on the Security tab).

Include what you found, how to reproduce it, the affected version and OS, and the impact you see. Do not include real mail or tokens.
You can expect an acknowledgement within a few days. This is a small, volunteer-run project, so there are no guaranteed
timelines, but confirmed issues are prioritised and reporters are credited if they wish.

## Scope
In scope: the app in this repository, especially handling of untrusted email HTML, OAuth tokens and local storage, and the
release/build pipeline. Out of scope: vulnerabilities in Electron, Google or Microsoft services themselves (report those upstream).

## Supported versions
Only the latest release receives security fixes.

## Design notes
Email HTML is sanitised and rendered in a sandboxed iframe without scripts; remote images are blocked by default; tokens are
encrypted with the OS secure store (Electron `safeStorage`) and never logged. See [docs/PRIVACY.md](docs/PRIVACY.md).
