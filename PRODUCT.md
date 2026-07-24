# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Kooch currently prioritizes accommodation owners, their assigned property staff, and platform administrators. They use the product to set up and operate one or more properties, control staff access, manage rooms, pricing, inventory, promotions, guests, and reservations, and publish approved stays.

Travelers are a secondary audience at the current stage. The public experience is intended to support discovering properties and completing bookings as that workflow matures.

## Product Purpose

Kooch is an Iran-first accommodation management and booking platform. It connects the operational work of running accommodation inventory with the public journey of finding and reserving a stay.

Success means operators can maintain accurate, bookable property information through permission-appropriate workflows, while travelers can eventually move from discovery to a reliable reservation without the two sides becoming disconnected systems.

## Positioning

Kooch is a unified local platform: Persian-first property operations and a public booking marketplace share the same properties, rooms, pricing, inventory, promotions, guest records, permissions, and reservation foundations.

## Operating Context

- Platform administrators oversee properties, approvals, users, permissions, amenities, promotions, guests, reservations, and platform settings.
- Owners and assigned property users work within a current-property context and manage rooms, daily pricing, inventory, promotions, property users, guests, reservations, reviews, and settings according to their permissions.
- Properties may use named-room inventory or room-type-based inventory.
- Daily pricing and inventory use specialized calendar and range-selection workflows.
- Properties move through platform-controlled publishing states; only approved properties appear publicly.
- Public users can browse and search approved stays. The end-to-end booking flow remains under development.

## Capabilities and Constraints

- The product is a responsive Next.js web application backed by an ASP.NET Core API and SQL Server.
- The primary interface language and direction are Persian and RTL.
- Iranian pricing and date conventions are durable product requirements.
- Light and dark themes must remain supported.
- Access is permission-driven. Roles provide templates, while permission-matrix values determine actual access.
- Non-admin users may belong to one or more properties, and operator workflows must preserve the current property context.
- Shared domain systems for pricing, inventory, promotions, guests, permissions, and reservations should remain the source of business logic rather than being duplicated by individual interfaces.
- Authentication, username/mobile/OTP flows, and parts of the reservation workflow are explicitly incomplete and must not be treated as stable product behavior.
- Date-range and pricing-calendar behavior contains known edge cases and should be changed incrementally.
- Public availability filtering, complete booking commands, payments, and reservation lifecycle operations remain open implementation areas.

## Brand Commitments

- The product name is Kooch.
- Kooch is an Iran-first, Persian RTL product rather than a translated adaptation of a generic left-to-right system.
- Regional pricing and date conventions, responsive behavior, dark mode, and permission-based multi-property workflows must survive future design work.
- No additional aesthetic direction, visual world, or marketing claim was established during product initialization.

## Evidence on Hand

- Product and operating decisions: `PROJECT.md`, `AGENTS.md`, and `docs/PROJECT_CONTEXT.md`.
- Current public and operator routes: `frontend/app`.
- Shared interface components and established interaction patterns: `frontend/components` and `COMPONENTS.md`.
- Current property, reservation, pricing, inventory, promotion, guest, and permission contracts: `backend/Kooch.Api`.
- Persian font assets: `frontend/public/fonts`.
- Demo property photography and uploaded property/site imagery exist under `frontend/public/demo` and `backend/Kooch.Api/wwwroot/uploads`; these are implementation assets, not proof of customers or commercial adoption.
- No confirmed testimonials, customer logos, usage benchmarks, press coverage, pricing claims, or market-performance evidence is on hand. Future work must not fabricate them.

## Product Principles

1. Keep operator truth and traveler-facing availability connected through shared property, pricing, inventory, promotion, guest, and reservation data.
2. Make Persian RTL and Iranian operating conventions native to every workflow.
3. Give each user only the actions allowed by their real property context and permission matrix.
4. Stabilize operational modules incrementally, preserving known calendar, authentication, and booking constraints rather than masking incomplete behavior.
5. Reuse consistent interaction patterns across admin and owner contexts while keeping their routes and responsibilities distinct.

## Accessibility & Inclusion

Kooch must support responsive use, RTL reading and interaction order, keyboard-appropriate form and dialog behavior, and legible light and dark themes. No specific conformance standard or additional assistive-technology requirement has yet been confirmed.
