# Kooch

Kooch is an early-stage booking platform foundation built as a simple monorepo.

## Projects

- `frontend` - Next.js 15, TypeScript, Tailwind CSS, and the App Router
- `backend` - ASP.NET Core 9 Web API with Entity Framework Core and SQL Server
- `docs` - project and database planning notes

## Getting started

### Frontend

```bash
cd frontend
npm install
npm run dev
```

### Backend

Update the SQL Server connection string in `backend/Kooch.Api/appsettings.json`, then run:

```bash
cd backend/Kooch.Api
dotnet restore
dotnet run
```

Swagger is available in development at the `/swagger` path shown by the backend launch URL.

### Authentication

The development seed creates this SuperAdmin account:

```text
Email: admin@kooch.local
Password: Admin@12345
```

Use `POST /api/auth/login` with the credentials above, copy the returned `token`, then select
**Authorize** in Swagger and enter the token. `GET /api/auth/me` can be used to verify it.

Public registration is available at `POST /api/auth/register`. The role defaults to `Client`;
only `Client` and `Owner` are accepted through public registration.

JWT values are configured under `Jwt` in `backend/Kooch.Api/appsettings.json`. Override the
development signing key in deployed environments, for example with `Jwt__Key`.

### Property management API

Use Swagger to test the property workflow:

1. Log in as `admin@kooch.local`, authorize Swagger with the returned JWT, and note a valid
   `DestinationId` from the seeded database.
2. Register an `Owner` with `POST /api/auth/register`, then log in as that owner.
3. Create a property with `POST /api/owner/properties`. Owner-created properties start as
   `PendingReview`.
4. Add room types through `POST /api/owner/properties/{propertyId}/room-types`. Add named rooms
   through `POST /api/owner/room-types/{roomTypeId}/rooms` when physical room tracking is needed.
5. Log back in as SuperAdmin and approve the property with
   `PUT /api/admin/properties/{id}/approve`.
6. Verify that the approved property appears at `GET /api/properties` and
   `GET /api/properties/{slug}` without authentication.

Owner endpoints enforce property ownership. Owner assistants require active property access with
the relevant management flags, and admin assistants require `ManageProperties` permission.
