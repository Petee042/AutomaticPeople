# AutomaticPeople Site Design Rules

## Core Principle

This product is fragile when new features overwrite established page behavior. New changes must preserve existing flows unless the task explicitly replaces them.

## Navigation Rules

- Dashboard tab names must not change without explicit instruction.
- Config pages must preserve existing list, retrieve, edit, and save behavior.
- Reservation enquiry landing pages must preserve existing create, save, return-to-list, and re-open behavior.
- Private reservation flow is sensitive and must not be restructured without checking the current flow first.

## UI Consistency

- Reuse existing CSS classes and layout patterns.
- Do not introduce a new page pattern when an existing one already serves the same purpose.
- Preserve current wording unless the task explicitly changes copy.
- Keep changes local to the feature being edited.

## Form And Data Behavior

- Do not change save or redirect behavior without checking the current page flow first.
- Do not remove existing fields unless explicitly requested.
- If adding fields, preserve current validation and submission conventions.
- For config pages, new saves must remain visible from the main config list after redirect and reload.

## Safe Workflow For UI Edits

Before editing:
1. Read this file.
2. Read the target page and its JavaScript.
3. Read one nearby similar page in the same feature area.
4. Identify what must stay unchanged.
5. Only then edit.

## Sensitive Areas

- Main dashboard and config pages
- Reservation enquiry landing pages
- Private reservation pages and guest payment journey
- Guest account/login/reset flows
- Payment confirmation and public reservation pages
