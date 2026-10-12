---
name: verify-app
description: >
  Prove a change works against the running app with realistic data, and record
  the evidence in the PR. Use after changing routes, UI, APIs, or deploy
  behavior, or when the user asks to run, check, or verify the app.
---

# Verify app

A green gate is necessary, not sufficient: it says nothing about the screen or
route you changed.

1. Start the app the way `docs/contributing/getting-started.md` says, on a fresh
   or seeded local dataset. Never against production data.
2. Create the data the change needs first. A passing health check or sign-in
   proves nothing about the changed surface.
3. Drive the changed surface. For HTTP, assert on content, not only status. For
   UI, use browser automation at a realistic viewport and exercise the changed
   flow plus one edge case (empty state, a second user, bad input).
4. Watch the server log and browser console for errors while you do it.
5. After deploy (when policy allows), confirm `/health` on the deployed origin
   reports the merge sha.
6. Record what you ran and what you saw in the PR's Testing section, with a
   screenshot for UI changes.

If you write the same driver script twice, turn it into a script with a test
instead; that is the trigger for an app CLI in `docs/contributing/growth.md`.
