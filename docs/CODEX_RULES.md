# Kooch Codex Rules

Last reviewed: 2026-09-28
Status: Active

## 1. Task size

- Small prompts.
- One feature / one focused objective per task.
- One logical commit per completed task.
- Do not bundle unrelated refactors.

## 2. Mandatory model header

Before every Codex task prompt, state:

```text
Model: GPT-6 Sol / GPT-6 Luna / GPT-6 Astra
Effort: Low / Medium / High
Reason: ...
```

Selection guideline:

- GPT-6 Sol — default for normal development, endpoint, migration, validation, finance/voucher/payment/UI work.
- GPT-6 Luna — tiny mechanical changes such as labels, imports, CSS, simple field/type changes.
- GPT-6 Astra — genuinely hard architecture, cross-subsystem finance design, ambiguous/high-risk debugging.
- Do not use Astra merely because a task is important.

## 3. Reuse first

Always inspect the closest existing implementation before creating a new one.

```text
Reuse
↓
Extend
↓
Create
```

Do not create duplicate dialogs, tables, date pickers, form controls, receipt/voucher document markup, or authorization patterns.

## 4. Preserve architecture

Do not change without explicit decision:

- One User model
- Membership model
- Permission Matrix
- Workspace architecture
- routing/folder conventions
- theme/design system
- calendar-driven availability/pricing
- financial history semantics

Backend business logic belongs in Services; controllers stay thin. Frontend must not reimplement backend business rules.

## 5. Property authorization

Property access must come from active membership + effective permissions.

Platform role alone is not sufficient.

Do not shortcut permissions because a user is an Owner/Admin at another scope.

## 6. Financial/history safety

For Payment, Voucher, Settlement, Refund, Reversal, Adjustment, or other historical-document tasks:

- Prefer persisted immutable/snapshotted data.
- Never silently substitute mutable live fields for missing historical values.
- Never rewrite original successful-payment or settlement history to model a later correction.
- Use append-only adjustments/refunds/reversals for later financial effects.
- If a required historical field lacks a safe immutable source, STOP and report the exact gap rather than guessing.

## 7. Migrations

- EF migration source is schema history; do not hand-edit database history.
- Never edit `__EFMigrationsHistory` manually.
- Do not make known orphan source-only migrations discoverable.
- Creating a migration is not the same as applying it.
- Do not apply a migration unless the task/user explicitly asks for it.
- Do not invent/backfill historical snapshot values from mutable live data unless explicitly approved.

## 8. Validation scope

Run only checks relevant to the files/layers changed.

Examples:

- backend-only task → focused backend tests + Release build + `git diff --check`
- frontend-only task → focused frontend tests + typecheck + `git diff --check`
- cross-stack task → focused checks for both affected sides

Do not run unrelated full suites by default.

## 9. UI rules

- Preserve existing visual language unless redesign is requested.
- RTL first.
- Light/dark theme aware.
- Responsive and accessible.
- Semantic tokens/classes; avoid hard-coded colors.
- `KoochDialog` for dialogs.
- `KoochConfirmDialog` for confirmations.
- `KoochTable` family for tables.
- React Hook Form + Zod for redesigned forms where applicable.

## 10. Ambiguity rule

If ambiguity could cause the wrong domain, authorization, schema, or historical-finance change:

**STOP and report the blocker. Do not guess.**

A narrow stop is preferable to a plausible but incorrect implementation.

## 11. Report after task

Report only what changed and what was verified:

- files changed
- API/routes if relevant
- migration name/status if relevant
- authorization behavior
- important product/domain behavior
- focused tests/build/typecheck/diff check
- blockers

Do not claim a migration was applied or a commit was created unless it actually was.

## 12. Commit discipline

Do not commit unless explicitly requested.

After a successfully completed implementation, suggest one concise conventional commit message, e.g.:

```text
feat(finance): add property settlement history
```
