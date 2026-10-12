# External services

Every account, app, and integration the project depends on. Agents read this
instead of guessing which services exist. Never put secret values here; name
where each secret is stored.

Columns: what the service is for, how it connects, where its secrets or config
live (names only), who owns the account, and how to recover access if the
owner's login is lost (password manager entry, recovery codes location, second
admin).

| Service           | Purpose                            | Connection                    | Secrets / config                                        | Owner | Recovery  |
| ----------------- | ---------------------------------- | ----------------------------- | ------------------------------------------------------- | ----- | --------- |
| GitHub            | Source, PRs, Actions CI, issues    | Repo                          | Branch protection requires the `validate` check         | _you_ | _fill in_ |
| CodeRabbit        | Optional AI review comments        | GitHub App on the repo        | none                                                    | _you_ | _fill in_ |
| Cursor Bugbot     | AI review on PRs (primary)         | Cursor GitHub App on the repo | Cursor account linked to the PR author's GitHub account | _you_ | _fill in_ |
| Hosting           | _fill in when the stack is chosen_ |                               |                                                         |       |           |
| Database          | _fill in_                          |                               |                                                         |       |           |
| Backups (offsite) | _fill in_                          |                               |                                                         |       |           |
| Email             | _fill in_                          |                               |                                                         |       |           |
| Error tracking    | _fill in_                          |                               |                                                         |       |           |
| Analytics         | _fill in_                          |                               |                                                         |       |           |

A reviewer app listed in `reins.json` → `policy.reviewers` must be installed
here: `npx reins doctor` reports one that has never run on the repo, and the
merge policy refuses rather than waits for it
([shipping-policy.md](./shipping-policy.md), Configuration).

## Setup checklist (once the repo is on GitHub)

1. Enable Cursor Bugbot for the repository in the Cursor dashboard.
2. Optionally install the CodeRabbit GitHub App on the repository.
3. Protect `main`: require the `validate` check (the job in `validate.yml`, and
   what `policy.ciCheck` defaults to), require PRs.
