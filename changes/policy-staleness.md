patch

- `reins policy` refuses a branch that conflicts with `main`, or is behind it
  where the repo requires branches up to date, with "merge main into the branch"
  in the message, and waits while GitHub is still computing mergeability after a
  push. An agent in `--wait` fixes the branch in the same loop instead of
  finding out from a failed `gh pr merge`.
