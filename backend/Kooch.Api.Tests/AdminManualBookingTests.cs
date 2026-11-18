using Kooch.Api.Dtos.Payments;
using Kooch.Api.Dtos.Reservations;
using Kooch.Api.Entities;
using Kooch.Api.Services;
using Microsoft.EntityFrameworkCore;
using Xunit;

namespace Kooch.Api.Tests;

public sealed partial class AdminManualBookingTests
{
    [Theory]
    [InlineData(1)]
    [InlineData(3)]
    public async Task Create_PersistsOneManualOrderWithEveryRoomAndAuthoritativeAmounts(int count)
    {
        await using var h = await Setup();
        var request = Request(h, count);
        request.RoomCount = 99; // The selected physical rooms, not this client hint, are authoritative.
        var result = await h.Service.CreateAsync(request, h.SuperAdmin);
        h.DbContext.ChangeTracker.Clear();
        var session = Assert.Single(await h.DbContext.BookingSessions.Include(s => s.Reservations).ToListAsync());
        Assert.Equal(count, session.Reservations.Count);
        Assert.Equal(count, result.Reservations.Count);
        Assert.Equal(session.Id, result.BookingSessionId);
        Assert.Equal(200m * count, result.TotalAmount);
        Assert.Equal(result.TotalAmount, session.Reservations.Sum(r => r.FinalAmount));
        Assert.Equal(count, session.Reservations.Sum(r => r.AdultCount));
        Assert.All(session.Reservations, r =>
        {
            Assert.Equal(ReservationSource.AdminCreated, r.Source);
            Assert.Equal(200m, r.FinalAmount);
            Assert.Equal(1, r.AdultCount);
            Assert.Equal(ReservationStatus.PendingApproval, r.Status);
            Assert.Null(r.PaymentExpiresAtUtc);
            Assert.Equal(40, r.GuestId);
        });
        Assert.Empty(await h.DbContext.Payments.ToListAsync());
        Assert.Empty(await h.DbContext.BookingFundingAttempts.ToListAsync());
    }

    [Fact]
    public async Task Create_AllocatesAdultsAndChildrenAndPricesEachRoomSeparately()
    {
        await using var h = await Setup();
        var property = await h.DbContext.Properties.SingleAsync();
        property.FreeChildAgeLimit = 5;
        property.ChildPrice = 50;
        h.DbContext.SiteSettings.Add(new SiteSetting
        { Key = ChildPricingRuleResolver.HalfPriceChildMaxAgeKey, Value = "12", IsActive = true });
        await h.DbContext.SaveChangesAsync();
        var request = Request(h, 3);
        request.Adults = 4;
        request.Children = 1;
        request.ChildAges = [8];
        var result = await h.Service.CreateAsync(request, h.SuperAdmin);
        Assert.Equal(new[] { 2, 1, 1 }, result.Reservations.Select(r => r.Adults));
        Assert.Equal(new[] { 0, 1, 0 }, result.Reservations.Select(r => r.Children));
        Assert.Equal(new[] { 200m, 300m, 200m }, result.Reservations.Select(r => r.FinalAmount));
        Assert.Equal(700m, result.TotalAmount);
    }

    [Theory]
    [InlineData("unavailable")]
    [InlineData("foreign")]
    [InlineData("inactive")]
    [InlineData("capacity")]
    [InlineData("duplicate")]
    public async Task Create_InvalidRoomOrOccupancyLeavesNoPartialOrder(string failure)
    {
        await using var h = await Setup();
        var request = Request(h, 3);
        if (failure == "unavailable") await h.AddReservationAsync(ReservationStatus.Confirmed, roomId: 33);
        if (failure == "foreign")
        {
            h.DbContext.Properties.Add(new Property
            { Id = 999, OwnerId = 2, DestinationId = 1, Name = "Foreign property", Slug = "foreign-property", Status = PropertyStatus.Approved });
            h.DbContext.RoomTypes.Add(new RoomType
            { Id = 90, PropertyId = 999, Name = "Foreign", Slug = "foreign", IsActive = true });
            (await h.DbContext.Rooms.FindAsync(33))!.RoomTypeId = 90;
        }
        if (failure == "inactive") (await h.DbContext.Rooms.FindAsync(33))!.IsActive = false;
        if (failure == "capacity") request.Adults = 100;
        if (failure == "duplicate") request.RoomIds = [30, 32, 32];
        await h.DbContext.SaveChangesAsync();
        var before = await h.DbContext.Reservations.CountAsync();
        var inventory = await h.DbContext.Availabilities.Select(a => a.AvailableCount).ToArrayAsync();
        await Assert.ThrowsAnyAsync<Exception>(() => h.Service.CreateAsync(request, h.SuperAdmin));
        h.DbContext.ChangeTracker.Clear();
        Assert.Empty(await h.DbContext.BookingSessions.ToListAsync());
        Assert.Equal(before, await h.DbContext.Reservations.CountAsync());
        Assert.Equal(inventory, await h.DbContext.Availabilities.Select(a => a.AvailableCount).ToArrayAsync());
    }

    [Fact]
    public async Task Create_RequiresAdminAndDestinationPermission()
    {
        await using var h = await Setup(permission: false);
        await Assert.ThrowsAsync<UnauthorizedAccessException>(() => h.Service.CreateAsync(Request(h, 1),
            (1, UserRole.AdminAssistant)));
        await Assert.ThrowsAsync<UnauthorizedAccessException>(() => h.Service.CreateAsync(Request(h, 1), h.Owner));
        Assert.Empty(await h.DbContext.BookingSessions.ToListAsync());
        Assert.Empty(await h.DbContext.Reservations.ToListAsync());
    }

    [Fact]
    public async Task ApprovalLinksAndManualPayment_AreIndependentOfSiblingRooms()
    {
        await using var h = await Setup();
        var result = await h.Service.CreateAsync(Request(h, 3), h.SuperAdmin);
        var first = result.Reservations[0].Id;
        var second = result.Reservations[1].Id;
        var approved = await h.Service.ApproveAsync(first, h.SuperAdmin);
        var firstDeadline = approved.PaymentExpiresAtUtc;
        Assert.NotNull(firstDeadline);
        Assert.Null((await h.DbContext.Reservations.FindAsync(second))!.PaymentExpiresAtUtc);
        (await h.DbContext.SiteSettings.SingleAsync(s => s.Key == "reservation.paymentWindowMinutes")).Value = "60";
        await h.DbContext.SaveChangesAsync();
        var approvedSecond = await h.Service.ApproveAsync(second, h.SuperAdmin);
        Assert.True(approvedSecond.PaymentExpiresAtUtc > firstDeadline);
        Assert.Equal(firstDeadline, (await h.DbContext.Reservations.FindAsync(first))!.PaymentExpiresAtUtc);
        var link = await h.Service.GeneratePaymentLinkAsync(first, h.SuperAdmin);
        var payments = new PaymentService(h.DbContext, h.EffectiveAvailability);
        var token = Uri.UnescapeDataString(link.PaymentLink.Split("token=")[1]);
        var context = await payments.GetReservationPaymentPreparationAsync(approved.ReservationNumber, token);
        Assert.True(context.IsValid);

        var manual = new AdminManualPaymentService(h.DbContext, h.EffectiveAvailability,
            new PaymentFinancializationService(h.DbContext, new CommissionPolicyResolver(h.DbContext)));
        var payment = await manual.CreateAsync(new AdminManualPaymentCreateRequest
        {
            ReservationId = first, Amount = approved.FinalAmount, Currency = "IRR",
            Method = ManualPaymentMethod.BankTransfer, PaymentDate = DateOnly.FromDateTime(DateTime.UtcNow)
        }, h.SuperAdmin.UserId);
        await manual.ApproveAsync(payment.PaymentId, h.SuperAdmin.UserId);
        Assert.Equal(ReservationStatus.Confirmed, (await h.DbContext.Reservations.FindAsync(first))!.Status);
        var sibling = (await h.DbContext.Reservations.FindAsync(second))!;
        Assert.Equal(ReservationStatus.ApprovedAwaitingPayment, sibling.Status);
        Assert.Equal(approvedSecond.PaymentExpiresAtUtc, sibling.PaymentExpiresAtUtc);
        Assert.Null(sibling.PaidAtUtc);
        Assert.Single(await h.DbContext.Payments.ToListAsync());
    }

    [Theory]
    [InlineData(0)]
    [InlineData(100)]
    public async Task AggregateOnlinePayment_IsRejectedForManualOrder(decimal walletAmount)
    {
        await using var h = await Setup();
        var order = await h.Service.CreateAsync(Request(h, 3), h.SuperAdmin);
        foreach (var reservation in order.Reservations)
            await h.Service.ApproveAsync(reservation.Id, h.SuperAdmin);
        var queries = new BookingSessionQueryService(h.DbContext);
        var details = await queries.GetByIdAsync(order.BookingSessionId);
        Assert.Equal(order.TotalAmount, details.Summary.TotalAmount);
        Assert.False(details.Summary.IsPaymentReady);
        Assert.False(details.Summary.CanContinueWithApprovedReservations);
        Assert.Null(details.Summary.EarliestPaymentDeadlineUtc);
        var account = await queries.GetBySessionCodeForClientAsync(1, order.SessionCode);
        Assert.False(account.Summary.IsPaymentReady);
        Assert.Null(account.CommonPaymentDeadlineUtc);
        var list = await queries.GetForClientAsync(1, new());
        Assert.False(Assert.Single(list.Items).IsPaymentReady);
        var error = await Assert.ThrowsAsync<InvalidOperationException>(() =>
            new PaymentService(h.DbContext, h.EffectiveAvailability).InitiateBookingSessionPaymentAsync(new()
            {
                BookingSessionId = order.BookingSessionId, Provider = "mock",
                IdempotencyKey = "manual-order-online-denied", WalletAmount = walletAmount
            }));
        Assert.Contains("Manual orders", error.Message);
        Assert.Empty(await h.DbContext.Payments.ToListAsync());
        Assert.Empty(await h.DbContext.WalletHolds.ToListAsync());
    }

    [Fact]
    public async Task ManualOrder_NotificationsKeepIndividualReservationDestinations()
    {
        await using var h = await Setup();
        var order = await h.Service.CreateAsync(Request(h, 3), h.SuperAdmin);
        var notifications = new RecordingNotificationService();
        var dispatcher = new ReservationNotificationDispatcher(h.DbContext, notifications,
            new ReservationNotificationRecipientResolver(h.DbContext, new StubPermissionService(true),
                new StubPropertyAuthorizationService(true)));
        await dispatcher.NotifyPendingApprovalAsync(order.Reservations.Select(reservation => reservation.Id).ToArray());
        var guestRequests = notifications.Requests.Where(request => request.RecipientGuestId == 40).ToArray();
        Assert.Equal(3, guestRequests.Length);
        Assert.All(guestRequests, request =>
        {
            Assert.Contains("/account/reservations/", request.DataJson);
            Assert.DoesNotContain("/account/booking-sessions/", request.DataJson);
        });
    }

    [Fact]
    public async Task InstantManualOrder_DoesNotAcquireOnlineCheckoutDeadlines()
    {
        await using var h = await Setup();
        foreach (var availability in await h.DbContext.Availabilities.ToListAsync())
            availability.Status = AvailabilityStatus.Available;
        await h.DbContext.SaveChangesAsync();
        var order = await h.Service.CreateAsync(Request(h, 3), h.SuperAdmin);
        Assert.All(order.Reservations, reservation =>
        {
            Assert.Equal(ReservationStatus.Pending, reservation.Status);
            Assert.Null(reservation.PaymentExpiresAtUtc);
            Assert.Null(reservation.ApprovalExpiresAtUtc);
        });
        Assert.Empty(await h.DbContext.Payments.ToListAsync());
        Assert.Empty(await h.DbContext.BookingFundingAttempts.ToListAsync());
    }

    [Fact]
    public async Task LegacyStandaloneManualReservation_KeepsItsApprovalAndPaymentFlow()
    {
        await using var h = await Setup();
        var reservation = await h.AddReservationAsync(ReservationStatus.PendingApproval);
        var approved = await h.Service.ApproveAsync(reservation.Id, h.SuperAdmin);
        Assert.NotNull(approved.PaymentExpiresAtUtc);
        var link = await h.Service.GeneratePaymentLinkAsync(reservation.Id, h.SuperAdmin);
        Assert.Contains(reservation.ReservationNumber!, link.PaymentLink);
        var service = new AdminManualPaymentService(h.DbContext, h.EffectiveAvailability,
            new PaymentFinancializationService(h.DbContext, new CommissionPolicyResolver(h.DbContext)));
        var payment = await service.CreateAsync(new AdminManualPaymentCreateRequest
        {
            ReservationId = reservation.Id, Amount = reservation.FinalAmount, Currency = "IRR",
            Method = ManualPaymentMethod.BankTransfer, PaymentDate = DateOnly.FromDateTime(DateTime.UtcNow)
        }, 1);
        await service.ApproveAsync(payment.PaymentId, 1);
        Assert.Equal(ReservationStatus.Confirmed, (await h.DbContext.Reservations.FindAsync(reservation.Id))!.Status);
        Assert.Empty(await h.DbContext.BookingSessions.ToListAsync());
        Assert.Single(await h.DbContext.Payments.ToListAsync());
    }

    [Fact]
    public async Task ManualPreview_UsesTheSameRoomAllocationsAndFreeChildQuotasAsCreation()
    {
        await using var h = await Setup();
        var property = await h.DbContext.Properties.SingleAsync();
        property.FreeChildAgeLimit = 5;
        property.MaxFreeChildren = 1;
        property.ChildPrice = 50;
        (await h.DbContext.RoomTypes.FindAsync(20))!.MaxChildren = 2;
        h.DbContext.SiteSettings.Add(new SiteSetting
        { Key = ChildPricingRuleResolver.HalfPriceChildMaxAgeKey, Value = "12", IsActive = true });
        await h.DbContext.SaveChangesAsync();
        var preview = await h.Service.PreviewManualBookingPriceAsync(new ReservationPricePreviewRequest
        {
            PropertyId = 10, RoomTypeId = 20, CheckInDate = h.CheckIn, CheckOutDate = h.CheckOut,
            RoomCount = 3, Adults = 6, Children = 4, ChildAges = [0, 8, 8, 0]
        });
        var request = Request(h, 3);
        request.Adults = 6;
        request.Children = 4;
        request.ChildAges = [0, 8, 8, 0];
        var order = await h.Service.CreateAsync(request, h.SuperAdmin);
        Assert.Equal(900m, preview.FinalAmount);
        Assert.Equal(order.TotalAmount, preview.FinalAmount);
        Assert.Equal(3, preview.RoomCount);
        Assert.NotNull(preview.RoomPrices);
        Assert.Equal(order.Reservations.Select(room => room.FinalAmount), preview.RoomPrices.Select(room => room.FinalAmount));
        Assert.Equal(order.Reservations.Select(room => room.Adults), preview.RoomPrices.Select(room => room.Adults));
        Assert.Equal(order.Reservations.Select(room => room.Children), preview.RoomPrices.Select(room => room.Children));
        Assert.Equal(preview.FinalAmount, preview.Nights.Sum(night => night.FinalAmount));
    }

    [Fact]
    public async Task ManualCreation_PreservesCanonicalAdultEquivalentChildCountsPerRoom()
    {
        await using var h = await Setup();
        var property = await h.DbContext.Properties.SingleAsync();
        property.FreeChildAgeLimit = 5;
        property.ChildPrice = 50;
        h.DbContext.SiteSettings.Add(new SiteSetting
        { Key = ChildPricingRuleResolver.HalfPriceChildMaxAgeKey, Value = "12", IsActive = true });
        await h.DbContext.SaveChangesAsync();
        var request = Request(h, 3);
        request.Children = 1;
        request.ChildAges = [13];
        var order = await h.Service.CreateAsync(request, h.SuperAdmin);
        Assert.Equal(new[] { 2, 1, 1 }, order.Reservations.Select(reservation => reservation.Adults));
        Assert.All(order.Reservations, reservation => Assert.Equal(0, reservation.Children));
        Assert.Equal(600m, order.TotalAmount);
    }

    [Fact]
    public async Task ManualPreview_MixedTypesMatchCreationAllocationPricesAndOrder()
    {
        await using var h = await Setup();
        h.DbContext.RoomTypes.Add(new RoomType { Id = 91, PropertyId = 10, Name = "Type based", Slug = "type-based",
            IsActive = true, InventoryMode = InventoryMode.TypeBasedInventory, TotalInventory = 2,
            MaxAdults = 2, MaxChildren = 1, BasePrice = 250 });
        for (var date = h.CheckIn; date < h.CheckOut; date = date.AddDays(1))
        {
            h.DbContext.Availabilities.Add(new Availability
                { RoomTypeId = 91, Date = date, AvailableCount = 2, Status = AvailabilityStatus.OnRequest });
            h.DbContext.RoomDailyPrices.Add(new RoomDailyPrice
                { RoomTypeId = 91, Date = date, GuestType = PricingGuestType.Iranian, BasePrice = 250 });
        }
        await h.DbContext.SaveChangesAsync();
        var request = Request(h, 3);
        request.RoomIds = [30];
        request.RoomTypeSelections = [new() { RoomTypeId = 91, Quantity = 2 }];
        request.Adults = 4;
        var preview = await h.Service.PreviewManualBookingPriceAsync(new()
        {
            ForManualCreation = true, PropertyId = 10, RoomTypeId = 20,
            RoomIds = request.RoomIds, RoomTypeSelections = request.RoomTypeSelections,
            RoomCount = 3, Adults = 4, CheckInDate = h.CheckIn, CheckOutDate = h.CheckOut
        });
        Assert.Empty(await h.DbContext.BookingSessions.ToListAsync());
        var created = await h.Service.CreateAsync(request, h.SuperAdmin);
        var roomPrices = Assert.IsAssignableFrom<IReadOnlyList<ManualRoomPricePreview>>(preview.RoomPrices);
        Assert.Equal(new[] { 200m, 500m, 500m }, roomPrices.Select(price => price.FinalAmount));
        Assert.Equal(created.Reservations.Select(room => room.Adults), roomPrices.Select(room => room.Adults));
        Assert.Equal(created.Reservations.Select(room => room.FinalAmount), roomPrices.Select(room => room.FinalAmount));
        Assert.Equal(created.TotalAmount, preview.FinalAmount);
        Assert.Equal(1200m, preview.FinalAmount);
    }

    [Theory]
    [InlineData("count")]
    [InlineData("property")]
    [InlineData("duplicate")]
    public async Task ManualPreview_RejectsInvalidExplicitSelectionsWithoutWrites(string invalid)
    {
        await using var h = await Setup();
        var request = new ReservationPricePreviewRequest { ForManualCreation = true, PropertyId = 10, RoomTypeId = 20,
            RoomIds = [30, 32], RoomCount = 2, Adults = 2, CheckInDate = h.CheckIn, CheckOutDate = h.CheckOut };
        if (invalid == "count") request.RoomCount = 1;
        if (invalid == "property") request.PropertyId = 999;
        if (invalid == "duplicate") request.RoomIds = [30, 30];
        await Assert.ThrowsAnyAsync<Exception>(() => h.Service.PreviewManualBookingPriceAsync(request));
        Assert.Empty(await h.DbContext.BookingSessions.ToListAsync());
        Assert.Empty(await h.DbContext.Reservations.ToListAsync());
    }

    private static ReservationCreateRequest Request(ReservationTestHarness h, int count) => new()
    {
        PropertyId = 10, RoomTypeId = 20, RoomId = 30, RoomIds = new[] { 30, 32, 33 }.Take(count).ToArray(),
        RoomCount = count, GuestId = 40, Adults = count,
        CheckInDate = h.CheckIn, CheckOutDate = h.CheckOut
    };

    private static async Task<ReservationTestHarness> Setup(bool permission = true)
    {
        var h = await ReservationTestHarness.CreateAsync(permissionGranted: permission, useAuthoritativePricing: true);
        var type = (await h.DbContext.RoomTypes.FindAsync(20))!;
        type.TotalInventory = 3;
        type.BasePrice = 100;
        type.MaxChildren = 1;
        h.DbContext.SiteSettings.Add(new SiteSetting
        { Key = "ReservationCommissionPercent", Value = "10", IsActive = true });
        h.DbContext.Rooms.AddRange(new Room { Id = 32, RoomTypeId = 20, Name = "Room 3", IsActive = true },
            new Room { Id = 33, RoomTypeId = 20, Name = "Room 4", IsActive = true });
        for (var date = h.CheckIn; date < h.CheckOut; date = date.AddDays(1))
        {
            h.DbContext.Availabilities.Add(new Availability
            { RoomTypeId = 20, Date = date, AvailableCount = 3, Status = AvailabilityStatus.OnRequest });
            h.DbContext.RoomDailyPrices.Add(new RoomDailyPrice
            { RoomTypeId = 20, Date = date, GuestType = PricingGuestType.Iranian, BasePrice = 100 });
        }
        await h.DbContext.SaveChangesAsync();
        return h;
    }
}
