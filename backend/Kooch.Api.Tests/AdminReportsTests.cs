using System.Reflection;
using System.Text.Json;
using Kooch.Api.Authentication;
using Kooch.Api.Controllers;
using Kooch.Api.Data;
using Kooch.Api.Dtos.PropertyUsers;
using Kooch.Api.Dtos.Reports;
using Kooch.Api.Entities;
using Kooch.Api.Services;
using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;
using Xunit;

namespace Kooch.Api.Tests;

public sealed class AdminReportsTests
{
    [Fact]
    public void ControllerRequiresAdminAndViewReports()
    {
        Assert.NotNull(typeof(AdminReportsController).GetCustomAttribute<AdminAuthorizeAttribute>());
        Assert.Equal(new PermissionAuthorizeAttribute(PermissionKey.ViewReports).Policy,
            typeof(AdminReportsController).GetCustomAttribute<PermissionAuthorizeAttribute>()!.Policy);
        Assert.DoesNotContain(typeof(AdminReportService).GetConstructors().Single().GetParameters(),
            parameter => parameter.ParameterType.Name.Contains("ReservationService"));
    }

    [Fact]
    public async Task SuperAdmin_CountsReservationsNotPayments_AndPreservesSoftDelete()
    {
        await using var db = await SeedAsync();
        var report = await Service(db).GetReservationsAsync(1, UserRole.SuperAdmin, new());
        Assert.Equal(8, report.Summary.TotalCount);
        Assert.Equal(8, report.Trend.Sum(item => item.Count));
        Assert.Equal(8, report.Properties.Sum(item => item.Count));
        Assert.Equal(8, report.Statuses.Sum(item => item.Count));
        Assert.Equal(360m, report.Summary.BookingValue);
        Assert.Equal("IRR", report.Summary.BookingValueCurrency);
        Assert.False(report.Summary.BookingValueHasMixedCurrencies);
        Assert.Equal([101, 102], report.ReportableProperties.Select(item => item.Id));
        Assert.DoesNotContain(report.Properties, item => item.PropertyId == 103);
    }

    [Fact]
    public async Task Assistant_RequiresPlatformPermission_EvenWithReportsMembership()
    {
        await using var db = await SeedAsync();
        db.UserPermissions.RemoveRange(db.UserPermissions);
        await db.SaveChangesAsync();
        await Assert.ThrowsAsync<UnauthorizedAccessException>(() => Service(db)
            .GetReservationsAsync(10, UserRole.AdminAssistant, new()));
    }

    [Fact]
    public async Task Assistant_OnlySeesEffectiveReportsProperties_InAllProjections()
    {
        await using var db = await SeedAsync();
        var report = await Service(db).GetReservationsAsync(10, UserRole.AdminAssistant, new());
        Assert.Equal(7, report.Summary.TotalCount);
        Assert.Equal(101, Assert.Single(report.Properties).PropertyId);
        Assert.Equal(101, Assert.Single(report.ReportableProperties).Id);
        Assert.Equal(7, report.Trend.Sum(item => item.Count));
        Assert.Equal(7, report.Statuses.Sum(item => item.Count));
    }

    [Theory]
    [InlineData(102)]
    [InlineData(999)]
    public async Task HiddenAndUnknownProperty_ReturnSameDenial(int propertyId)
    {
        await using var db = await SeedAsync();
        var error = await Assert.ThrowsAsync<UnauthorizedAccessException>(() => Service(db)
            .GetReservationsAsync(10, UserRole.AdminAssistant, new() { PropertyIds = [propertyId] }));
        Assert.Equal("You cannot view reports for this property.", error.Message);
    }

    [Fact]
    public async Task PropertyIds_FilterAllReportProjections_AndAggregateMultipleSelections()
    {
        await using var db = await SeedAsync();

        var single = await Service(db).GetReservationsAsync(1, UserRole.SuperAdmin,
            new() { PropertyIds = [102] });
        Assert.Equal(1, single.Summary.TotalCount);
        Assert.Equal(102, Assert.Single(single.Properties).PropertyId);
        Assert.Equal(1, single.Trend.Sum(item => item.Count));
        Assert.Equal(1, single.Statuses.Sum(item => item.Count));
        Assert.Equal(80m, single.Summary.BookingValue);

        var multiple = await Service(db).GetReservationsAsync(1, UserRole.SuperAdmin,
            new() { PropertyIds = [101, 102, 101] });
        Assert.Equal(8, multiple.Summary.TotalCount);
        Assert.Equal([101, 102], multiple.Filters.PropertyIds);
        Assert.Equal(2, multiple.Properties.Count);
        Assert.Equal(8, multiple.Trend.Sum(item => item.Count));
        Assert.Equal(8, multiple.Statuses.Sum(item => item.Count));
    }

    [Fact]
    public async Task PropertyTypes_FilterAndComposeWithSelectedProperties()
    {
        await using var db = await SeedAsync();

        var singleType = await Service(db).GetReservationsAsync(1, UserRole.SuperAdmin,
            new() { PropertyTypes = [PropertyType.BoutiqueHotel] });
        Assert.Equal(1, singleType.Summary.TotalCount);
        Assert.Equal(102, Assert.Single(singleType.Properties).PropertyId);

        var multipleTypes = await Service(db).GetReservationsAsync(1, UserRole.SuperAdmin,
            new() { PropertyTypes = [PropertyType.Hotel, PropertyType.BoutiqueHotel, PropertyType.Hotel] });
        Assert.Equal(8, multipleTypes.Summary.TotalCount);
        Assert.Equal([PropertyType.Hotel, PropertyType.BoutiqueHotel], multipleTypes.Filters.PropertyTypes);

        var intersection = await Service(db).GetReservationsAsync(1, UserRole.SuperAdmin,
            new() { PropertyIds = [101], PropertyTypes = [PropertyType.BoutiqueHotel] });
        Assert.Equal(0, intersection.Summary.TotalCount);
        Assert.Empty(intersection.Properties);
        Assert.Empty(intersection.Trend);
        Assert.Empty(intersection.Statuses);
    }

    [Fact]
    public async Task PlatformPermissionWithoutEffectiveReportsView_ReturnsEmptyScope()
    {
        await using var db = await SeedAsync();
        var membership = await db.UserPropertyAccesses.SingleAsync(item => item.PropertyId == 101);
        membership.Status = PropertyUserStatus.Suspended;
        await db.SaveChangesAsync();
        var report = await Service(db).GetReservationsAsync(10, UserRole.AdminAssistant, new());
        Assert.Equal(0, report.Summary.TotalCount);
        Assert.Empty(report.ReportableProperties);
        Assert.Empty(report.Trend);
    }

    [Fact]
    public async Task UtcDayBounds_AreStartInclusiveAndNextDayExclusive()
    {
        await using var db = await SeedAsync();
        var report = await Service(db).GetReservationsAsync(1, UserRole.SuperAdmin,
            new() { From = new(2026, 9, 20), To = new(2026, 9, 20), PropertyIds = [101] });
        Assert.Equal(5, report.Summary.TotalCount);
        Assert.Equal("UTC", report.Filters.TimeZone);
        Assert.Equal(Utc(20), report.Filters.FromUtcInclusive);
        Assert.Equal(Utc(21), report.Filters.ToUtcExclusive);
        Assert.Equal(new DateOnly(2026, 9, 20), Assert.Single(report.Trend).Date);
        Assert.Equal(200m, report.Summary.BookingValue);
    }

    [Theory]
    [InlineData(6, 8, 2, 70)]
    [InlineData(8, 8, 2, 70)]
    [InlineData(7, 10, 1, 60)]
    [InlineData(10, 10, 1, 60)]
    public async Task LegacyStatuses_NormalizeForFilterAndGrouping(
        int requested, int expected, int count, decimal bookingValue)
    {
        await using var db = await SeedAsync();
        var report = await Service(db).GetReservationsAsync(1, UserRole.SuperAdmin,
            new() { Status = (ReservationStatus)requested });
        Assert.Equal(count, report.Summary.TotalCount);
        Assert.Equal(bookingValue, report.Summary.BookingValue);
        Assert.Equal((ReservationStatus)expected, Assert.Single(report.Statuses).Status);
        Assert.Equal((ReservationStatus)expected, report.Filters.Status);
    }

    [Fact]
    public async Task PendingStatesRemainSeparate_ExpiredHoldsAreNotMutated()
    {
        await using var db = await SeedAsync();
        db.ChangeTracker.Clear();
        var report = await Service(db).GetReservationsAsync(1, UserRole.SuperAdmin, new());
        Assert.Contains(report.Statuses, item => item.Status == ReservationStatus.Pending && item.Count == 1);
        Assert.Contains(report.Statuses, item => item.Status == ReservationStatus.PendingApproval && item.Count == 2);
        Assert.Contains(report.Statuses, item => item.Status == ReservationStatus.ApprovedAwaitingPayment && item.Count == 1);
        Assert.Empty(db.ChangeTracker.Entries());
        Assert.Equal(ReservationStatus.ApprovedAwaitingPayment, (await db.Reservations.FindAsync(5))!.Status);
        Assert.Equal(ReservationStatusNormalizer.LegacyPendingApproval, (await db.Reservations.FindAsync(3))!.Status);
    }

    [Fact]
    public async Task EmptyDateRange_ReturnsEmptyAggregatesButKeepsScopedOptions()
    {
        await using var db = await SeedAsync();
        var report = await Service(db).GetReservationsAsync(1, UserRole.SuperAdmin,
            new() { From = new(2030, 1, 1) });
        Assert.Equal(0, report.Summary.TotalCount);
        Assert.Empty(report.Trend);
        Assert.Empty(report.Properties);
        Assert.Empty(report.Statuses);
        Assert.Equal(0m, report.Summary.BookingValue);
        Assert.Null(report.Summary.BookingValueCurrency);
        Assert.False(report.Summary.BookingValueHasMixedCurrencies);
        Assert.Equal(2, report.ReportableProperties.Count);
    }

    [Fact]
    public async Task MixedCurrencies_AreNotCombinedIntoOneBookingValue()
    {
        await using var db = await SeedAsync();
        (await db.Reservations.SingleAsync(item => item.Id == 8)).Currency = "USD";
        await db.SaveChangesAsync();

        var report = await Service(db).GetReservationsAsync(1, UserRole.SuperAdmin, new());

        Assert.Null(report.Summary.BookingValue);
        Assert.Null(report.Summary.BookingValueCurrency);
        Assert.True(report.Summary.BookingValueHasMixedCurrencies);
    }

    [Fact]
    public async Task InvalidDatesAndStatusesAreRejected()
    {
        await using var db = await SeedAsync();
        await Assert.ThrowsAsync<ArgumentException>(() => Service(db).GetReservationsAsync(1, UserRole.SuperAdmin,
            new() { From = new(2026, 9, 21), To = new(2026, 9, 20) }));
        await Assert.ThrowsAsync<ArgumentException>(() => Service(db).GetReservationsAsync(1, UserRole.SuperAdmin,
            new() { Status = (ReservationStatus)99 }));
    }

    [Fact]
    public async Task RelationalProvider_ExecutesGroupedQuery()
    {
        await using var connection = new SqliteConnection("Data Source=:memory:;Foreign Keys=False");
        await connection.OpenAsync();
        await using var db = await SeedAsync(new DbContextOptionsBuilder<KoochDbContext>().UseSqlite(connection).Options);
        var report = await Service(db).GetReservationsAsync(1, UserRole.SuperAdmin, new());
        Assert.Equal(8, report.Summary.TotalCount);
        Assert.Equal(2, report.Statuses.Single(item => item.Status == ReservationStatus.PendingApproval).Count);
    }

    private static DateTime Utc(int day) => new(2026, 9, day, 0, 0, 0, DateTimeKind.Utc);
    private static AdminReportService Service(KoochDbContext db)
    {
        var access = new PropertyAccessService(db);
        return new(db, access, new PermissionService(db, access));
    }

    private static async Task<KoochDbContext> SeedAsync(DbContextOptions<KoochDbContext>? options = null)
    {
        var db = new ReportTestContext(options ?? new DbContextOptionsBuilder<KoochDbContext>()
            .UseInMemoryDatabase(Guid.NewGuid().ToString()).Options);
        await db.Database.EnsureCreatedAsync();
        db.Users.AddRange(new User { Id = 1, Role = UserRole.SuperAdmin, FirstName = "Admin", LastName = "One", PasswordHash = "unused", IsActive = true },
            new User { Id = 10, Role = UserRole.AdminAssistant, FirstName = "Admin", LastName = "Two", PasswordHash = "unused", IsActive = true });
        for (var id = 101; id <= 103; id++)
            db.Properties.Add(new Property { Id = id, OwnerId = 1, Name = $"Property {id}", Slug = $"property-{id}", Description = "test", Address = "test", City = "Tehran", Country = "Iran",
                Type = id == 102 ? PropertyType.BoutiqueHotel : PropertyType.Hotel, IsDeleted = id == 103 });
        db.UserPermissions.Add(new UserPermission { UserId = 10, PermissionKey = PermissionKey.ViewReports, IsAllowed = true });
        foreach (var id in new[] { 101, 102 })
            db.UserPropertyAccesses.Add(new UserPropertyAccess { UserId = 10, PropertyId = id,
                PropertyRole = PropertyUserRole.Manager, Status = PropertyUserStatus.Active, IsActive = true,
                PermissionMatrixJson = JsonSerializer.Serialize(new PermissionMatrixDto { ["Reports"] = new PermissionActionsDto { View = id == 101 } }) });
        var statuses = new[] { ReservationStatus.Pending, ReservationStatus.Confirmed, ReservationStatusNormalizer.LegacyPendingApproval,
            ReservationStatus.PendingApproval, ReservationStatus.ApprovedAwaitingPayment, ReservationStatusNormalizer.LegacyPaymentExpired, ReservationStatus.Cancelled };
        for (var i = 0; i < statuses.Length; i++)
            db.Reservations.Add(new Reservation { Id = i + 1, ClientId = 1, PropertyId = 101, Status = statuses[i],
                CreatedAtUtc = i == 0 ? Utc(20).AddTicks(-1) : i == 6 ? Utc(21) : i == 5 ? Utc(21).AddTicks(-1) : Utc(20),
                FinalAmount = (i + 1) * 10m, TotalPrice = 10_000m + i, Currency = "IRR", PaymentExpiresAtUtc = Utc(19) });
        db.Reservations.AddRange(new Reservation { Id = 8, ClientId = 1, PropertyId = 102, CreatedAtUtc = Utc(20), Status = ReservationStatus.Completed,
                FinalAmount = 80m, TotalPrice = 20_000m, Currency = "IRR" },
            new Reservation { Id = 9, ClientId = 1, PropertyId = 103, CreatedAtUtc = Utc(20) },
            new Reservation { Id = 10, ClientId = 1, PropertyId = 101, CreatedAtUtc = Utc(20), IsDeleted = true });
        db.Payments.AddRange(new Payment { ReservationId = 2, Amount = 100, Status = PaymentStatus.Successful },
            new Payment { ReservationId = 2, Amount = 100, Status = PaymentStatus.Failed });
        // Preserve historical fixture timestamps; the async override stamps new production rows.
        db.SaveChanges();
        return db;
    }

    private sealed class ReportTestContext(DbContextOptions<KoochDbContext> options) : KoochDbContext(options)
    {
        protected override void OnModelCreating(ModelBuilder modelBuilder)
        {
            base.OnModelCreating(modelBuilder);
            // SQLite has no SQL Server-generated rowversion; this fixture exercises read-only queries.
            modelBuilder.Entity<Reservation>().Property(item => item.RowVersion).ValueGeneratedNever();
            modelBuilder.Entity<Payment>().Property(item => item.RowVersion).ValueGeneratedNever();
        }
    }
}
