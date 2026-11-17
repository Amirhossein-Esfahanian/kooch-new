using System.Data.Common;
using Kooch.Api.Data;
using Kooch.Api.Dtos.Reservations;
using Kooch.Api.Entities;
using Kooch.Api.Services;
using Microsoft.Data.SqlClient;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Diagnostics;
using Xunit;
using Xunit.Abstractions;

namespace Kooch.Api.Tests;

public sealed class AdminReservationOrderSummarySqlServerTests(
    SqlServerWalletDatabase database, ITestOutputHelper output) : IClassFixture<SqlServerWalletDatabase>
{
    [SqlServerWalletFact]
    public async Task ActualAdminQuery_FullMembershipAcrossPages_UsesOneBatchNotOneQueryPerRow()
    {
        var seed = await SeedAsync();
        int firstId, secondId, standaloneId, singleId;
        await using (var setup = Open())
        {
            var order = Order(seed.Visible, "B-SQL-MULTI");
            var first = Reservation(seed.Visible, "R-SQL-010", order);
            var second = Reservation(seed.Visible, "R-SQL-020", order);
            var cancelled = Reservation(seed.Visible, "R-SQL-030", order);
            cancelled.Status = ReservationStatus.Cancelled;
            var standalone = Reservation(seed.Visible, "R-SQL-040");
            var single = Reservation(seed.Visible, "R-SQL-050", Order(seed.Visible, "B-SQL-SINGLE"));
            setup.Reservations.AddRange(first, second, cancelled, standalone, single);
            await setup.SaveChangesAsync();
            (firstId, secondId, standaloneId, singleId) = (first.Id, second.Id, standalone.Id, single.Id);
        }

        var firstPage = await SearchAsync(seed.Visible.OwnerId, 1, 1);
        var secondPage = await SearchAsync(seed.Visible.OwnerId, 2, 1);
        Assert.Equal(4, firstPage.Result.TotalCount);
        Assert.Equal(firstId, Assert.Single(firstPage.Result.Items).Id);
        Assert.Equal(secondId, Assert.Single(secondPage.Result.Items).Id);
        foreach (var row in firstPage.Result.Items.Concat(secondPage.Result.Items))
        {
            Assert.Equal("B-SQL-MULTI", row.BookingSessionCode);
            Assert.Equal(3, row.LinkedReservationCount);
        }

        var all = await SearchAsync(seed.Visible.OwnerId, 1, 100);
        Assert.Equal(4, all.Result.Items.Count);
        Assert.Null(all.Result.Items.Single(row => row.Id == standaloneId).BookingSessionCode);
        Assert.Null(all.Result.Items.Single(row => row.Id == standaloneId).LinkedReservationCount);
        var singleRow = all.Result.Items.Single(row => row.Id == singleId);
        Assert.Equal("B-SQL-SINGLE", singleRow.BookingSessionCode);
        Assert.Equal(1, singleRow.LinkedReservationCount);
        // The UI's >1 label condition is covered separately; do not invent a null API count for a single-room order.
        foreach (var capture in new[] { firstPage.Sql, secondPage.Sql, all.Sql })
        {
            Assert.Single(capture.Commands, IsSummaryQuery);
            Assert.All(capture.Commands, sql => Assert.StartsWith("SELECT", sql.TrimStart(), StringComparison.OrdinalIgnoreCase));
        }
        Assert.Equal(firstPage.Sql.Commands.Count, secondPage.Sql.Commands.Count);
        Assert.Equal(firstPage.Sql.Commands.Count, all.Sql.Commands.Count);
        output.WriteLine($"Actual SQL commands: page size 1 = {firstPage.Sql.Commands.Count}; page size 100 (4 rows) = {all.Sql.Commands.Count}; exactly one order-summary batch each; no writes.");
    }

    [SqlServerWalletFact]
    public async Task ActualAdminQuery_RealMembershipScope_HidesOutsideRowsAndMixedOrderMetadata()
    {
        var seed = await SeedAsync();
        int visibleChildId, outsideParentId;
        await using (var setup = Open())
        {
            var mixed = Order(seed.Visible, "B-SQL-MIXED-PRIVATE");
            var visibleChild = Reservation(seed.Visible, "R-SCOPE-010", mixed);
            var outsideChild = Reservation(seed.Hidden, "R-SCOPE-020", mixed);
            var outsideParent = Reservation(seed.Visible, "R-SCOPE-030", Order(seed.Hidden, "B-SQL-PRIVATE-PARENT"));
            var hidden = Reservation(seed.Hidden, "R-SCOPE-040", Order(seed.Hidden, "B-SQL-PRIVATE-ORDER"));
            setup.Reservations.AddRange(visibleChild, outsideChild, outsideParent, hidden);
            await setup.SaveChangesAsync();
            (visibleChildId, outsideParentId) = (visibleChild.Id, outsideParent.Id);
        }

        var result = (await SearchAsync(seed.Visible.OwnerId, 1, 100)).Result;
        Assert.Equal(2, result.TotalCount);
        Assert.Equal(new[] { visibleChildId, outsideParentId }, result.Items.Select(row => row.Id));
        Assert.All(result.Items, row =>
        {
            Assert.Equal(seed.Visible.PropertyId, row.PropertyId);
            Assert.Null(row.BookingSessionCode);
            Assert.Null(row.LinkedReservationCount);
        });
        output.WriteLine("Real PropertyAccessService + AdminAssistant permission: outside property rows excluded before count/page; outside parent or sibling suppresses both order code and count.");
    }

    private KoochDbContext Open(params IInterceptor[] interceptors)
    {
        using var template = database.NewContext();
        var connection = template.Database.GetConnectionString()!;
        var target = new SqlConnectionStringBuilder(connection);
        Assert.StartsWith("KoochWalletConcurrency_", target.InitialCatalog);
        Assert.True(target.DataSource is "." or "localhost" or "(local)");
        return new(new DbContextOptionsBuilder<KoochDbContext>().UseSqlServer(connection)
            .AddInterceptors(interceptors).Options);
    }

    private async Task<(PropertyApprovalTestData.Ids Visible, PropertyApprovalTestData.Ids Hidden)> SeedAsync()
    {
        await using var db = Open();
        output.WriteLine($"Isolated SQL Server database: {db.Database.GetDbConnection().Database}");
        var visible = await PropertyApprovalTestData.SeedAsync(db);
        var hidden = await PropertyApprovalTestData.SeedAsync(db);
        var actor = await db.Users.SingleAsync(user => user.Id == visible.OwnerId);
        actor.Role = UserRole.AdminAssistant;
        if (!await db.Permissions.AnyAsync(permission => permission.Key == PermissionKey.ManageReservations))
            db.Permissions.Add(new() { Key = PermissionKey.ManageReservations, Name = "Isolated reservation access" });
        db.UserPermissions.Add(new() { UserId = actor.Id, PermissionKey = PermissionKey.ManageReservations, IsAllowed = true });
        await db.SaveChangesAsync();
        return (visible, hidden);
    }

    private async Task<(PagedResult<ReservationListItemResponse> Result, SqlCapture Sql)> SearchAsync(int actor, int page, int pageSize)
    {
        var sql = new SqlCapture();
        await using var db = Open(sql);
        var access = new PropertyAccessService(db);
        var children = new ChildPricingRuleResolver(db);
        var effective = new EffectiveAvailabilityService(db);
        var service = new ReservationService(db, new ReservationAvailabilityService(db, effective),
            new ReservationPricingService(db, new PricingService(), children, new ReservationRulesResolver(db, children)),
            new ReservationNumberGenerator(db), new RecordingNotificationService(), new RecordingReservationNotificationDispatcher(),
            new RecordingAuditLogService(), new PermissionService(db, access), access,
            new ReservationStatusWorkflow(), effective, new TestHostEnvironment());
        var result = await service.SearchAsync(new ReservationListQuery
        {
            Status = ReservationStatus.Confirmed, Sort = "reservationnumberasc", Page = page, PageSize = pageSize
        }, (actor, UserRole.AdminAssistant));
        return (result, sql);
    }

    private static BookingSession Order(PropertyApprovalTestData.Ids ids, string code) => new()
    {
        SessionCode = code, PropertyId = ids.PropertyId, ClientId = ids.OwnerId, Currency = "IRR"
    };

    private static Reservation Reservation(PropertyApprovalTestData.Ids ids, string number, BookingSession? order = null) => new()
    {
        ReservationNumber = number, PropertyId = ids.PropertyId, RoomTypeId = ids.RoomTypeId,
        ClientId = ids.OwnerId, BookingSession = order, AdultCount = 1,
        CheckInDate = new(2035, 4, 1), CheckOutDate = new(2035, 4, 3),
        BaseAmount = 100, FinalAmount = 100, TotalPrice = 100,
        Status = ReservationStatus.Confirmed, Source = ReservationSource.AdminCreated, Currency = "IRR"
    };

    private static bool IsSummaryQuery(string sql) => sql.Contains("[SessionCode]") &&
        sql.Contains("FROM [BookingSessions]") && sql.Contains("AS [Count]");

    private sealed class SqlCapture : DbCommandInterceptor
    {
        public List<string> Commands { get; } = [];
        public override ValueTask<InterceptionResult<DbDataReader>> ReaderExecutingAsync(DbCommand command,
            CommandEventData eventData, InterceptionResult<DbDataReader> result, CancellationToken cancellationToken = default)
        {
            Commands.Add(command.CommandText);
            return ValueTask.FromResult(result);
        }

        public override ValueTask<InterceptionResult<int>> NonQueryExecutingAsync(DbCommand command,
            CommandEventData eventData, InterceptionResult<int> result, CancellationToken cancellationToken = default)
        {
            Commands.Add(command.CommandText);
            return ValueTask.FromResult(result);
        }

        public override ValueTask<InterceptionResult<object>> ScalarExecutingAsync(DbCommand command,
            CommandEventData eventData, InterceptionResult<object> result, CancellationToken cancellationToken = default)
        {
            Commands.Add(command.CommandText);
            return ValueTask.FromResult(result);
        }
    }
}
