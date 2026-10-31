using System.ComponentModel.DataAnnotations;
using System.Reflection;
using System.Text.Json;
using Kooch.Api.Authentication;
using Kooch.Api.Controllers;
using Kooch.Api.Data;
using Kooch.Api.Dtos.AuditLogs;
using Kooch.Api.Dtos.Availability;
using Kooch.Api.Dtos.Pricing;
using Kooch.Api.Entities;
using Kooch.Api.Services;
using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Migrations.Operations;
using Xunit;

namespace Kooch.Api.Tests;

public sealed partial class AdminAuditLogTests
{
    [Fact]
    public void MigrationIsAdditive_OnlyApprovedAuditColumnsConstraintsAndIndexes()
    {
        var migration = new Kooch.Api.Migrations.ExtendAuditLogChangeValues();
        Assert.Equal(6, migration.UpOperations.Count);
        var columns = migration.UpOperations.OfType<AddColumnOperation>().ToList();
        Assert.Equal(2, columns.Count);
        Assert.All(columns, column => { Assert.Equal("AuditLogs", column.Table); Assert.Equal("nvarchar(max)", column.ColumnType); Assert.True(column.IsNullable); });
        Assert.Equal(2, migration.UpOperations.OfType<AddCheckConstraintOperation>().Count());
        Assert.Equal(2, migration.UpOperations.OfType<CreateIndexOperation>().Count());
        Assert.Equal(6, migration.DownOperations.Count);
    }
    private static AuditLogService Service(KoochDbContext db) =>
        new(db, new PermissionService(db, new PropertyAccessService(db)));

    [Fact]
    public void Endpoint_RequiresAdminAndViewReports_HasNoWriteActions()
    {
        Assert.NotNull(typeof(AdminAuditLogsController).GetCustomAttribute<AdminAuthorizeAttribute>());
        Assert.Equal("Permission:ViewReports", typeof(AdminAuditLogsController)
            .GetCustomAttribute<PermissionAuthorizeAttribute>()!.Policy);
        var actions = typeof(AdminAuditLogsController).GetMethods(BindingFlags.DeclaredOnly | BindingFlags.Public | BindingFlags.Instance);
        Assert.Equal(2, actions.Length);
        Assert.All(actions, action => Assert.NotNull(action.GetCustomAttribute<Microsoft.AspNetCore.Mvc.HttpGetAttribute>()));
        Assert.Null(typeof(AuditLogResponse).GetProperty("PreviousValuesJson"));
        Assert.Null(typeof(AuditLogResponse).GetProperty("PreviousValues"));
    }

    [Theory]
    [InlineData(1, true)]
    [InlineData(2, true)]
    [InlineData(3, false)]
    [InlineData(4, false)]
    [InlineData(999, false)]
    public async Task AdminRead_UsesPlatformPermissionAndActiveAdminRole(int actor, bool allowed)
    {
        await using var db = Memory();
        await Seed(db);
        if (allowed) Assert.Equal(0, (await Service(db).GetForAdminAsync(actor, new())).TotalCount);
        else await Assert.ThrowsAsync<UnauthorizedAccessException>(() => Service(db).GetForAdminAsync(actor, new()));
    }

    [Fact]
    public async Task FiltersAndPagination_UseStableOrderAndUtcInclusiveStartExclusiveEnd()
    {
        await using var db = Memory();
        await Seed(db);
        var time = new DateTime(2026, 10, 30, 0, 0, 0, DateTimeKind.Utc);
        for (var id = 1; id <= 5; id++)
            db.AuditLogs.Add(new AuditLog { Id = id, UserId = id == 5 ? 2 : 1,
                PropertyId = id == 4 ? null : 10, Action = id == 3 ? AuditAction.InventoryChanged : AuditAction.PriceChanged,
                EntityType = "RoomDailyPrice", OccurredAtUtc = time });
        db.AuditLogs.Add(new AuditLog { Id = 6, UserId = 1, PropertyId = 10, Action = AuditAction.PriceChanged,
            EntityType = "RoomDailyPrice", OccurredAtUtc = time.AddDays(1) });
        await db.SaveChangesAsync();
        var query = new AdminAuditLogQuery { ActorUserId = 1, PropertyId = 10, Action = AuditAction.PriceChanged,
            FromUtc = new DateTimeOffset(time), ToUtc = new DateTimeOffset(time.AddDays(1)), PageSize = 1 };
        var first = await Service(db).GetForAdminAsync(2, query);
        Assert.Equal(2, first.TotalCount);
        Assert.Equal(2, first.TotalPages);
        Assert.Equal(2, Assert.Single(first.Items).Id);
        query.Page = 2;
        Assert.Equal(1, Assert.Single((await Service(db).GetForAdminAsync(2, query)).Items).Id);
        var all = await Service(db).GetForAdminAsync(2, new());
        Assert.Equal(6, all.TotalCount);
        Assert.Equal(6, all.Items[0].Id);
    }

    [Theory]
    [InlineData(0, 25)]
    [InlineData(1, 101)]
    [InlineData(int.MaxValue, 100)]
    public async Task InvalidPaginationIsRejected(int page, int size)
    {
        await using var db = Memory(); await Seed(db);
        await Assert.ThrowsAsync<ValidationException>(() => Service(db).GetForAdminAsync(1,
            new() { Page = page, PageSize = size }));
    }

    [Fact]
    public async Task ApprovedPropertyAndCapacityChanges_ExcludePiiAndNoOps()
    {
        await using var db = Memory(); await Seed(db);
        var property = await db.Properties.SingleAsync();
        property.Address = "sensitive contact";
        property.Description = "secret";
        AuditLogService.CaptureApprovedChange(db, 1, property);
        Assert.Empty(db.AuditLogs.Local);
        property.DefaultMealPlanId = 25;
        AuditLogService.CaptureApprovedChange(db, 1, property);
        await db.SaveChangesAsync();
        var row = Assert.Single((await Service(db).GetForAdminAsync(1, new())).Items);
        Assert.Null(row.PreviousValues!["DefaultMealPlanId"].GetString());
        Assert.Equal(25, row.NewValues!["DefaultMealPlanId"].GetInt32());
        Assert.Single(row.NewValues);
        Assert.DoesNotContain("sensitive", JsonSerializer.Serialize(row));
        var room = await db.RoomTypes.SingleAsync();
        room.TotalInventory = 4;
        room.Notes = "identity secret";
        AuditLogService.CaptureApprovedChange(db, 1, room);
        await db.SaveChangesAsync();
        AuditLogService.CaptureApprovedChange(db, 1, room);
        await db.SaveChangesAsync();
        Assert.Equal(2, await db.AuditLogs.CountAsync());
        var capacity = (await Service(db).GetForAdminAsync(1, new() { Action = AuditAction.RoomCapacityChanged })).Items.Single();
        Assert.Equal(3, capacity.PreviousValues!["TotalInventory"].GetInt32());
        Assert.Equal(4, capacity.NewValues!["TotalInventory"].GetInt32());
        Assert.DoesNotContain("identity", JsonSerializer.Serialize(capacity));
    }

    [Fact]
    public async Task InventoryWrites_CaptureBeforeAfter_NoOpAndFailedValidationDoNotLog()
    {
        await using var db = Memory(); await Seed(db);
        var service = new AvailabilityService(db, new PropertyAccessService(db), Service(db), new EffectiveAvailabilityService(db));
        var date = DateOnly.FromDateTime(DateTime.UtcNow).AddDays(5);
        var request = new UpsertInventoryRequest { RoomTypeId = 20, Date = date, AvailableCount = 2 };
        await service.UpsertInventoryDayAsync(1, UserRole.SuperAdmin, 10, request);
        await service.UpsertInventoryDayAsync(1, UserRole.SuperAdmin, 10, request);
        Assert.Single(db.AuditLogs);
        request.AvailableCount = 1;
        await service.UpsertInventoryDayAsync(1, UserRole.SuperAdmin, 10, request);
        var log = (await Service(db).GetForAdminAsync(1, new())).Items.First();
        Assert.Equal(2, log.PreviousValues!["AvailableCount"].GetInt32());
        Assert.Equal(1, log.NewValues!["AvailableCount"].GetInt32());
        request.AvailableCount = 4;
        await Assert.ThrowsAsync<ArgumentException>(() => service.UpsertInventoryDayAsync(1, UserRole.SuperAdmin, 10, request));
        Assert.Equal(2, await db.AuditLogs.CountAsync());
    }

    [Fact]
    public async Task LegacyInventoryWriteUsesAuthorizedUntrackedRoom_WithoutExtraRoomLookup()
    {
        await using var db = Memory(); await Seed(db);
        db.ChangeTracker.Clear();
        var service = new AvailabilityService(db, new PropertyAccessService(db), Service(db), new EffectiveAvailabilityService(db));
        var date = DateOnly.FromDateTime(DateTime.UtcNow).AddDays(5);
        await service.SetAsync(1, UserRole.SuperAdmin, 20, new SetAvailabilityRequest
        {
            StartDate = date, EndDate = date, Status = AvailabilityStatus.OnRequest, AvailableCount = 1
        });
        Assert.Single(db.AuditLogs);
        Assert.Equal(10, (await db.AuditLogs.SingleAsync()).PropertyId);
    }

    [Fact]
    public async Task PricingHistoryRemainsDetailedAndNoOpDoesNotCreateAnotherSummary()
    {
        await using var db = Memory(); await Seed(db);
        var service = new RoomDailyPriceService(db, new PropertyAccessService(db), Service(db));
        var request = new BulkRoomDailyPriceRequest { BasePrice = 100,
            Items = [new() { RoomTypeId = 20, Date = DateOnly.FromDateTime(DateTime.UtcNow).AddDays(5) }] };
        await service.BulkUpdateAsync(1, UserRole.SuperAdmin, 10, request);
        await service.BulkUpdateAsync(1, UserRole.SuperAdmin, 10, request);
        request.BasePrice = 150;
        await service.BulkUpdateAsync(1, UserRole.SuperAdmin, 10, request);
        Assert.Equal(2, await db.RoomDailyPriceHistory.CountAsync());
        Assert.Equal(2, await db.AuditLogs.CountAsync());
        Assert.Contains(await db.RoomDailyPriceHistory.ToListAsync(), item => item.OldBasePrice == 100 && item.NewBasePrice == 150);
    }

    [Fact]
    public async Task OnlyAllowlistedNumericSettingsAreRecorded_AndRemainOutsideOwnerFeed()
    {
        await using var db = Memory(); await Seed(db);
        foreach (var setting in db.SiteSettings.ToList())
        {
            setting.Value = "500";
            AuditLogService.CaptureApprovedChange(db, 1, setting);
        }
        var privateSetting = new SiteSetting { Key = "smtp.password", Value = "token secret", Group = "private" };
        db.SiteSettings.Add(privateSetting);
        AuditLogService.CaptureApprovedChange(db, 1, privateSetting);
        await db.SaveChangesAsync();
        Assert.Equal(2, await db.AuditLogs.CountAsync());
        Assert.All(db.AuditLogs, item => Assert.Null(item.PropertyId));
        Assert.DoesNotContain("secret", JsonSerializer.Serialize((await Service(db).GetForAdminAsync(1, new())).Items));
        Assert.Empty(await Service(db).GetByPropertyAsync(1, UserRole.SuperAdmin, 10));
    }

    [Fact]
    public async Task OwnerFeedKeepsItsContract_OnlySafeNewEventLabelsArePropertyScoped()
    {
        await using var db = Memory(); await Seed(db);
        db.UserPropertyAccesses.Add(new UserPropertyAccess { UserId = 3, PropertyId = 10,
            PermissionMatrixJson = "{\"Reports\":{\"View\":true}}" });
        var property = await db.Properties.SingleAsync();
        property.CheckOutTime = new TimeOnly(12, 0);
        property.ShowGuestPhoneToPropertyUsers = true;
        AuditLogService.CaptureApprovedChange(db, 1, property);
        var setting = await db.SiteSettings.FirstAsync();
        setting.Value = "250";
        AuditLogService.CaptureApprovedChange(db, 1, setting);
        await db.SaveChangesAsync();
        var owner = Assert.Single(await Service(db).GetByPropertyAsync(3, UserRole.Client, 10));
        Assert.Equal(AuditAction.PropertyInformationChanged, owner.Action);
        Assert.Equal("Property information changed.", owner.Description);
        var json = JsonSerializer.Serialize(owner);
        Assert.DoesNotContain("Values", json);
        Assert.DoesNotContain("ShowGuestPhone", json);
        Assert.DoesNotContain("SiteSettingsChanged", json);
        await Assert.ThrowsAsync<UnauthorizedAccessException>(() => Service(db).GetByPropertyAsync(3, UserRole.Client, 11));
    }

    [Theory]
    [InlineData(false)]
    [InlineData(true)]
    public async Task SavedAuditLogCannotBeModifiedOrDeleted(bool delete)
    {
        await using var db = Memory(); await Seed(db);
        var log = new AuditLog { UserId = 1, EntityType = "Property", PropertyId = 10 };
        db.AuditLogs.Add(log); await db.SaveChangesAsync();
        if (delete) db.AuditLogs.Remove(log); else log.Description = "rewrite";
        await Assert.ThrowsAsync<InvalidOperationException>(() => db.SaveChangesAsync());
    }

    [Fact]
    public async Task RelationalRollbackRevertsBothBusinessAndAuditWrite_AndJsonConstraintRejectsInvalidData()
    {
        await using var connection = new SqliteConnection("Data Source=:memory:");
        await connection.OpenAsync(); SqliteTestFunctions.RegisterLen(connection);
        var options = new DbContextOptionsBuilder<KoochDbContext>().UseSqlite(connection).Options;
        await using var db = new KoochDbContext(options);
        await db.Database.EnsureCreatedAsync(); await Seed(db);
        await using (var tx = await db.Database.BeginTransactionAsync())
        {
            var property = await db.Properties.SingleAsync();
            property.CheckInTime = new TimeOnly(15, 0);
            AuditLogService.CaptureApprovedChange(db, 1, property);
            await db.SaveChangesAsync();
            await tx.RollbackAsync();
        }
        db.ChangeTracker.Clear();
        Assert.Null((await db.Properties.SingleAsync()).CheckInTime);
        Assert.Empty(db.AuditLogs);
        db.AuditLogs.Add(new AuditLog { UserId = 1, EntityType = "Property", NewValuesJson = "not json" });
        await Assert.ThrowsAsync<DbUpdateException>(() => db.SaveChangesAsync());
        db.ChangeTracker.Clear();
        var failed = await db.Properties.SingleAsync();
        failed.CheckInTime = new TimeOnly(16, 0);
        failed.OwnerId = 999;
        AuditLogService.CaptureApprovedChange(db, 1, failed);
        await Assert.ThrowsAsync<DbUpdateException>(() => db.SaveChangesAsync());
        db.ChangeTracker.Clear();
        Assert.Null((await db.Properties.SingleAsync()).CheckInTime);
        Assert.Empty(db.AuditLogs);
    }

    private static KoochDbContext Memory() => new(new DbContextOptionsBuilder<KoochDbContext>()
        .UseInMemoryDatabase(Guid.NewGuid().ToString()).Options);

    private static async Task Seed(KoochDbContext db)
    {
        db.Users.AddRange(new User { Id = 1, FirstName = "Admin", Role = UserRole.SuperAdmin },
            new User { Id = 2, FirstName = "Assistant", Role = UserRole.AdminAssistant },
            new User { Id = 3, FirstName = "Owner", Role = UserRole.Client },
            new User { Id = 4, FirstName = "Restricted", Role = UserRole.AdminAssistant });
        db.Permissions.Add(new Permission { Key = PermissionKey.ViewReports, Name = "Reports" });
        db.UserPermissions.Add(new UserPermission { UserId = 2, PermissionKey = PermissionKey.ViewReports, IsAllowed = true });
        db.Destinations.Add(new Destination { Id = 1, Name = "Test", Slug = "test", Country = "IR" });
        db.Properties.Add(new Property { Id = 10, OwnerId = 1, DestinationId = 1, Name = "Property", Slug = "property", InventoryMode = InventoryMode.TypeBasedInventory });
        db.RoomTypes.Add(new RoomType { Id = 20, PropertyId = 10, Name = "Room", Slug = "room", TotalInventory = 3,
            MaxAdults = 2, IsActive = true, InventoryMode = InventoryMode.TypeBasedInventory });
        db.SiteSettings.AddRange(new SiteSetting { Key = "pricing.minPrice", Value = "1", Group = "pricing" },
            new SiteSetting { Key = "pricing.maxPrice", Value = "1000", Group = "pricing" });
        await db.SaveChangesAsync();
    }
}
