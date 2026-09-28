# Kooch Local Setup

Last reviewed: 2026-09-28

## Prerequisites

- Node.js / npm
- .NET SDK compatible with the backend project
- SQL Server
- EF Core CLI (`dotnet-ef`) if not already available

## Repository

```powershell
git clone <repository-url>
cd kooch
```

## Frontend

```powershell
cd frontend
npm install
npm run dev
```

Run frontend checks when needed:

```powershell
npm run typecheck
```

Use the repository's existing test command/scripts for focused frontend tests.

## Backend

```powershell
cd backend\Kooch.Api
dotnet restore
dotnet run
```

## Database

Configure the SQL Server connection string using the repository's existing configuration / secrets convention, then from `backend\Kooch.Api` run:

```powershell
dotnet ef database update
```

Useful verification commands:

```powershell
dotnet ef migrations list
dotnet build -c Release
```

Do not edit `__EFMigrationsHistory` manually. If repository migration source and database history differ, resolve the mismatch through repository source or an explicit corrective migration.

## Development notes

- Frontend and backend are separate applications; run commands from the appropriate directory.
- Apply only migrations that are intended for the current environment.
- For finance/history schema changes, do not backfill mutable live values into historical snapshots unless the product decision explicitly requires and validates that backfill.
- Prefer focused tests/builds for the layer changed by the task.
