Kooch AI Agent Rules

1. Purpose

This file defines the operating rules for AI coding agents working on Kooch.

The primary objective is to make the smallest correct change while preserving:

confirmed product rules

architecture integrity

shared-component consistency

RTL behavior

existing theme behavior

accessibility

current business logic

Do not over-engineer, introduce parallel systems, or refactor unrelated code.

2. Project Documentation

Before changing code, read the relevant documentation under gpt/.

Source priority

When sources conflict, use this order:

gpt/Product_Rules.md — confirmed product behavior

gpt/Kooch_Architecture.md — confirmed technical architecture

gpt/03_UI_Design_System.md — confirmed UI and shared-component rules

gpt/04_Coding_Guidelines.md — implementation and verification rules

gpt/05_Current_State.md — current implementation state and active work

gpt/06_Backlog.md — planned and deferred work

gpt/00_Project_Overview.md — project scope and goals

gpt/99_Next_Chat_Prompt.md — supplemental continuity notes

Interpretation rules

A Confirmed rule must not be changed without explicit user approval.

Current State describes what is true now.

Backlog describes planned work and is not permission to implement it automatically.

Planned, Future, Deferred, and incomplete items must not be treated as implemented.

When documentation and code disagree, report the mismatch before making a broad correction.

Do not edit ProjectContext Markdown files unless the task explicitly includes documentation updates.

3. Required Pre-Task Inspection

Before writing code:

Read the relevant ProjectContext files.

Inspect the target files and their direct consumers.

Search for an existing component, helper, service, DTO, API method, type, or project pattern.

Check whether the task touches a confirmed product or architecture decision.

Define the smallest safe scope.

Identify required verification commands.

Only then implement.

If required information is missing, do not invent product behavior. Ask for clarification.

4. Core Product and Architecture Rules

The following must not change without explicit approval:

One User model

Guest is not a separate identity

Workspace model

Property Membership model

Permission Matrix

Calendar-driven pricing and capacity

OnRequest reservation workflow

REST API architecture

layered backend architecture

EF Core and migration-driven database changes

reusable-first frontend strategy

Authorization

Authorization follows:

Authentication→ Workspace→ Membership→ Permission→ Action

Do not use Platform Role to replace Property Membership permissions.

Business logic

Backend services own business logic.

Controllers handle validation, mapping, and responses.

Frontend handles presentation, local state, and API interaction.

Do not move backend business rules into React components.

5. Reuse First

Always prefer:

Reuse→ Extend→ Create

Rules:

Do not create duplicate or one-off shared components.

Do not introduce a parallel API for an existing shared component.

Prefer updating stale consumers over restoring a removed shared API, unless restoring it is explicitly safer and justified.

Shared components must not depend on feature-specific components.

Features may depend on shared components.

Before creating a new component, confirm that an existing Kooch component cannot be reused or safely extended.

6. Shared UI Rules

Use the established shared components:

KoochButton

KoochDialog / KoochModal

KoochConfirmDialog

KoochAlert

KoochLoading

existing Kooch form controls

KoochSearchSelect

shared date-picker components

shared image-picker components

shared capacity and pricing editors

Dialogs and confirmations

Use KoochDialog for large forms, previews, and modal content.

Use KoochConfirmDialog or KoochAlert for confirmations, warnings, destructive actions, and questions.

Do not implement custom modal, focus trap, overlay, scroll lock, or dialog semantics inside feature pages.

KoochDialog is the shared owner of:

Portal rendering

focus trapping

focus restoration

Escape handling

scroll locking

accessible modal semantics

Preserve fixed shell, scrollable body, and sticky footer behavior where established.

Notifications

Use Sonner.

Do not introduce another toast system.

Forms

Prefer existing Kooch form controls.

Preserve the existing form library and validation pattern used by the target feature.

Do not migrate a working form to another form library unless the task explicitly requests it.

Labels, help text, and errors must be programmatically associated with their controls.

Invalid controls must expose aria-invalid.

Error messages must be announced appropriately.

Tabs

Custom tabs must implement the complete WAI-ARIA tabs pattern, including:

roving tabIndex

aria-selected

aria-controls

associated tab panels

keyboard focus management

Home and End support

RTL-aware ArrowLeft and ArrowRight behavior

7. Visual and Responsive Rules

RTL first.

Mobile first.

Use logical spacing where practical.

Preserve existing light- and dark-theme behavior.

Use semantic theme tokens instead of hard-coded color values.

Do not run a broad public dark-mode migration automatically.

Public dark-mode scope is a product decision currently deferred.

Do not remove existing dark-mode support.

Do not redesign layouts unless the task explicitly requests redesign.

Prefer rounded-lg in admin and owner panels unless an established component or explicit design requires otherwise.

Preserve existing typography and fonts.

Primary touch controls should normally provide a 44px hit area on touch devices.

Do not unnecessarily enlarge dense desktop table controls.

Respect prefers-reduced-motion; simplify non-essential motion without removing functionality.

8. Authentication Rules

Authentication and registration work is incomplete and must be changed incrementally.

Current product direction:

Guest authentication is intended to use a dialog.

Owner and Admin authentication are intended to use a full login page.

Final Guest registration is planned as OTP-first:

mobile or email

OTP verification

first and last name

create User

automatic login

This final registration flow is planned, not fully implemented.

Therefore:

Do not assume the current login or registration flow is final.

Do not redesign or replace authentication contracts unless explicitly requested.

Keep UI, API, DTO, Session, and redirect behavior aligned.

Do not add public owner/admin registration.

Preserve the One User model.

9. Reservation and Property Rules

Owner must not manually create reservations.

Owner must not cancel paid reservations.

Cancelled reservations are read-only.

Reservation cancellation requires an authorized actor, reason, and explanation.

OnRequest inventory is not reduced before approval.

Calendar remains the source of truth for availability, pricing, and capacity.

Do not rewrite date-range, pricing, capacity, or inventory logic without task-specific scope.

Preserve existing desktop/mobile range-selection behavior unless the task explicitly changes it.

10. Backend and Database Rules

Keep DTOs, API contracts, services, and entities aligned.

Do not expose EF entities directly to the UI.

If the data model changes, create and review an EF Core migration.

Do not create migrations for UI-only changes.

Do not ignore migration or package warnings.

Avoid manual SQL unless explicitly justified.

Important multi-step operations must use transactions where appropriate.

Do not add dependencies unless existing project code cannot reasonably solve the task.

11. Coding Rules

Make one focused change per task.

Do not refactor unrelated files.

Do not rename files, routes, or components unless necessary.

Do not change global styling for a local problem.

Avoid any unless unavoidable and justified.

Prefer explicit API response and payload types.

Keep functions focused and readable.

Remove dead code introduced or exposed by the change when safe.

Add comments only for non-obvious business or technical logic.

Preserve UTF-8 and existing Persian strings.

Never introduce mojibake.

If corrupted Persian encoding exists, fix the encoding rather than rewriting text blindly.

12. Impeccable and Audit Workflow

Audit tools may inspect the whole repository, but fixes must be implemented as small, restricted tasks.

Never run broad, unconstrained commands such as:

harden

adapt

colorize

optimize

animate

distill

polish

without an explicit file and behavior scope.

Current audit order

Unless the user changes priorities:

Shared accessibility

MediaGallery preview using KoochDialog

Authentication tabs accessibility

Image optimization

Touch-target normalization

Duplicate login cleanup

Reduced-motion support

Final audit

Deferred audit item

Broad public dark-mode migration

Do not treat the deferred dark-mode decision as an automatic bug fix.

13. Current Project Awareness

Before starting work, read gpt/05_Current_State.md.

Known current concerns include:

shared accessibility

MediaGallery dialog refactor

authentication tabs accessibility

image optimization

touch-target improvements

UI audit hardening

incomplete Guest registration

incomplete Workspace and Reservation work

Do not assume backlog items are complete merely because related components exist.

14. Verification

Run verification appropriate to the changed scope.

Frontend changes

At minimum:

npm run typecheck
npm run build
git diff --check

Run the existing test suite when available:

npm test

For focused components, also run relevant targeted tests when available.

Backend changes

At minimum:

backend build

relevant tests

migration review if the model changed

Manual checks where relevant

RTL layout

keyboard navigation

focus visibility

dialog focus behavior

mobile layout

existing light/dark behavior

no regression outside scope

Never claim a command passed unless it was actually run successfully.

15. Git and Change Safety

Do not discard unrelated user changes.

Do not modify generated files unless the task requires it.

Do not commit automatically unless explicitly requested.

Keep tool initialization files, product documentation, and functional code in separate commits when practical.

Before a broad tool installation or audit-driven change, recommend a clean commit or checkpoint.

Report unexpected repository changes before continuing.

16. Final Response Format

After implementation, report:

Summary

What changed.

Files Changed

Exact files changed.

Why

Why this approach was selected.

Verification

Commands and checks actually completed.

Side Effects / Risks

Known effects or risks.

Remaining Work

Only relevant follow-up work.

If no files were changed, state that explicitly.

17. Final Rule

Preserve project integrity over implementation speed.

When speed conflicts with confirmed product rules, architecture, shared-component consistency, or data safety, preserve the project rules and explain the constraint.
