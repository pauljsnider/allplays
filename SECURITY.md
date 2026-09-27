# Security Policy

## Report vulnerabilities privately

Do not open a public issue, pull request, discussion, or support post for a
suspected security or privacy vulnerability.

Use GitHub's
[private vulnerability reporting](https://github.com/pauljsnider/allplays/security/advisories/new)
to report the problem. The private report allows the reporter and maintainers
to investigate, develop a fix, and coordinate deployment without publishing an
unpatched attack path.

Normal product bugs and feature requests that do not involve security or
privacy can continue to use the public issue tracker.

## What to include

Provide the smallest safe description that lets maintainers understand the
affected workflow:

- The affected page, API, or user role.
- The expected and observed authorization or privacy boundary.
- Impact and severity in plain language.
- Reproduction steps using synthetic accounts and redacted identifiers.
- Any suggested remediation or regression test.

## Never include

Do not include any of the following in a public or private report:

- Passwords, session tokens, API secrets, service-account material, private
  keys, cookies, or authorization headers.
- Invite codes, access codes, password-reset links, payment links, or signed
  URLs.
- Real user email addresses, phone numbers, names, addresses, medical
  information, or information about minors.
- Raw production database records, support conversations, logs, screenshots,
  or transcripts containing personal or protected data.

Use synthetic examples and replace sensitive values with labels such as
`[REDACTED_EMAIL]`, `[REDACTED_CODE]`, and `[REDACTED_TOKEN]`. Treat any
identifier accidentally posted publicly as compromised and revoke or rotate it
before continuing the investigation.

## Scope and support

The production service and the current `master` branch receive security fixes.
Historical deployments and unsupported local modifications are out of scope.

AllPlays does not currently promise a bug bounty or a fixed response time.
Maintainers will triage private reports, prioritize issues according to
customer and data impact, and publish details only after the production fix is
verified.

## Automation and disclosure

Automated security scouts and maintainers must route suspected vulnerabilities
to a private advisory or another access-controlled security queue. Public issue
automation may record only non-sensitive coordination metadata and must not
publish exploit instructions, production identifiers, or private user data.
