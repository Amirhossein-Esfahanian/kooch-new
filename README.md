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

### Simple owner frontend

Start the backend on `http://localhost:5081`, then start the frontend:

```bash
cd frontend
npm run dev
```

Open `http://localhost:3000/owner/login` and log in with an Owner account. The temporary UI stores
the JWT in browser localStorage. Use `/owner/properties` to list properties, create one at
`/owner/properties/new`, then open its manage page to edit property details, add room types, and add
named rooms.

The UI hides technical property fields. It generates slugs from names, uses Iran as the country,
and resolves Kashan to the seeded destination (falling back to destination ID `1` for other cities
until city lookup is implemented). Owner and status values continue to come from backend defaults.

For `NamedRooms`, use **Add named room** for unique rooms such as Shah-Abbasi or Toranj; each gets
inventory `1` automatically. For `TypeBasedInventory`, use **Add room type**, enter the total
inventory, and do not create individual room records. The Next.js development server proxies
`/api/backend/*` to the backend API at `http://localhost:5081`.

### Amenity categories

The backend seeds amenity categories and example amenities during startup. The read APIs are:

- `GET /api/amenity-categories`
- `GET /api/amenities`

Open `http://localhost:3000/owner/amenities` to view the amenity catalog grouped by category. This
page is currently read-only; assigning amenities to a property or room type will be added separately.

### Owner availability management

Owners can manage daily room-type availability from the property management page. Select a room
type, choose an inclusive start and end date, then enter the price, optional original price,
available count, status, and optional minimum-night override. Existing rows for the selected range
appear below the form.

The same workflow is available through Swagger:

1. Log in as the property owner and authorize Swagger with the JWT.
2. Create a property and at least one room type if needed.
3. Use `POST /api/owner/room-types/{roomTypeId}/availability` to create or update every date in a
   range.
4. Use `GET /api/owner/room-types/{roomTypeId}/availability?from=YYYY-MM-DD&to=YYYY-MM-DD` to verify
   the rows.

Owners can update only room types belonging to their properties. Owner assistants require active
property access with `CanManageAvailability`; SuperAdmin can manage every property.
