using System.Reflection;
using System.Security.Claims;
using System.Text.Json;
using System.Text.Json.Serialization;
using Kooch.Api.Controllers;
using Kooch.Api.Data;
using Kooch.Api.Dtos.Reservations;
using Kooch.Api.Entities;
using Kooch.Api.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Xunit;

namespace Kooch.Api.Tests;

public sealed class GuestReservationCashbackReadTests
{
    private static readonly DateTime EligibleAt = new(2026, 10, 5, 12, 0, 0, DateTimeKind.Utc);
    private static readonly DateTime GrantedAt = new(2026, 10, 5, 13, 0, 0, DateTimeKind.Utc);
    private static readonly DateTime ExpiresAt = new(2026, 11, 4, 13, 0, 0, DateTimeKind.Utc);

    [Fact]
    public async Task OwnReservation_ReturnsPendingSnapshotAndNoGrantDates()
    {
        await using var db = Seed();
        var response = await Query(db).GetForGuestAsync(1, " R-123456 ");
        var cashback = Assert.IsType<GuestCashbackSummaryResponse>(response.Cashback);
        Assert.Equal(CashbackEntitlementStatus.Pending, cashback.Status);
        Assert.Equal(10m, cashback.Amount);
        Assert.Equal("IRR", cashback.Currency);
        Assert.Equal(EligibleAt, cashback.EligibleAtUtc);
        Assert.Null(cashback.GrantedAtUtc);
        Assert.Null(cashback.ExpiresAtUtc);
    }

    [Fact]
    public async Task OtherUser_IncludingAdminRole_CannotReadOrDiscoverReservation()
    {
        await using var db = Seed();
        await Assert.ThrowsAsync<KeyNotFoundException>(() => Query(db).GetForGuestAsync(2, "R-123456"));
        await Assert.ThrowsAsync<KeyNotFoundException>(() => Query(db).GetForGuestAsync(2, "R-MISSING"));
        await Assert.ThrowsAsync<KeyNotFoundException>(() => Query(db).GetForGuestAsync(1, " "));
    }

    [Fact]
    public async Task LegacyReservationWithoutEntitlement_HasExplicitNullCashback()
    {
        await using var db = Seed();
        var response = await Query(db).GetForGuestAsync(1, "KCH-OLD");
        Assert.Null(response.Cashback);
        Assert.Equal("{\"cashback\":null}", JsonSerializer.Serialize(response,
            new JsonSerializerOptions(JsonSerializerDefaults.Web)));
    }

    [Fact]
    public async Task Granted_UsesLinkedWalletLotExpiryAndImmutableAmount()
    {
        await using var db = Seed();
        Grant(db);
        db.ChangeTracker.Clear();

        var cashback = Assert.IsType<GuestCashbackSummaryResponse>(
            (await Query(db).GetForGuestAsync(1, "R-123456")).Cashback);
        Assert.Equal(CashbackEntitlementStatus.Granted, cashback.Status);
        Assert.Equal(10m, cashback.Amount);
        Assert.Equal(EligibleAt, cashback.EligibleAtUtc);
        Assert.Equal(GrantedAt, cashback.GrantedAtUtc);
        Assert.Equal(ExpiresAt, cashback.ExpiresAtUtc);
    }

    [Fact]
    public async Task GrantedWithoutDurableWalletLot_FailsRatherThanInventingExpiry()
    {
        await using var db = Seed();
        Grant(db, missingLot: true);
        db.ChangeTracker.Clear();
        await Assert.ThrowsAsync<InvalidOperationException>(() =>
            Query(db).GetForGuestAsync(1, "R-123456"));
    }

    [Fact]
    public async Task Voided_RemainsVisibleWithoutGrantOrExpiryTimestamps()
    {
        await using var db = Seed();
        db.ReservationCashbackEntitlements.Single().Status = CashbackEntitlementStatus.Voided;
        db.Reservations.Single(row => row.Id == 50).Status = ReservationStatus.Cancelled;
        db.SaveChanges();
        db.ChangeTracker.Clear();
        var cashback = Assert.IsType<GuestCashbackSummaryResponse>(
            (await Query(db).GetForGuestAsync(1, "R-123456")).Cashback);
        Assert.Equal(CashbackEntitlementStatus.Voided, cashback.Status);
        Assert.Equal(10m, cashback.Amount);
        Assert.Null(cashback.GrantedAtUtc);
        Assert.Null(cashback.ExpiresAtUtc);
    }

    [Fact]
    public async Task CurrentGlobalAndPropertyPolicies_CannotChangeHistoricalCashbackAmount()
    {
        await using var db = Seed();
        db.CashbackSettings.AddRange(
            new CashbackSetting { Currency = "IRR", Enabled = true, CalculationMode = CashbackCalculationMode.Percentage,
                PercentageRate = 20m, MaxCashbackPerReservation = 500m, ExpiryDays = 1 },
            new CashbackSetting { PropertyId = 30, Currency = "IRR", Enabled = false });
        db.SaveChanges();
        db.ChangeTracker.Clear();
        Assert.Equal(10m, (await Query(db).GetForGuestAsync(1, "R-123456")).Cashback!.Amount);
        db.CashbackSettings.First(row => row.PropertyId == null).PercentageRate = 1m;
        db.CashbackSettings.First(row => row.PropertyId == 30).Enabled = true;
        db.SaveChanges();
        db.ChangeTracker.Clear();
        Assert.Equal(10m, (await Query(db).GetForGuestAsync(1, "R-123456")).Cashback!.Amount);
    }

    [Fact]
    public async Task Read_CreatesNoWalletObjectsAndTracksNoChanges()
    {
        await using var db = Seed();
        await Query(db).GetForGuestAsync(1, "R-123456");
        Assert.Empty(db.WalletLots);
        Assert.Empty(db.WalletEntries);
        Assert.False(db.ChangeTracker.HasChanges());
        Assert.Empty(db.ChangeTracker.Entries<ReservationCashbackEntitlement>());
    }

    [Fact]
    public void PublicContract_ContainsOnlyGuestFieldsAndUsesExistingStatusNames()
    {
        Assert.Equal(new[] { "Amount", "Currency", "EligibleAtUtc", "ExpiresAtUtc", "GrantedAtUtc", "Status" },
            typeof(GuestCashbackSummaryResponse).GetProperties().Select(property => property.Name)
                .OrderBy(name => name).ToArray());
        var options = new JsonSerializerOptions(JsonSerializerDefaults.Web);
        options.Converters.Add(new JsonStringEnumConverter());
        var json = JsonSerializer.Serialize(new GuestReservationCashbackResponse(new GuestCashbackSummaryResponse
        {
            Status = CashbackEntitlementStatus.Granted, Amount = 10m, Currency = "IRR",
            EligibleAtUtc = EligibleAt, GrantedAtUtc = GrantedAt, ExpiresAtUtc = ExpiresAt
        }), options);
        Assert.Contains("\"status\":\"Granted\"", json);
        Assert.DoesNotContain("WalletLotId", json);
        Assert.DoesNotContain("PolicySource", json);
        Assert.Contains("2026-10-05T12:00:00Z", json);
    }

    [Fact]
    public async Task Controller_UsesAuthenticatedPrincipalAndCurrentUserRoute()
    {
        Assert.NotNull(typeof(AccountReservationsController).GetCustomAttribute<AuthorizeAttribute>());
        var route = typeof(AccountReservationsController).GetMethod(nameof(AccountReservationsController.GetCashback))!
            .GetCustomAttribute<HttpGetAttribute>();
        Assert.Equal("{reservationNumber}/cashback", route?.Template);
        Assert.Equal(new[] { "reservationNumber", "cancellationToken" },
            typeof(AccountReservationsController).GetMethod(nameof(AccountReservationsController.GetCashback))!
                .GetParameters().Select(parameter => parameter.Name).ToArray());
        await using var db = Seed();
        var controller = new AccountReservationsController(null!, null!, Query(db))
        {
            ControllerContext = new ControllerContext { HttpContext = new DefaultHttpContext() }
        };
        controller.ControllerContext.HttpContext.User = new ClaimsPrincipal(new ClaimsIdentity([
            new Claim(ClaimTypes.NameIdentifier, "1"), new Claim(ClaimTypes.Role, nameof(UserRole.Client))
        ], "Test"));
        var result = await controller.GetCashback("R-123456", default);
        Assert.Equal(10m, Assert.IsType<GuestReservationCashbackResponse>(
            Assert.IsType<OkObjectResult>(result.Result).Value).Cashback!.Amount);
    }

    private static ReservationCashbackQueryService Query(KoochDbContext db) => new(db);

    private static KoochDbContext Seed()
    {
        var db = new KoochDbContext(new DbContextOptionsBuilder<KoochDbContext>()
            .UseInMemoryDatabase(Guid.NewGuid().ToString("N")).Options);
        db.Users.AddRange(
            new User { Id = 1, FirstName = "Guest", LastName = "Owner", Role = UserRole.Client },
            new User { Id = 2, FirstName = "Other", LastName = "Admin", Role = UserRole.SuperAdmin },
            new User { Id = 3, FirstName = "Property", LastName = "Owner", Role = UserRole.Client });
        db.Guests.Add(new Guest { Id = 10, UserId = 1, FirstName = "Guest", LastName = "Owner" });
        db.Destinations.Add(new Destination { Id = 20, Name = "City", Slug = "city" });
        db.Properties.Add(new Property { Id = 30, OwnerId = 3, DestinationId = 20, Name = "Property", Slug = "property" });
        db.RoomTypes.Add(new RoomType { Id = 40, PropertyId = 30, Name = "Room", Slug = "room", TotalInventory = 1 });
        db.Reservations.AddRange(
            new Reservation { Id = 50, ReservationNumber = "R-123456", ClientId = 1, GuestId = 10,
                PropertyId = 30, RoomTypeId = 40, Currency = "IRR", Status = ReservationStatus.Paid,
                CheckInDate = new DateOnly(2026, 10, 1), CheckOutDate = new DateOnly(2026, 10, 2), AdultCount = 1 },
            new Reservation { Id = 51, ReservationNumber = "KCH-OLD", ClientId = 1, GuestId = 10,
                PropertyId = 30, RoomTypeId = 40, Currency = "IRR", Status = ReservationStatus.Confirmed,
                CheckInDate = new DateOnly(2026, 10, 1), CheckOutDate = new DateOnly(2026, 10, 2), AdultCount = 1 });
        db.ReservationCashbackEntitlements.Add(new ReservationCashbackEntitlement
        {
            Id = 60, ReservationId = 50, UserId = 1, PropertyId = 30, Currency = "IRR",
            Status = CashbackEntitlementStatus.Pending, CashbackAmount = 10m, EligibleAtUtc = EligibleAt,
            PolicySource = CashbackPolicySource.Global, CalculationMode = CashbackCalculationMode.Percentage,
            PercentageRateSnapshot = 10m, MaxCashbackPerReservationSnapshot = 50m, ExpiryDaysSnapshot = 30
        });
        db.SaveChanges();
        db.ChangeTracker.Clear();
        return db;
    }

    private static void Grant(KoochDbContext db, bool missingLot = false)
    {
        db.WalletAccounts.Add(new WalletAccount { Id = 70, UserId = 1, Currency = "IRR" });
        if (!missingLot)
            db.WalletLots.Add(new WalletLot { Id = 71, WalletAccountId = 70, SourceType = WalletSourceType.PromotionalCredit,
                IsWithdrawable = false, ExpiresAtUtc = ExpiresAt });
        db.WalletEntries.Add(new WalletEntry { Id = 72, WalletAccountId = 70, WalletLotId = 71,
            Direction = WalletEntryDirection.Credit, Amount = 10m });
        var entitlement = db.ReservationCashbackEntitlements.Single();
        entitlement.Status = CashbackEntitlementStatus.Granted;
        entitlement.GrantedWalletLotId = 71;
        entitlement.GrantedWalletEntryId = 72;
        entitlement.GrantedAtUtc = GrantedAt;
        db.SaveChanges();
    }
}
