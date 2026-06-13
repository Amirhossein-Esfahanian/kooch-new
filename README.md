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
