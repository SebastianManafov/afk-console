# Security Policy

## Supported version

Security fixes are applied to the latest commit on `main`.

## Reporting a vulnerability

Do not open a public issue for vulnerabilities involving authentication, token storage, command authorization, proxy routing or credential exposure. Use GitHub's private vulnerability reporting for this repository when available.

Include the affected commit, reproduction steps, impact and a suggested mitigation. Do not include real Microsoft tokens, passwords, session keys or proxy credentials.

## Security boundaries

- The dashboard must remain private and protected by a strong password.
- Microsoft authentication uses the official device-code flow.
- Runtime secrets belong in environment variables, never source control.
- `DATA_DIR` contains sensitive encrypted state and must not be published.
- Proxy use does not by itself guarantee anonymity; verify the effective egress address independently.
