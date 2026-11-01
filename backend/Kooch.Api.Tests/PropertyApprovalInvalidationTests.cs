using System.Text.Json;
using Kooch.Api.Data;
using Kooch.Api.Dtos.Admin;
using Kooch.Api.Dtos.Properties;
using Kooch.Api.Entities;
using Kooch.Api.Exceptions;
using Kooch.Api.Services;
using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Diagnostics;
using Xunit;

namespace Kooch.Api.Tests;

public sealed class PropertyApprovalInvalidationTests
{
    [Theory]
    [InlineData("name")]
    [InlineData("description")]
    [InlineData("country")]
    [InlineData("city")]
    [InlineData("address")]
    [InlineData("check-in")]
    [InlineData("check-out")]
    public async Task RequiredInformationGap_InvalidatesAndAudits(string field)
    {
        await using var fixture = await Fixture.CreateAsync();
        await using var db = fixture.NewContext();
        var ids = fixture.Ids;
        var service = PropertyApprovalTestData.Service(db);
        switch (field)
        {
            case "name":
                await service.UpdateBasicSectionAsync(ids.OwnerId, UserRole.Client, ids.PropertyId, new() { Name = "  " });
                break;
            case "description":
                await service.UpdateDescriptionSectionAsync(ids.OwnerId, UserRole.Client, ids.PropertyId, new() { Description = "  " });
                break;
            case "country": case "city": case "address":
                await service.UpdateLocationSectionAsync(ids.OwnerId, UserRole.Client, ids.PropertyId, new()
                {
                    DestinationId = ids.DestinationId, Country = field == "country" ? "" : "Iran",
                    City = field == "city" ? "" : "City", Address = field == "address" ? "" : "Address"
                });
                break;
            default:
                await service.UpdateRulesSectionAsync(ids.OwnerId, UserRole.Client, ids.PropertyId, new()
                {
                    CheckInTime = field == "check-in" ? null : new TimeOnly(14, 0),
                    CheckOutTime = field == "check-out" ? null : new TimeOnly(12, 0)
                });
                break;
        }
        await using var verify = fixture.NewContext();
        Assert.Equal(PropertyStatus.Draft, (await verify.Properties.SingleAsync()).Status);
        Assert.False((await new PropertyCompletionService(verify, null!).CalculateAsync(ids.PropertyId)).CanActivate);
        await PropertyApprovalTestData.AssertInvalidationAuditAsync(verify, ids, ids.OwnerId);
    }

    [Theory]
    [InlineData(false)]
    [InlineData(true)]
    public async Task LastPropertyImageDeleteOrReassignment_Invalidates(bool reassign)
    {
        await using var fixture = await Fixture.CreateAsync();
        await using var db = fixture.NewContext();
        var ids = fixture.Ids;
        if (reassign)
            await PropertyApprovalTestData.Images(db).UpdateAsync(ids.OwnerId, UserRole.Client, ids.ImageId,
                new() { Url = "/property.jpg", RoomTypeId = ids.RoomTypeId });
        else
            await PropertyApprovalTestData.Images(db).DeleteAsync(ids.OwnerId, UserRole.Client, ids.ImageId);
        await using var verify = fixture.NewContext();
        Assert.Equal(PropertyStatus.Draft, (await verify.Properties.SingleAsync()).Status);
        await PropertyApprovalTestData.AssertInvalidationAuditAsync(verify, ids, ids.OwnerId);
    }

    [Fact]
    public async Task InvalidImageUrlInvalidatesButMetadataAndNonLastDeletionDoNot()
    {
        await using var fixture = await Fixture.CreateAsync();
        await using var db = fixture.NewContext();
        var ids = fixture.Ids;
        var images = PropertyApprovalTestData.Images(db);
        await images.UpdateAsync(ids.AdminId, UserRole.SuperAdmin, ids.ImageId,
            new() { Url = "/updated.jpg", Caption = "New caption" });
        await images.CreateAsync(ids.AdminId, UserRole.SuperAdmin, ids.PropertyId, new() { Url = "/second.jpg" });
        await images.DeleteAsync(ids.AdminId, UserRole.SuperAdmin, ids.ImageId);
        Assert.Equal(PropertyStatus.Approved, (await db.Properties.SingleAsync()).Status);
        var remaining = await db.PropertyImages.SingleAsync();
        await images.UpdateAsync(ids.AdminId, UserRole.SuperAdmin, remaining.Id, new() { Url = "  " });
        Assert.Equal(PropertyStatus.Draft, (await db.Properties.SingleAsync()).Status);
        await PropertyApprovalTestData.AssertInvalidationAuditAsync(db, ids, ids.AdminId);
    }

    [Theory]
    [InlineData(PropertyStatus.Draft)]
    [InlineData(PropertyStatus.PendingReview)]
    [InlineData(PropertyStatus.Rejected)]
    [InlineData(PropertyStatus.Suspended)]
    public async Task OtherStatusesArePreserved(PropertyStatus status)
    {
        await using var fixture = await Fixture.CreateAsync(status);
        await using var db = fixture.NewContext();
        await PropertyApprovalTestData.Service(db).UpdateDescriptionSectionAsync(
            fixture.Ids.AdminId, UserRole.SuperAdmin, fixture.Ids.PropertyId, new() { Description = "" });
        Assert.Equal(status, (await db.Properties.SingleAsync()).Status);
        Assert.Empty(await db.AuditLogs.ToListAsync());
    }

    [Fact]
    public async Task RecoveryRequiresExplicitAdminApproval()
    {
        await using var fixture = await Fixture.CreateAsync();
        await using var db = fixture.NewContext();
        var ids = fixture.Ids;
        var service = PropertyApprovalTestData.Service(db);
        await service.UpdateDescriptionSectionAsync(ids.OwnerId, UserRole.Client, ids.PropertyId, new() { Description = "" });
        await service.UpdateDescriptionSectionAsync(ids.OwnerId, UserRole.Client, ids.PropertyId, new() { Description = "Recovered" });
        Assert.True((await new PropertyCompletionService(db, null!).CalculateAsync(ids.PropertyId)).CanActivate);
        Assert.Equal(PropertyStatus.Draft, (await db.Properties.SingleAsync()).Status);
        Assert.Equal(PropertyStatus.Approved, (await service.ApprovePropertyAsync(ids.AdminId, UserRole.SuperAdmin, ids.PropertyId)).Status);
    }

    [Theory]
    [InlineData(false)]
    [InlineData(true)]
    public async Task FullOwnerAndAdminUpdatesCannotKeepIntroducedGapsApproved(bool admin)
    {
        await using var fixture = await Fixture.CreateAsync();
        await using var db = fixture.NewContext();
        var ids = fixture.Ids;
        var service = PropertyApprovalTestData.Service(db);
        if (admin)
            await service.UpdatePropertyForAdminAsync(ids.AdminId, UserRole.SuperAdmin, ids.PropertyId, new AdminUpdatePropertyRequest
            {
                OwnerId = ids.OwnerId, DestinationId = ids.DestinationId, Name = "Property", Country = "Iran",
                City = "City", Address = "Address", Description = "", Status = PropertyStatus.Approved,
                CheckInTime = new TimeOnly(14, 0), CheckOutTime = new TimeOnly(12, 0)
            });
        else
            await service.UpdatePropertyAsync(ids.OwnerId, UserRole.Client, ids.PropertyId, new UpdatePropertyRequest
            {
                DestinationId = ids.DestinationId, Name = "Property", Country = "Iran", City = "City", Address = "Address",
                Description = "", CheckInTime = new TimeOnly(14, 0), CheckOutTime = new TimeOnly(12, 0)
            });
        Assert.Equal(PropertyStatus.Draft, (await db.Properties.SingleAsync()).Status);
        await PropertyApprovalTestData.AssertInvalidationAuditAsync(db, ids, admin ? ids.AdminId : ids.OwnerId);
        await Assert.ThrowsAsync<PropertyActivationException>(() => service.ApprovePropertyAsync(ids.AdminId, UserRole.SuperAdmin, ids.PropertyId));
    }

    [Fact]
    public async Task ValidRequiredEditsAndOptionalEditsPreserveApproval()
    {
        await using var fixture = await Fixture.CreateAsync();
        await using var db = fixture.NewContext();
        var ids = fixture.Ids;
        var service = PropertyApprovalTestData.Service(db);
        await service.UpdateBasicSectionAsync(ids.OwnerId, UserRole.Client, ids.PropertyId, new() { Name = "New valid name" });
        await service.UpdateDescriptionSectionAsync(ids.OwnerId, UserRole.Client, ids.PropertyId, new() { Description = "New valid description" });
        await service.UpdateBuildingSectionAsync(ids.OwnerId, UserRole.Client, ids.PropertyId, new() { FloorsCount = null });
        await service.UpdateFinancialSectionAsync(ids.OwnerId, UserRole.Client, ids.PropertyId, new() { ExtraGuestPrice = null });
        await service.UpdateSeoSectionAsync(ids.OwnerId, UserRole.Client, ids.PropertyId, new() { SeoTitle = null });
        Assert.Equal(PropertyStatus.Approved, (await db.Properties.SingleAsync()).Status);
        Assert.DoesNotContain(await db.AuditLogs.ToListAsync(), log => log.NewValuesJson?.Contains("\"Status\":\"Draft\"") == true);
    }

    [Theory]
    [InlineData(false)]
    [InlineData(true)]
    public async Task AuditFailureRollsBackMutationAndInvalidation(bool imageMutation)
    {
        var failure = new FailInvalidationAudit();
        await using var fixture = await Fixture.CreateAsync(interceptor: failure);
        await using var db = fixture.NewContext();
        failure.Enabled = true;
        if (imageMutation)
            await Assert.ThrowsAsync<DbUpdateException>(() => PropertyApprovalTestData.Images(db).DeleteAsync(
                fixture.Ids.AdminId, UserRole.SuperAdmin, fixture.Ids.ImageId));
        else
            await Assert.ThrowsAsync<DbUpdateException>(() => PropertyApprovalTestData.Service(db).UpdateDescriptionSectionAsync(
                fixture.Ids.AdminId, UserRole.SuperAdmin, fixture.Ids.PropertyId, new() { Description = "" }));
        await using var verify = fixture.NewContext();
        Assert.Equal(PropertyStatus.Approved, (await verify.Properties.SingleAsync()).Status);
        Assert.Equal("Description", (await verify.Properties.SingleAsync()).Description);
        Assert.Single(await verify.PropertyImages.ToListAsync());
        Assert.Empty(await verify.AuditLogs.ToListAsync());
    }

    [Fact]
    public async Task CompletenessReadFailureRollsBackWithoutInvalidation()
    {
        await using var fixture = await Fixture.CreateAsync();
        await using var db = fixture.NewContext();
        await Assert.ThrowsAsync<TimeoutException>(() => PropertyApprovalTestData.Service(db, new UnavailableCompletion())
            .UpdateDescriptionSectionAsync(fixture.Ids.AdminId, UserRole.SuperAdmin, fixture.Ids.PropertyId, new() { Description = "" }));
        await using var verify = fixture.NewContext();
        Assert.Equal(PropertyStatus.Approved, (await verify.Properties.SingleAsync()).Status);
        Assert.Equal("Description", (await verify.Properties.SingleAsync()).Description);
        Assert.Empty(await verify.AuditLogs.ToListAsync());
    }

    [Fact]
    public async Task MissingMembershipAndCrossPropertyWritesAreDenied()
    {
        await using var fixture = await Fixture.CreateAsync();
        await using var db = fixture.NewContext();
        var stranger = new User { FirstName = "Stranger", Role = UserRole.Client, IsActive = true };
        db.Users.Add(stranger);
        await db.SaveChangesAsync();
        await Assert.ThrowsAsync<UnauthorizedAccessException>(() => PropertyApprovalTestData.Service(db)
            .UpdateDescriptionSectionAsync(stranger.Id, UserRole.Client, fixture.Ids.PropertyId, new() { Description = "" }));
        await Assert.ThrowsAsync<UnauthorizedAccessException>(() => PropertyApprovalTestData.Images(db)
            .DeleteAsync(stranger.Id, UserRole.Client, fixture.Ids.ImageId));
        Assert.NotNull(Attribute.GetCustomAttribute(typeof(Kooch.Api.Controllers.AdminPropertiesController),
            typeof(Kooch.Api.Authentication.AdminAuthorizeAttribute)));
        var other = await PropertyApprovalTestData.SeedAsync(db);
        await Assert.ThrowsAsync<UnauthorizedAccessException>(() => PropertyApprovalTestData.Service(db)
            .UpdateDescriptionSectionAsync(fixture.Ids.OwnerId, UserRole.Client, other.PropertyId, new() { Description = "" }));
        Assert.All(await db.Properties.ToListAsync(), property => Assert.Equal(PropertyStatus.Approved, property.Status));
        Assert.Equal(2, await db.PropertyImages.CountAsync());
    }

    [Fact]
    public async Task RoomPricingInventoryAndRoomTypeChangesDoNotInvalidate()
    {
        await using var db = new KoochDbContext(new DbContextOptionsBuilder<KoochDbContext>()
            .UseInMemoryDatabase(Guid.NewGuid().ToString("N")).Options);
        var ids = await PropertyApprovalTestData.SeedAsync(db);
        var access = new PropertyAccessService(db);
        var audit = new AuditLogService(db, new PermissionService(db, access));
        var date = DateOnly.FromDateTime(DateTime.UtcNow).AddDays(1);
        await new RoomDailyPriceService(db, access, audit).BulkUpdateAsync(ids.OwnerId, UserRole.Client, ids.PropertyId,
            new() { BasePrice = 0, Items = [new() { RoomTypeId = ids.RoomTypeId, Date = date }] });
        await new AvailabilityService(db, access, audit, new EffectiveAvailabilityService(db)).SetAsync(
            ids.OwnerId, UserRole.Client, ids.RoomTypeId,
            new() { StartDate = date, EndDate = date, AvailableCount = 0, Status = AvailabilityStatus.Unavailable });
        var rooms = new RoomTypeService(db, access, audit);
        await rooms.UpdateRoomTypeAsync(ids.OwnerId, UserRole.Client, ids.RoomTypeId,
            new() { Name = "Double", MaxAdults = 2, TotalInventory = 0, BasePrice = 0, IsActive = false, RoomKind = RoomKind.Double });
        await rooms.DeleteRoomTypeAsync(ids.OwnerId, UserRole.Client, ids.RoomTypeId);
        Assert.Equal(PropertyStatus.Approved, (await db.Properties.SingleAsync()).Status);
        Assert.DoesNotContain(await db.AuditLogs.ToListAsync(), log => log.NewValuesJson?.Contains("\"Status\":\"Draft\"") == true);
    }

    [Fact]
    public async Task InvalidationDoesNotChangeExistingReservationsSessionsOrPayments()
    {
        await using var db = new KoochDbContext(new DbContextOptionsBuilder<KoochDbContext>()
            .UseInMemoryDatabase(Guid.NewGuid().ToString("N")).Options);
        var ids = await PropertyApprovalTestData.SeedAsync(db);
        var session = new BookingSession { ClientId = ids.OwnerId, PropertyId = ids.PropertyId, SessionCode = "TEST-SESSION", Currency = "IRR" };
        db.BookingSessions.Add(session);
        foreach (var status in new[] { ReservationStatus.Confirmed, ReservationStatus.PendingApproval })
            db.Reservations.Add(new Reservation { BookingSession = session, PropertyId = ids.PropertyId, RoomTypeId = ids.RoomTypeId,
                ClientId = ids.OwnerId, Status = status, AdultCount = 1, TotalPrice = 123, CheckInDate = new(2035, 1, 1), CheckOutDate = new(2035, 1, 2) });
        db.Payments.Add(new Payment { BookingSession = session, Status = PaymentStatus.Pending, Amount = 246 });
        await db.SaveChangesAsync();
        var before = await BookingStateAsync(db);
        await PropertyApprovalTestData.Service(db).UpdateDescriptionSectionAsync(ids.OwnerId, UserRole.Client, ids.PropertyId, new() { Description = "" });
        Assert.Equal(PropertyStatus.Draft, (await db.Properties.SingleAsync()).Status);
        Assert.Equal(before, await BookingStateAsync(db));
    }

    private static async Task<string> BookingStateAsync(KoochDbContext db) => JsonSerializer.Serialize(new
    {
        Reservations = await db.Reservations.AsNoTracking().Select(row => new { row.Id, row.Status, row.TotalPrice, row.GuestId,
            row.TravelerSnapshotKind, row.TravelerFirstNameSnapshot, row.CheckInDate, row.CheckOutDate }).ToArrayAsync(),
        Sessions = await db.BookingSessions.AsNoTracking().Select(row => new { row.Id, row.GuestId, row.ClientId, row.Currency, row.SessionCode }).ToArrayAsync(),
        Payments = await db.Payments.AsNoTracking().Select(row => new { row.Id, row.Status, row.Amount, row.Currency }).ToArrayAsync()
    });

    [Fact]
    public async Task MembershipWithoutEditPermissionDoesNotAllowMutation()
    {
        await using var fixture = await Fixture.CreateAsync();
        await using var db = fixture.NewContext();
        (await db.UserPropertyAccesses.SingleAsync()).PermissionMatrixJson =
            JsonSerializer.Serialize(PropertyPermissionMatrixDefaults.CreateEmpty());
        await db.SaveChangesAsync();
        await Assert.ThrowsAsync<UnauthorizedAccessException>(() => PropertyApprovalTestData.Service(db)
            .UpdateDescriptionSectionAsync(fixture.Ids.OwnerId, UserRole.Client, fixture.Ids.PropertyId, new() { Description = "" }));
        await Assert.ThrowsAsync<UnauthorizedAccessException>(() => PropertyApprovalTestData.Images(db)
            .DeleteAsync(fixture.Ids.OwnerId, UserRole.Client, fixture.Ids.ImageId));
        Assert.Equal(PropertyStatus.Approved, (await db.Properties.SingleAsync()).Status);
    }

    private sealed class FailInvalidationAudit : SaveChangesInterceptor
    {
        public bool Enabled { get; set; }
        public override ValueTask<InterceptionResult<int>> SavingChangesAsync(DbContextEventData eventData,
            InterceptionResult<int> result, CancellationToken cancellationToken = default)
        {
            if (Enabled && eventData.Context!.ChangeTracker.Entries<AuditLog>().Any(entry =>
                entry.State == EntityState.Added && entry.Entity.NewValuesJson?.Contains("\"Status\":\"Draft\"") == true))
                throw new DbUpdateException("Injected invalidation audit failure.");
            return ValueTask.FromResult(result);
        }
    }

    private sealed class UnavailableCompletion : IPropertyCompletionService
    {
        public Task<PropertyCompletionResponse> CalculateAsync(int propertyId, CancellationToken cancellationToken = default) =>
            throw new TimeoutException("Injected read failure.");
        public Task<PropertyCompletionResponse> GetAsync(int userId, UserRole role, int propertyId, CancellationToken cancellationToken = default) =>
            throw new TimeoutException("Injected read failure.");
    }

    private sealed class Fixture(SqliteConnection connection, DbContextOptions<KoochDbContext> options,
        PropertyApprovalTestData.Ids ids) : IAsyncDisposable
    {
        public PropertyApprovalTestData.Ids Ids { get; } = ids;
        public KoochDbContext NewContext() => new(options);
        public static async Task<Fixture> CreateAsync(PropertyStatus status = PropertyStatus.Approved, IInterceptor? interceptor = null)
        {
            var connection = new SqliteConnection("Data Source=:memory:");
            await connection.OpenAsync();
            SqliteTestFunctions.RegisterLen(connection);
            var builder = new DbContextOptionsBuilder<KoochDbContext>().UseSqlite(connection);
            if (interceptor is not null) builder.AddInterceptors(interceptor);
            await using var db = new KoochDbContext(builder.Options);
            await db.Database.EnsureCreatedAsync();
            var ids = await PropertyApprovalTestData.SeedAsync(db, status);
            return new(connection, builder.Options, ids);
        }
        public ValueTask DisposeAsync() => connection.DisposeAsync();
    }
}

internal static class PropertyApprovalTestData
{
    internal sealed record Ids(int AdminId, int OwnerId, int PropertyId, int DestinationId, int RoomTypeId, int ImageId);

    internal static async Task<Ids> SeedAsync(KoochDbContext db, PropertyStatus status = PropertyStatus.Approved)
    {
        var admin = new User { FirstName = "Admin", LastName = "Reviewer", Role = UserRole.SuperAdmin, IsActive = true };
        var owner = new User { FirstName = "Owner", LastName = "User", Role = UserRole.Client, IsActive = true };
        var destination = new Destination { Name = "City", Slug = $"destination-{Guid.NewGuid():N}", Country = "Iran" };
        var property = new Property
        {
            Owner = owner, Destination = destination, Name = "Property", Description = "Description",
            Slug = $"property-{Guid.NewGuid():N}", Country = "Iran", City = "City", Address = "Address",
            Status = status, InventoryMode = InventoryMode.TypeBasedInventory,
            CheckInTime = new TimeOnly(14, 0), CheckOutTime = new TimeOnly(12, 0),
            Images = [new PropertyImage { Url = "/property.jpg" }],
            RoomTypes = [new RoomType { Name = "Double", Slug = "double", MaxAdults = 2, TotalInventory = 2, IsActive = true }],
            UserPropertyAccesses = [new UserPropertyAccess { User = owner, PropertyRole = PropertyUserRole.PropertyOwner,
                Status = PropertyUserStatus.Active, IsActive = true,
                PermissionMatrixJson = JsonSerializer.Serialize(PropertyPermissionMatrixDefaults.CreateOwner()) }]
        };
        db.Users.Add(admin);
        db.Properties.Add(property);
        await db.SaveChangesAsync();
        return new(admin.Id, owner.Id, property.Id, destination.Id, property.RoomTypes.Single().Id, property.Images.Single().Id);
    }

    internal static PropertyService Service(KoochDbContext db, IPropertyCompletionService? completion = null)
    {
        var access = new PropertyAccessService(db);
        return new(db, access, access, new PermissionService(db, access), completion ?? new PropertyCompletionService(db, access), null!);
    }

    internal static PropertyImageService Images(KoochDbContext db) =>
        new(db, new PropertyAccessService(db), null!, new PropertyCompletionService(db, new PropertyAccessService(db)));

    internal static async Task AssertInvalidationAuditAsync(KoochDbContext db, Ids ids, int actor)
    {
        var log = Assert.Single(await db.AuditLogs.Where(item => item.PropertyId == ids.PropertyId &&
            item.NewValuesJson != null && item.NewValuesJson.Contains("\"Status\":\"Draft\"")).ToListAsync());
        Assert.Equal(actor, log.UserId);
        Assert.Equal(AuditAction.PropertyInformationChanged, log.Action);
        using var before = JsonDocument.Parse(log.PreviousValuesJson!);
        using var after = JsonDocument.Parse(log.NewValuesJson!);
        Assert.Equal("Approved", before.RootElement.GetProperty("Status").GetString());
        Assert.Equal("Draft", after.RootElement.GetProperty("Status").GetString());
    }
}
