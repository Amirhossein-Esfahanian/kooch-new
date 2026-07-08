# Kooch AI Agent Rules

## Core Principle
Write the smallest correct change. Do not over-engineer. Prefer fixing the existing structure over creating new abstractions.

Before writing code, check:
1. Is there already a component, helper, API method, type, or pattern for this?
2. Can this be solved by editing existing code?
3. Is a new dependency really necessary?
4. Will this change make future maintenance easier or harder?

## Kooch Project Rules

### Reuse First
- Do not create one-off UI components when a shared component exists.
- Prefer existing project patterns over introducing new architecture.
- Keep changes localized unless a shared abstraction is clearly needed.

### Dialogs, Modals, Alerts
- Use `KoochDialog` / `KoochModal` for large create/edit forms.
- Use `KoochAlert` / `KoochConfirmDialog` for confirmations, warnings, questions, delete prompts, unusual price confirmation, and “are you sure?” flows.
- Do not build custom modal/dialog/sheet implementations directly inside pages.
- Room add/edit dialogs must use a fixed-size modal shell with scrollable body and sticky footer.
- Dialogs must support RTL, dark mode, consistent header/footer behavior, and future replacement from one place.

### Toasts
- Use Sonner for toast notifications.
- Do not introduce another toast/notification system.

### UI Consistency
- Use existing Tailwind conventions in the project.
- Prefer `rounded-lg` over `rounded-2xl` in admin/owner panels unless there is a specific design reason.
- Respect dark mode.
- Respect RTL layout.
- Keep forms, buttons, spacing, tables, and cards consistent with existing Kooch UI.

### Calendar / Pricing / Inventory
- Be careful with date picker and date range logic.
- Pricing bulk edit date range display has known issues; avoid rewriting it blindly.
- For range selection, preserve desktop/mobile behavior if already implemented.
- Do not change calendar logic unless the task explicitly requires it.

### Authentication / User Management
- Username/login sprint is incomplete and has known defects.
- Do not assume login/account flows are stable.
- Make small, testable changes.

### Backend / EF Core
- Do not ignore EF Core migration warnings.
- If the model changed, create a migration before updating the database.
- Avoid database changes unless required.
- Keep DTOs, API contracts, and entity models aligned.

### Code Style
- TypeScript: avoid `any` unless unavoidable.
- Prefer explicit types for API responses and form payloads.
- Keep functions short.
- Remove dead code.
- Do not add comments explaining obvious code.
- Add comments only for tricky business logic.

### Dependencies
- Do not add packages unless the project truly needs them.
- Prefer existing libraries already used in the project.
- If adding a package, explain why existing code cannot solve the problem.

### Implementation Behavior
- First inspect relevant files.
- Then make the smallest safe change.
- Do not refactor unrelated files.
- Do not rename files, routes, or components unless necessary.
- Do not change styling globally unless the request is global.
- Do not generate large new systems for small bugs.



### Shared Components
- Before creating a new component, look for an existing Kooch component.
- Extend existing shared components whenever practical.
- If a new shared component is required, place it where it can be reused.

### Forms
- Prefer existing Kooch form controls (`KoochInput`, `KoochSelect`, `KoochTextarea`, etc.).
- Keep validation behavior and spacing consistent across admin and owner panels.

### Booking Domain
- Reuse existing PricingService, Inventory, Promotion, Guest, and Permission systems.
- Do not duplicate business logic already implemented in backend services.

### Project Backlog Awareness
- Some modules are intentionally incomplete (for example login flow and date picker improvements).
- Do not redesign unfinished modules unless the task explicitly requests it.
- Prefer incremental improvements over rewrites.

### Testing Checklist
Before finishing:
- Backend builds successfully if backend changed.
- Frontend builds successfully if frontend changed.
- Light mode and dark mode are checked.
- RTL layout is preserved.
- Existing behavior outside the requested scope is unchanged.

### Final Response Format
After changes, explain:
1. What changed
2. Which files changed
3. Why this approach was chosen
4. Any risks or follow-up items

## Removed / Softened from Generic Ponytail
- Removed broad philosophical rules that do not directly help Kooch.
- Softened the “write no code” mindset because Kooch needs active UI/form development.
- Removed extreme anti-abstraction guidance because Kooch needs reusable components.
- Removed anything that would prevent creating shared components such as `KoochDialog`.
- Removed unrelated language/framework rules.
- Removed generic performance/security advice that could create noisy, unfocused changes.
- Softened overly strict rules that might make the AI too conservative for simple fixes.
