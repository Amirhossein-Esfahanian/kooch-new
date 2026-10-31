using System.ComponentModel.DataAnnotations;
using Kooch.Api.Data;
using Kooch.Api.Dtos.AuditLogs;
using Kooch.Api.Dtos.Pricing;
using Kooch.Api.Entities;
using Kooch.Api.Services;
using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;
using Xunit;

namespace Kooch.Api.Tests;

public sealed partial class AdminAuditLogTests
{
    private static readonly DateOnly PriceDay = DateOnly.FromDateTime(DateTime.UtcNow).AddDays(10);

    [Fact]
    public void PriceHistoryMigration_ContainsOnlyNullableLinkIndexAndNoActionForeignKey()
    {
        var migration = new Kooch.Api.Migrations.LinkRoomPriceHistoryToAuditLog();
        Assert.Equal(3, migration.UpOperations.Count);
        var column = Assert.Single(migration.UpOperations.OfType<Microsoft.EntityFrameworkCore.Migrations.Operations.AddColumnOperation>());
        Assert.Equal("AuditLogId", column.Name); Assert.Equal("int", column.ColumnType); Assert.True(column.IsNullable);
        var index = Assert.Single(migration.UpOperations.OfType<Microsoft.EntityFrameworkCore.Migrations.Operations.CreateIndexOperation>());
        Assert.Equal(new[] { "AuditLogId", "AffectedDateFrom", "Id" }, index.Columns);
        var fk = Assert.Single(migration.UpOperations.OfType<Microsoft.EntityFrameworkCore.Migrations.Operations.AddForeignKeyOperation>());
        Assert.Equal("AuditLogs", fk.PrincipalTable);
        Assert.Equal(Microsoft.EntityFrameworkCore.Migrations.ReferentialAction.NoAction, fk.OnDelete);
        Assert.Equal(3, migration.DownOperations.Count);
    }

    [Fact]
    public async Task PriceDetails_BoundExpansionOfVeryLongRanges_AndExcludeUnchangedDates()
    {
        await using var db = Memory(); await Seed(db);
        var history = new RoomDailyPriceHistory { PropertyId = 10, RoomTypeId = 20, ChangedByUserId = 1,
            AffectedDateFrom = PriceDay, AffectedDateTo = DateOnly.MaxValue, OldBasePrice = 1, NewBasePrice = 2 };
        db.RoomDailyPriceHistory.Add(history);
        Service(db).RecordPriceChanges(1, 10, [history], new Dictionary<int, string> { [20] = "Room" });
        await db.SaveChangesAsync();
        var page = await Service(db).GetPriceChangesForAdminAsync(1, history.AuditLogId!.Value, new() { PropertyId = 10, PageSize = 50 });
        Assert.Equal(50, page.Items.Count); Assert.True(page.HasMore);
        Assert.Equal(PriceDay.AddDays(49), page.NextAfter);
    }

    [Fact]
    public async Task PriceEvent_ContainsOnlyActuallyChangedDates_AndFailedValidationWritesNothing()
    {
        await using var db = Memory(); await Seed(db);
        var pricing = new RoomDailyPriceService(db, new PropertyAccessService(db), Service(db));
        await pricing.BulkUpdateAsync(1, UserRole.SuperAdmin, 10, new() { BasePrice = 100,
            Items = [new() { RoomTypeId = 20, Date = PriceDay }] });
        await pricing.BulkUpdateAsync(1, UserRole.SuperAdmin, 10, new() { BasePrice = 100,
            Items = [new() { RoomTypeId = 20, Date = PriceDay }, new() { RoomTypeId = 20, Date = PriceDay.AddDays(3) }] });
        var log = await db.AuditLogs.OrderByDescending(item => item.Id).FirstAsync();
        var page = await Service(db).GetPriceChangesForAdminAsync(1, log.Id, new() { PropertyId = 10 });
        Assert.Equal(PriceDay.AddDays(3), Assert.Single(page.Items).Date);
        await Assert.ThrowsAsync<ArgumentException>(() => pricing.BulkUpdateAsync(1, UserRole.SuperAdmin, 10,
            new() { BasePrice = -1, Items = [new() { RoomTypeId = 20, Date = PriceDay }] }));
        Assert.Equal(2, await db.AuditLogs.CountAsync());
        Assert.Equal(2, await db.RoomDailyPriceHistory.CountAsync());
    }

    [Fact]
    public async Task PriceEvents_GroupEachRoomAndOperation_WithExactLinksAndScatteredDates()
    {
        await using var db = Memory(); await Seed(db);
        db.RoomTypes.Add(new RoomType { Id = 21, PropertyId = 10, Name = "Second room", Slug = "second",
            TotalInventory = 2, MaxAdults = 2, IsActive = true });
        await db.SaveChangesAsync();
        var pricing = new RoomDailyPriceService(db, new PropertyAccessService(db), Service(db));
        var request = new BulkRoomDailyPriceRequest { BasePrice = 100, Items =
        [new() { RoomTypeId = 20, Date = PriceDay }, new() { RoomTypeId = 20, Date = PriceDay.AddDays(1) },
         new() { RoomTypeId = 20, Date = PriceDay.AddDays(4) }, new() { RoomTypeId = 21, Date = PriceDay }] };
        await pricing.BulkUpdateAsync(1, UserRole.SuperAdmin, 10, request);
        var firstLogs = await db.AuditLogs.OrderBy(log => log.Id).ToListAsync();
        Assert.Equal(2, firstLogs.Count);
        Assert.Equal(new[] { 20, 21 }, firstLogs.Select(log => log.EntityId!.Value));
        Assert.Equal("Room", firstLogs[0].EntityName);
        var firstHistory = await db.RoomDailyPriceHistory.ToListAsync();
        Assert.All(firstHistory, history =>
        {
            var log = firstLogs.Single(item => item.EntityId == history.RoomTypeId);
            Assert.Equal(log.Id, history.AuditLogId);
            Assert.Equal(log.OccurredAtUtc, history.ChangedAtUtc);
        });
        var page = await Service(db).GetPriceChangesForAdminAsync(1, firstLogs[0].Id, new() { PropertyId = 10 });
        Assert.Equal(new[] { PriceDay, PriceDay.AddDays(1), PriceDay.AddDays(4) }, page.Items.Select(day => day.Date));
        Assert.All(page.Items, day => { Assert.Equal(0, day.PreviousPrice); Assert.Equal(100, day.NewPrice); });
        Assert.False(page.HasMore);
        await pricing.BulkUpdateAsync(1, UserRole.SuperAdmin, 10, request);
        Assert.Equal(2, await db.AuditLogs.CountAsync());
        request.BasePrice = 150;
        await pricing.BulkUpdateAsync(1, UserRole.SuperAdmin, 10, request);
        Assert.Equal(4, await db.AuditLogs.CountAsync());
        var secondLog = await db.AuditLogs.Where(log => log.EntityId == 20).OrderByDescending(log => log.Id).FirstAsync();
        // Independent events remain separate through the FK.
        var secondPage = await Service(db).GetPriceChangesForAdminAsync(1, secondLog.Id, new() { PropertyId = 10 });
        Assert.All(secondPage.Items, day => { Assert.Equal(100, day.PreviousPrice); Assert.Equal(150, day.NewPrice); });
        var originalPage = await Service(db).GetPriceChangesForAdminAsync(1, firstLogs[0].Id, new() { PropertyId = 10 });
        Assert.All(originalPage.Items, day => Assert.Equal(100, day.NewPrice));
        var list = await Service(db).GetForAdminAsync(1, new() { PageSize = 2 });
        Assert.Equal(4, list.TotalCount);
        Assert.All(list.Items, row => Assert.True(row.HasPriceDetails));
        Assert.Equal(list.Items.OrderByDescending(row => row.OccurredAtUtc).ThenByDescending(row => row.Id).Select(row => row.Id), list.Items.Select(row => row.Id));
    }

    [Fact]
    public async Task PriceDetails_PaginateInsideRanges_KeepDifferentOldPricesAndGuestCategory()
    {
        await using var db = Memory(); await Seed(db);
        var pricing = new RoomDailyPriceService(db, new PropertyAccessService(db), Service(db));
        await pricing.BulkUpdateAsync(1, UserRole.SuperAdmin, 10, new() { BasePrice = 50,
            GuestType = PricingGuestType.Foreign, Items = [new() { RoomTypeId = 20, Date = PriceDay.AddDays(2) }] });
        var request = new BulkRoomDailyPriceRequest { BasePrice = 100, GuestType = PricingGuestType.Foreign,
            Items = Enumerable.Range(0, 13).Select(offset => new RoomDailyPriceCellRequest { RoomTypeId = 20, Date = PriceDay.AddDays(offset) }).ToList() };
        await pricing.BulkUpdateAsync(1, UserRole.SuperAdmin, 10, request);
        var log = await db.AuditLogs.OrderByDescending(item => item.Id).FirstAsync();
        var first = await Service(db).GetPriceChangesForAdminAsync(1, log.Id, new() { PropertyId = 10 });
        Assert.Equal(10, first.Items.Count); Assert.True(first.HasMore); Assert.Equal(PriceDay.AddDays(9), first.NextAfter);
        Assert.Equal(50, first.Items[2].PreviousPrice);
        Assert.All(first.Items.Where(item => item.Date != PriceDay.AddDays(2)), item => Assert.Equal(0, item.PreviousPrice));
        var last = await Service(db).GetPriceChangesForAdminAsync(1, log.Id, new() { PropertyId = 10, After = first.NextAfter });
        Assert.Equal(3, last.Items.Count); Assert.False(last.HasMore); Assert.Null(last.NextAfter);
        Assert.Equal(13, first.Items.Concat(last.Items).Select(item => item.Date).Distinct().Count());
        Assert.All(first.Items.Concat(last.Items), item => Assert.Equal(PricingGuestType.Foreign, item.GuestType));
    }

    [Fact]
    public async Task PriceCopy_LinksOnlyActualDestinationChanges()
    {
        await using var db = Memory(); await Seed(db);
        var pricing = new RoomDailyPriceService(db, new PropertyAccessService(db), Service(db));
        await pricing.BulkUpdateAsync(1, UserRole.SuperAdmin, 10, new() { BasePrice = 80,
            Items = [new() { RoomTypeId = 20, Date = PriceDay }] });
        var request = new CopyRoomDailyPriceRequest { SourceGuestType = PricingGuestType.Iranian,
            DestinationGuestType = PricingGuestType.Foreign, Items = [new() { RoomTypeId = 20, Date = PriceDay }] };
        await pricing.CopyAsync(1, UserRole.SuperAdmin, 10, request);
        await pricing.CopyAsync(1, UserRole.SuperAdmin, 10, request);
        Assert.Equal(2, await db.AuditLogs.CountAsync());
        var log = await db.AuditLogs.OrderByDescending(item => item.Id).FirstAsync();
        var page = await Service(db).GetPriceChangesForAdminAsync(1, log.Id, new() { PropertyId = 10 });
        var day = Assert.Single(page.Items);
        Assert.Equal(PricingGuestType.Foreign, day.GuestType); Assert.Equal(80, day.NewPrice);
    }

    [Theory]
    [InlineData(3)]
    [InlineData(4)]
    public async Task PriceDetails_DenyOwnerAndUnpermittedAdmin(int userId)
    {
        await using var db = Memory(); await Seed(db);
        await Assert.ThrowsAsync<UnauthorizedAccessException>(() => Service(db).GetPriceChangesForAdminAsync(userId, 1, new() { PropertyId = 10 }));
    }

    [Theory]
    [InlineData(0)]
    [InlineData(51)]
    public async Task PriceDetails_EnforceBoundedPageSize(int size)
    {
        await using var db = Memory(); await Seed(db);
        await Assert.ThrowsAsync<ValidationException>(() => Service(db).GetPriceChangesForAdminAsync(1, 1, new() { PropertyId = 10, PageSize = size }));
    }

    [Fact]
    public async Task PriceDetails_CheckPropertyOnParentAndChildren_AndKeepLegacySummaries()
    {
        await using var db = Memory(); await Seed(db);
        var log = new AuditLog { UserId = 1, PropertyId = 10, Action = AuditAction.PriceChanged, EntityType = "RoomDailyPrice", EntityId = 20 };
        db.AuditLogs.Add(log); await db.SaveChangesAsync();
        // Unlinked history must never be inferred from room/date/actor.
        db.RoomDailyPriceHistory.Add(new() { PropertyId = 10, RoomTypeId = 20, ChangedByUserId = 1,
            AffectedDateFrom = PriceDay, AffectedDateTo = PriceDay, OldBasePrice = 1, NewBasePrice = 2 });
        db.RoomDailyPriceHistory.Add(new() { AuditLogId = log.Id, PropertyId = 999, RoomTypeId = 20,
            AffectedDateFrom = PriceDay, AffectedDateTo = PriceDay, OldBasePrice = 1, NewBasePrice = 2 });
        await db.SaveChangesAsync();
        await Assert.ThrowsAsync<KeyNotFoundException>(() => Service(db).GetPriceChangesForAdminAsync(1, log.Id, new() { PropertyId = 999 }));
        Assert.Empty((await Service(db).GetPriceChangesForAdminAsync(1, log.Id, new() { PropertyId = 10 })).Items);
        var list = await Service(db).GetForAdminAsync(1, new());
        Assert.False(Assert.Single(list.Items).HasPriceDetails);
        var ownerContract = await Service(db).GetByPropertyAsync(1, UserRole.SuperAdmin, 10);
        Assert.Equal(log.Id, Assert.Single(ownerContract).Id);
        Assert.Null(typeof(AuditLogResponse).GetProperty("HasPriceDetails"));
    }

    [Fact]
    public async Task PriceWriteFailure_RollsBackPricesAuditAndHistoryInSameSave()
    {
        await using var connection = new SqliteConnection("Data Source=:memory:");
        await connection.OpenAsync(); SqliteTestFunctions.RegisterLen(connection);
        await using var db = new KoochDbContext(new DbContextOptionsBuilder<KoochDbContext>().UseSqlite(connection).Options);
        await db.Database.EnsureCreatedAsync(); await Seed(db);
        await db.Database.ExecuteSqlRawAsync("CREATE TRIGGER fail_price_history BEFORE INSERT ON RoomDailyPriceHistory BEGIN SELECT RAISE(ABORT, 'fixture failure'); END;");
        var pricing = new RoomDailyPriceService(db, new PropertyAccessService(db), Service(db));
        await Assert.ThrowsAsync<DbUpdateException>(() => pricing.BulkUpdateAsync(1, UserRole.SuperAdmin, 10,
            new() { BasePrice = 100, Items = [new() { RoomTypeId = 20, Date = PriceDay }] }));
        db.ChangeTracker.Clear();
        Assert.Empty(db.RoomDailyPrices); Assert.Empty(db.AuditLogs); Assert.Empty(db.RoomDailyPriceHistory);
        await db.Database.ExecuteSqlRawAsync("DROP TRIGGER fail_price_history;");
        await pricing.BulkUpdateAsync(1, UserRole.SuperAdmin, 10,
            new() { BasePrice = 100, Items = [new() { RoomTypeId = 20, Date = PriceDay }] });
        db.ChangeTracker.Clear();
        Assert.Equal((await db.AuditLogs.SingleAsync()).Id, (await db.RoomDailyPriceHistory.SingleAsync()).AuditLogId);
        var detail = await Service(db).GetPriceChangesForAdminAsync(1, (await db.AuditLogs.SingleAsync()).Id, new() { PropertyId = 10 });
        Assert.Equal(100, Assert.Single(detail.Items).NewPrice);
    }
}
