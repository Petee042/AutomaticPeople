# AutomaticPeople Copilot Instructions

Before making any change to UI, layout, styling, page flow, navigation, forms, emails, dashboard/config behavior, or guest/private-reservation flows, read and follow `.github/site-design-rules.md`.

Rules:
- Do not change page structure, naming, navigation labels, or established flows unless explicitly requested.
- Prefer minimal edits over refactors.
- Before editing a page, inspect the nearest existing page in the same feature area and preserve its visual and interaction patterns.
- If a requested feature appears to conflict with existing design rules, stop and state the conflict before editing.
- For dashboard/config work, preserve existing section labels, list behavior, retrieval patterns, and save flows unless the task explicitly changes them.
- For reservation and payment flows, preserve the current end-to-end journey unless the task explicitly changes a step.
- After UI or flow changes, run the narrowest available validation for the touched files.
