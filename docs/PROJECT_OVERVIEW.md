# Kooch Project Overview

## Purpose

Kooch is a booking platform for discovering and reserving stays. This repository currently establishes the technical foundation only. The initial frontend uses local mock data, while the backend defines the first database model and SQL Server integration.

## Repository structure

```text
kooch/
|-- frontend/    Next.js customer-facing application
|-- backend/     ASP.NET Core Web API and data model
`-- docs/        Product and technical planning notes
```

## Frontend

The frontend uses Next.js 15, TypeScript, Tailwind CSS, and the App Router.

Current routes:

- `/` - landing page and featured stays
- `/stays` - complete mock stay collection
- `/stays/[slug]` - details for one mock stay

Shared UI is kept in `components`, and mock stay data is kept in `lib/stays.ts`. There is no client-side state layer because the current pages are static and server-rendered.

## Backend

The backend is an ASP.NET Core 9 Web API project. Entity Framework Core is configured with the SQL Server provider through `KoochDbContext`.

The first model contains only:

- `User`
- `Property`
- `RoomType`
- `Room`
- `Reservation`

There are no controllers, public endpoints, authentication services, or business workflows in this foundation.

## Current boundaries

- Frontend data is mock data only.
- Frontend and backend are not connected.
- Authentication and authorization are intentionally deferred.
- Booking availability, pricing rules, payments, and reservation workflows are intentionally deferred.
- Database migrations are not included until the model and local SQL Server setup are ready to be adopted.

## Suggested next phase

The next phase can add the first read-only property endpoints, an initial EF Core migration, and frontend API consumption. Authentication and booking commands should follow only after those contracts are clear.

