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

