using Kooch.Api.Controllers;
using Kooch.Api.Data;
using Kooch.Api.Dtos.AuditLogs;
using Kooch.Api.Dtos.BookingSessions;
using Kooch.Api.Dtos.PropertyUsers;
using Kooch.Api.Dtos.Reservations;
using Kooch.Api.Entities;
using Kooch.Api.Services;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Diagnostics;
using Microsoft.Extensions.FileProviders;
using Microsoft.Extensions.Hosting;
using System.Reflection;
using Xunit;

namespace Kooch.Api.Tests;

public sealed class ReservationServiceHardeningTests
{
    [Fact]
    public async Task GenericTransitionApplication_RejectsApprovedAwaitingPayment()
    {
        await using var harness = await ReservationTestHarness.CreateAsync();
        var pending = await harness.AddReservationAsync(ReservationStatus.PendingApproval);
        var method = typeof(ReservationService).GetMethod(
            "ApplyStatusTransitionAsync",
            BindingFlags.Instance | BindingFlags.NonPublic)
            ?? throw new InvalidOperationException("Transition method was not found.");
        var transitionTask = (Task)(method.Invoke(
            harness.Service,
            [
                pending,
                ReservationStatus.ApprovedAwaitingPayment,
                harness.Owner,
                CancellationToken.None
            ]) ?? throw new InvalidOperationException("Transition task was not returned."));

        var error = await Assert.ThrowsAsync<InvalidOperationException>(() => transitionTask);

        Assert.Equal("Use ApproveAsync to approve a reservation.", error.Message);
        Assert.Equal(ReservationStatus.PendingApproval, pending.Status);
    }

    [Fact]
    public async Task UpdateStatusApproval_RoutesThroughDedicatedApprovalPath()
    {
        await using var harness = await ReservationTestHarness.CreateAsync(paymentWindowMinutes: 37);
        var pending = await harness.AddReservationAsync(ReservationStatus.PendingApproval);
        var before = DateTime.UtcNow.AddMinutes(37);

        var approved = await harness.Service.UpdateStatusAsync(
            pending.Id,
            new ReservationStatusUpdateRequest
            {
                Status = ReservationStatus.ApprovedAwaitingPayment
            },
            harness.Owner);

        var after = DateTime.UtcNow.AddMinutes(37);
        Assert.Equal(ReservationStatus.ApprovedAwaitingPayment, approved.Status);
        Assert.NotNull(approved.PaymentExpiresAtUtc);
        Assert.InRange(approved.PaymentExpiresAtUtc.Value, before, after);
        var originalDeadline = approved.PaymentExpiresAtUtc;
        var setting = await harness.DbContext.SiteSettings.SingleAsync(item =>
            item.Key == "reservation.paymentWindowMinutes");
        setting.Value = "90";
        await harness.DbContext.SaveChangesAsync();
        harness.DbContext.ChangeTracker.Clear();
        Assert.Equal(
            originalDeadline,
            (await harness.DbContext.Reservations.SingleAsync(item => item.Id == pending.Id))
                .PaymentExpiresAtUtc);
        Assert.Equal(0, await harness.GetRemainingCapacityAsync());
    }

    [Fact]
    public async Task Approval_RechecksCapacityAndFailsWhenCapacityIsGone()
    {
        await using var harness = await ReservationTestHarness.CreateAsync();
        var pending = await harness.AddReservationAsync(ReservationStatus.PendingApproval, roomId: 30);
        await harness.AddReservationAsync(ReservationStatus.Confirmed, roomId: 30);

        var error = await Assert.ThrowsAsync<InvalidOperationException>(() =>
            harness.Service.ApproveAsync(pending.Id, harness.Owner));

        Assert.Contains("Availability changed", error.Message);
        Assert.Equal(
            ReservationStatus.PendingApproval,
            (await harness.DbContext.Reservations.FindAsync(pending.Id))!.Status);
    }

    [Fact]
    public async Task OnlyOnePendingRequestCanObtainTheFinalCapacity()
    {
        await using var harness = await ReservationTestHarness.CreateAsync();
        var first = await harness.AddReservationAsync(ReservationStatus.PendingApproval, roomId: 30);
        var second = await harness.AddReservationAsync(ReservationStatus.PendingApproval, roomId: 30);

        var approved = await harness.Service.ApproveAsync(first.Id, harness.Owner);
        await Assert.ThrowsAsync<InvalidOperationException>(() =>
            harness.Service.ApproveAsync(second.Id, harness.Owner));

        Assert.Equal(ReservationStatus.ApprovedAwaitingPayment, approved.Status);
        Assert.Equal(
            ReservationStatus.PendingApproval,
            (await harness.DbContext.Reservations.FindAsync(second.Id))!.Status);
    }

    [Fact]
    public async Task Approval_UsesPaymentWindowFromSiteSettings()
    {
        await using var harness = await ReservationTestHarness.CreateAsync(paymentWindowMinutes: 37);
        var pending = await harness.AddReservationAsync(ReservationStatus.PendingApproval);
        var before = DateTime.UtcNow.AddMinutes(37);

        var approved = await harness.Service.ApproveAsync(pending.Id, harness.Owner);

        var after = DateTime.UtcNow.AddMinutes(37);
        Assert.Equal(ReservationStatus.ApprovedAwaitingPayment, approved.Status);
        Assert.NotNull(approved.PaymentExpiresAtUtc);
        Assert.InRange(approved.PaymentExpiresAtUtc.Value, before, after);
    }

    [Fact]
    public async Task ApprovalAfterOwnerDeadline_RejectsOnlyThatReservation()
    {
        await using var harness = await ReservationTestHarness.CreateAsync();
        var session = new BookingSession
        {
            SessionCode = "KCH-S-OWNER-TIMEOUT",
            ClientId = 1,
            GuestId = 40,
            PropertyId = 10,
            Currency = "IRR",
            RequestHash = new string('B', 64)
        };
        harness.DbContext.BookingSessions.Add(session);
        await harness.DbContext.SaveChangesAsync();
        var expired = await harness.AddReservationAsync(
            ReservationStatus.PendingApproval,
            approvalExpiresAtUtc: DateTime.UtcNow.AddMinutes(-1));
        var stillPending = await harness.AddReservationAsync(
            ReservationStatus.PendingApproval,
            roomId: 31,
            roomTypeId: 21,
            approvalExpiresAtUtc: DateTime.UtcNow.AddMinutes(10));
        expired.BookingSessionId = session.Id;
        stillPending.BookingSessionId = session.Id;
        await harness.DbContext.SaveChangesAsync();

        var error = await Assert.ThrowsAsync<InvalidOperationException>(() =>
            harness.Service.ApproveAsync(expired.Id, harness.Owner));

        Assert.Contains("approval deadline", error.Message, StringComparison.OrdinalIgnoreCase);
        Assert.Equal(ReservationStatus.Rejected, expired.Status);
        Assert.Equal(ReservationStatus.PendingApproval, stillPending.Status);
        Assert.Null(stillPending.PaymentExpiresAtUtc);
    }

    [Fact]
    public async Task ScheduledApprovalExpiration_IsBoundedAndIdempotent()
    {
        await using var harness = await ReservationTestHarness.CreateAsync();
        var first = await harness.AddReservationAsync(
            ReservationStatus.PendingApproval,
            approvalExpiresAtUtc: DateTime.UtcNow.AddMinutes(-2));
        var second = await harness.AddReservationAsync(
            ReservationStatus.PendingApproval,
            roomId: 31,
            roomTypeId: 21,
            approvalExpiresAtUtc: DateTime.UtcNow.AddMinutes(-1));

        Assert.Equal(1, await harness.Service.ExpirePendingApprovalReservationsAsync(1));
        Assert.Equal(1, await harness.Service.ExpirePendingApprovalReservationsAsync(100));
        Assert.Equal(0, await harness.Service.ExpirePendingApprovalReservationsAsync(100));
        Assert.Equal(ReservationStatus.Rejected, first.Status);
        Assert.Equal(ReservationStatus.Rejected, second.Status);
    }

    [Fact]
    public async Task OwnerApprovalExpiration_RecordsCanonicalTimeoutCauseDistinctFromManualRejection()
    {
        await using var harness = await ReservationTestHarness.CreateAsync();
        var expired = await harness.AddReservationAsync(
            ReservationStatus.PendingApproval,
            approvalExpiresAtUtc: DateTime.UtcNow.AddMinutes(-1));
        var manuallyRejected = await harness.AddReservationAsync(
            ReservationStatus.PendingApproval,
            roomId: 31,
            roomTypeId: 21,
            approvalExpiresAtUtc: DateTime.UtcNow.AddMinutes(10));

        Assert.True(await harness.Service.ExpireApprovalWindowAsync(expired.Id));
        await harness.Service.UpdateStatusAsync(
            manuallyRejected.Id,
            new ReservationStatusUpdateRequest { Status = ReservationStatus.Rejected },
            harness.Owner);

        var timeoutAudit = Assert.Single(harness.AuditLogService.Entries);
        Assert.Equal(AuditAction.BookingExpired, timeoutAudit.Action);
        Assert.StartsWith(
            ReservationRejectionReasons.OwnerApprovalTimeout + ":",
            timeoutAudit.Description,
            StringComparison.Ordinal);
        Assert.DoesNotContain(
            harness.AuditLogService.Entries,
            entry => entry.EntityId == manuallyRejected.Id);
    }

    [Theory]
    [InlineData(ReservationStatus.Rejected)]
    [InlineData(ReservationStatus.Cancelled)]
    [InlineData(ReservationStatus.Confirmed)]
    [InlineData(ReservationStatus.Paid)]
    public async Task ApprovalExpiration_DoesNotChangeTerminalOrPaidStates(ReservationStatus status)
    {
        await using var harness = await ReservationTestHarness.CreateAsync();
        var reservation = await harness.AddReservationAsync(
            status,
            approvalExpiresAtUtc: DateTime.UtcNow.AddMinutes(-1));

        Assert.False(await harness.Service.ExpireApprovalWindowAsync(reservation.Id));
        Assert.Equal(status, reservation.Status);
    }

    [Fact]
    public async Task SessionApproval_LastChildAssignsOneSharedDeadline()
    {
        await using var harness = await ReservationTestHarness.CreateAsync(paymentWindowMinutes: 37);
        var session = new BookingSession
        {
            SessionCode = "KCH-S-APPROVAL",
            ClientId = 1,
            GuestId = 40,
            PropertyId = 10,
            Currency = "IRR",
            RequestHash = new string('A', 64)
        };
        harness.DbContext.BookingSessions.Add(session);
        await harness.DbContext.SaveChangesAsync();
        var first = await harness.AddReservationAsync(
            ReservationStatus.PendingApproval,
            roomId: 30,
            roomTypeId: 20);
        var second = await harness.AddReservationAsync(
            ReservationStatus.PendingApproval,
            roomId: 31,
            roomTypeId: 21);
        first.BookingSessionId = session.Id;
        second.BookingSessionId = session.Id;
        await harness.DbContext.SaveChangesAsync();

        await harness.Service.ApproveAsync(first.Id, harness.Owner);
        var partial = await LoadSummaryReservationsAsync(harness, session.Id);
        Assert.False(BookingSessionQueryService.BuildSummary(partial).IsPaymentReady);
        Assert.Equal(
            ReservationStatus.PendingApproval,
            partial.Single(item => item.ReservationId == second.Id).Status);
        await Assert.ThrowsAsync<InvalidOperationException>(() =>
            harness.Service.GeneratePaymentLinkAsync(first.Id, harness.SuperAdmin));

        var before = DateTime.UtcNow.AddMinutes(37);
        await harness.Service.ApproveAsync(second.Id, harness.Owner);
        var after = DateTime.UtcNow.AddMinutes(37);
        var completed = await LoadSummaryReservationsAsync(harness, session.Id);
        var deadline = Assert.Single(
            completed.Select(item => item.PaymentExpiresAtUtc).Distinct());
        Assert.NotNull(deadline);
        Assert.InRange(deadline.Value, before, after);
        Assert.True(BookingSessionQueryService.BuildSummary(completed).IsPaymentReady);
        Assert.All(completed, item =>
            Assert.Equal(ReservationStatus.ApprovedAwaitingPayment, item.Status));
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("invalid")]
    [InlineData("0")]
    public async Task Approval_RejectsMissingOrInvalidPaymentWindowSetting(string? configuredValue)
    {
        await using var harness = await ReservationTestHarness.CreateAsync(
            paymentWindowMinutes: null,
            paymentWindowValue: configuredValue);
        var pending = await harness.AddReservationAsync(ReservationStatus.PendingApproval);

        var error = await Assert.ThrowsAsync<InvalidOperationException>(() =>
            harness.Service.ApproveAsync(pending.Id, harness.Owner));

        Assert.Contains("reservation.paymentWindowMinutes", error.Message);
    }

    [Fact]
    public async Task Expiration_IsIdempotentAndReleasesHeldCapacity()
    {
        await using var harness = await ReservationTestHarness.CreateAsync();
        var reservation = await harness.AddReservationAsync(
            ReservationStatus.ApprovedAwaitingPayment,
            paymentExpiresAtUtc: DateTime.UtcNow.AddMinutes(-1));

        Assert.Equal(0, await harness.GetRemainingCapacityAsync());
        Assert.True(await harness.Service.ExpirePaymentWindowAsync(reservation.Id));
        Assert.False(await harness.Service.ExpirePaymentWindowAsync(reservation.Id));
        Assert.Equal(1, await harness.GetRemainingCapacityAsync());
        Assert.Equal(
            ReservationStatus.PaymentExpired,
            (await harness.DbContext.Reservations.FindAsync(reservation.Id))!.Status);
    }

    [Theory]
    [InlineData(ReservationStatus.Confirmed)]
    [InlineData(ReservationStatus.Paid)]
    public async Task Expiration_DoesNotChangeConfirmedOrPaidReservation(ReservationStatus status)
    {
        await using var harness = await ReservationTestHarness.CreateAsync();
        var reservation = await harness.AddReservationAsync(
            status,
            paymentExpiresAtUtc: DateTime.UtcNow.AddMinutes(-1));

        Assert.False(await harness.Service.ExpirePaymentWindowAsync(reservation.Id));
        Assert.Equal(status, (await harness.DbContext.Reservations.FindAsync(reservation.Id))!.Status);
    }

    [Theory]
    [InlineData(false)]
    [InlineData(true)]
    public async Task Expiration_DoesNotChangeApprovedReservationWithoutADueDeadline(bool hasFutureDeadline)
    {
        await using var harness = await ReservationTestHarness.CreateAsync();
        var reservation = await harness.AddReservationAsync(
            ReservationStatus.ApprovedAwaitingPayment,
            paymentExpiresAtUtc: hasFutureDeadline ? DateTime.UtcNow.AddMinutes(10) : null);

        Assert.False(await harness.Service.ExpirePaymentWindowAsync(reservation.Id));
        Assert.Equal(
            ReservationStatus.ApprovedAwaitingPayment,
            (await harness.DbContext.Reservations.FindAsync(reservation.Id))!.Status);
    }

    [Fact]
    public async Task SuccessfulSessionPaymentWinningTheRacePreventsExpiration()
    {
        await using var harness = await ReservationTestHarness.CreateAsync();
        var session = new BookingSession
        {
            SessionCode = "KCH-S-PAID-RACE",
            ClientId = 1,
            GuestId = 40,
            PropertyId = 10,
            Currency = "IRR",
            RequestHash = new string('R', 64)
        };
        harness.DbContext.BookingSessions.Add(session);
        var reservation = await harness.AddReservationAsync(
            ReservationStatus.ApprovedAwaitingPayment,
            paymentExpiresAtUtc: DateTime.UtcNow.AddMinutes(-1));
        reservation.BookingSession = session;
        var payment = new Payment
        {
            BookingSession = session,
            Amount = reservation.FinalAmount,
            Currency = reservation.Currency,
            Status = PaymentStatus.Successful,
            PaidAtUtc = DateTime.UtcNow
        };
        payment.Items.Add(new PaymentItem
        {
            Reservation = reservation,
            AllocatedAmount = reservation.FinalAmount,
            Currency = reservation.Currency
        });
        harness.DbContext.Payments.Add(payment);
        await harness.DbContext.SaveChangesAsync();

        Assert.False(await harness.Service.ExpirePaymentWindowAsync(reservation.Id));
        Assert.Equal(ReservationStatus.ApprovedAwaitingPayment, reservation.Status);
    }

    [Fact]
    public async Task OwnerCanRejectAccessiblePendingApprovalReservation()
    {
        await using var harness = await ReservationTestHarness.CreateAsync();
        var pending = await harness.AddReservationAsync(ReservationStatus.PendingApproval);

        var rejected = await harness.Service.UpdateStatusAsync(
            pending.Id,
            new ReservationStatusUpdateRequest { Status = ReservationStatus.Rejected },
            harness.Owner);

        Assert.Equal(ReservationStatus.Rejected, rejected.Status);
        Assert.Empty(rejected.AllowedStatusTransitions);
    }

    [Fact]
    public async Task OwnerCannotApproveOrRejectReservationForInaccessibleProperty()
    {
        await using var harness = await ReservationTestHarness.CreateAsync(permissionGranted: false);
        var pending = await harness.AddReservationAsync(ReservationStatus.PendingApproval);

        await Assert.ThrowsAsync<UnauthorizedAccessException>(() =>
            harness.Service.ApproveAsync(pending.Id, harness.Owner));
        await Assert.ThrowsAsync<UnauthorizedAccessException>(() =>
            harness.Service.UpdateStatusAsync(
                pending.Id,
                new ReservationStatusUpdateRequest { Status = ReservationStatus.Rejected },
                harness.Owner));
    }

    [Fact]
    public void OwnerCannotCreateReservationManually()
    {
        var controller = new OwnerReservationsController(null!, null!);

        Assert.Throws<UnauthorizedAccessException>(() =>
            controller.Create(10, new ReservationCreateRequest(), CancellationToken.None));
    }

    [Fact]
    public async Task OwnerCannotCancelReservation()
    {
        await using var harness = await ReservationTestHarness.CreateAsync();
        var pending = await harness.AddReservationAsync(ReservationStatus.Pending);

        await Assert.ThrowsAsync<UnauthorizedAccessException>(() =>
            harness.Service.CancelAsync(
                pending.Id,
                ValidCancellation(),
                harness.Owner));
    }

    [Fact]
    public async Task AdminAssistantRemainsConstrainedByPropertyPermission()
    {
        await using var harness = await ReservationTestHarness.CreateAsync(permissionGranted: false);
        var pending = await harness.AddReservationAsync(ReservationStatus.Pending);

        await Assert.ThrowsAsync<UnauthorizedAccessException>(() =>
            harness.Service.CancelAsync(
                pending.Id,
                ValidCancellation(),
                (8, UserRole.AdminAssistant)));
    }

    [Fact]
    public async Task SuperAdminRetainsAuthorizedCancellationBehavior()
    {
        await using var harness = await ReservationTestHarness.CreateAsync();
        var pending = await harness.AddReservationAsync(ReservationStatus.Pending);

        var cancelled = await harness.Service.CancelAsync(
            pending.Id,
            ValidCancellation(),
            harness.SuperAdmin);

        Assert.Equal(ReservationStatus.Cancelled, cancelled.Status);
    }

    [Fact]
    public async Task CancellationRequiresDefinedReasonAndNonEmptyTrimmedExplanation()
    {
        await using var harness = await ReservationTestHarness.CreateAsync();

        foreach (var request in new[]
                 {
                     new ReservationCancellationRequest { Reason = null, Explanation = "explanation" },
                     new ReservationCancellationRequest
                     {
                         Reason = (ReservationCancellationReason)999,
                         Explanation = "explanation"
                     },
                     new ReservationCancellationRequest
                     {
                         Reason = ReservationCancellationReason.GuestRequest,
                         Explanation = null
                     },
                     new ReservationCancellationRequest
                     {
                         Reason = ReservationCancellationReason.GuestRequest,
                         Explanation = ""
                     },
                     new ReservationCancellationRequest
                     {
                         Reason = ReservationCancellationReason.GuestRequest,
                         Explanation = "   "
                     }
                 })
        {
            var reservation = await harness.AddReservationAsync(ReservationStatus.Pending);
            await Assert.ThrowsAsync<ArgumentException>(() =>
                harness.Service.CancelAsync(reservation.Id, request, harness.SuperAdmin));
        }
    }

    [Fact]
    public async Task CancellationTrimsExplanationAndReleasesHeldCapacity()
    {
        await using var harness = await ReservationTestHarness.CreateAsync();
        var approved = await harness.AddReservationAsync(ReservationStatus.ApprovedAwaitingPayment);
        Assert.Equal(0, await harness.GetRemainingCapacityAsync());

        var cancelled = await harness.Service.CancelAsync(
            approved.Id,
            new ReservationCancellationRequest
            {
                Reason = ReservationCancellationReason.GuestRequest,
                Explanation = "  guest changed plans  "
            },
            harness.SuperAdmin);

        Assert.Equal("guest changed plans", cancelled.CancellationNote);
        Assert.Equal(1, await harness.GetRemainingCapacityAsync());
    }

    [Theory]
    [InlineData(ReservationStatus.Cancelled)]
    [InlineData(ReservationStatus.Rejected)]
    [InlineData(ReservationStatus.PaymentExpired)]
    [InlineData(ReservationStatus.CapacityLost)]
    [InlineData(ReservationStatus.Completed)]
    public async Task TerminalReservationCannotBeEditedOrPriceAdjusted(ReservationStatus status)
    {
        await using var harness = await ReservationTestHarness.CreateAsync();
        var reservation = await harness.AddReservationAsync(status);
        var update = new ReservationUpdateRequest
        {
            GuestId = 40,
            RoomTypeId = 20,
            RoomIds = [30],
            RoomCount = 1,
            CheckInDate = harness.CheckIn,
            CheckOutDate = harness.CheckOut,
            Adults = 1,
            Children = 0
        };

        await Assert.ThrowsAsync<InvalidOperationException>(() =>
            harness.Service.UpdateAsync(reservation.Id, update, harness.SuperAdmin));
        await Assert.ThrowsAsync<InvalidOperationException>(() =>
            harness.Service.AdjustPriceAsync(
                reservation.Id,
                new ReservationPriceAdjustmentRequest { Amount = 1 },
                harness.SuperAdmin));
    }

    private static async Task<IReadOnlyList<BookingSessionReservationDetailsResponse>>
        LoadSummaryReservationsAsync(
            ReservationTestHarness harness,
            int bookingSessionId) =>
        await harness.DbContext.Reservations.AsNoTracking()
            .Where(item => item.BookingSessionId == bookingSessionId)
            .OrderBy(item => item.Id)
            .Select(item => new BookingSessionReservationDetailsResponse
            {
                ReservationId = item.Id,
                ReservationNumber = item.ReservationNumber ?? string.Empty,
                RoomTypeId = item.RoomTypeId,
                CheckInDate = item.CheckInDate,
                CheckOutDate = item.CheckOutDate,
                Status = item.Status,
                PaymentExpiresAtUtc = item.PaymentExpiresAtUtc,
                FinalAmount = item.FinalAmount,
                Currency = item.Currency
            })
            .ToListAsync();

    private static ReservationCancellationRequest ValidCancellation() => new()
    {
        Reason = ReservationCancellationReason.GuestRequest,
        Explanation = "Guest requested cancellation."
    };
}

internal sealed class ReservationTestHarness : IAsyncDisposable
{
    private ReservationTestHarness(KoochDbContext dbContext, bool permissionGranted)
    {
        DbContext = dbContext;
        var permissions = new StubPermissionService(permissionGranted);
        EffectiveAvailability = new EffectiveAvailabilityService(dbContext);
        AuditLogService = new RecordingAuditLogService();
        Service = new ReservationService(
            dbContext,
            new StubReservationAvailabilityService(),
            new StubReservationPricingService(),
            new StubReservationNumberGenerator(),
            new RecordingNotificationService(),
            new RecordingReservationNotificationDispatcher(),
            AuditLogService,
            permissions,
            new StubPropertyAuthorizationService(permissionGranted),
            new ReservationStatusWorkflow(),
            EffectiveAvailability,
            new TestHostEnvironment());
    }

    public DateOnly CheckIn { get; } = new(2026, 8, 1);
    public DateOnly CheckOut { get; } = new(2026, 8, 3);
    public (int UserId, UserRole Role) Owner => (2, UserRole.Client);
    public (int UserId, UserRole Role) SuperAdmin => (1, UserRole.SuperAdmin);
    public KoochDbContext DbContext { get; }
    public RecordingAuditLogService AuditLogService { get; }
    public EffectiveAvailabilityService EffectiveAvailability { get; }
    public ReservationService Service { get; }

    public static async Task<ReservationTestHarness> CreateAsync(
        bool permissionGranted = true,
        int? paymentWindowMinutes = 10,
        string? paymentWindowValue = null,
        int? ownerApprovalWindowMinutes = 10,
        string? ownerApprovalWindowValue = null)
    {
        var options = new DbContextOptionsBuilder<KoochDbContext>()
            .UseInMemoryDatabase(Guid.NewGuid().ToString("N"))
            .ConfigureWarnings(warnings =>
                warnings.Ignore(InMemoryEventId.TransactionIgnoredWarning))
            .Options;
        var dbContext = new KoochDbContext(options);
        var harness = new ReservationTestHarness(dbContext, permissionGranted);

        dbContext.Users.AddRange(
            CreateUser(1, UserRole.SuperAdmin, "admin"),
            CreateUser(2, UserRole.Client, "owner"),
            CreateUser(3, UserRole.Client, "guest"));
        dbContext.Destinations.Add(new Destination
        {
            Id = 1,
            Name = "Kashan",
            Slug = "kashan",
            Country = "Iran"
        });
        dbContext.Properties.Add(new Property
        {
            Id = 10,
            OwnerId = 2,
            DestinationId = 1,
            Name = "Test property",
            Slug = "test-property",
            Description = "Test",
            Address = "Test address",
            City = "Kashan",
            Country = "Iran",
            Status = PropertyStatus.Approved
        });
        dbContext.RoomTypes.AddRange(
            CreateRoomType(20),
            CreateRoomType(21));
        dbContext.Rooms.AddRange(
            new Room { Id = 30, RoomTypeId = 20, Name = "Room 1", IsActive = true },
            new Room { Id = 31, RoomTypeId = 21, Name = "Room 2", IsActive = true });
        dbContext.Guests.Add(new Guest
        {
            Id = 40,
            UserId = 3,
            FirstName = "Test",
            LastName = "Guest"
        });
        if (paymentWindowMinutes.HasValue || paymentWindowValue is not null)
        {
            dbContext.SiteSettings.Add(new SiteSetting
            {
                Id = 50,
                Key = "reservation.paymentWindowMinutes",
                Value = paymentWindowValue ?? paymentWindowMinutes!.Value.ToString(),
                Type = SiteSettingType.Number,
                Group = "Reservation",
                Label = "Payment window",
                IsActive = true
            });
        }
        if (ownerApprovalWindowMinutes.HasValue || ownerApprovalWindowValue is not null)
        {
            dbContext.SiteSettings.Add(new SiteSetting
            {
                Id = 51,
                Key = "reservation.ownerApprovalWindowMinutes",
                Value = ownerApprovalWindowValue ?? ownerApprovalWindowMinutes!.Value.ToString(),
                Type = SiteSettingType.Number,
                Group = "Reservation",
                Label = "Owner approval window",
                IsActive = true
            });
        }

        await dbContext.SaveChangesAsync();
        return harness;
    }

    public async Task<Reservation> AddReservationAsync(
        ReservationStatus status,
        int? roomId = 30,
        DateTime? paymentExpiresAtUtc = null,
        int roomTypeId = 20,
        DateTime? approvalExpiresAtUtc = null)
    {
        var reservation = new Reservation
        {
            ReservationNumber = $"KCH-TEST-{Guid.NewGuid():N}",
            ClientId = 1,
            GuestId = 40,
            PropertyId = 10,
            RoomTypeId = roomTypeId,
            RoomId = roomId,
            CheckInDate = CheckIn,
            CheckOutDate = CheckOut,
            AdultCount = 1,
            TotalPrice = 100,
            BaseAmount = 100,
            FinalAmount = 100,
            Status = status,
            Source = ReservationSource.AdminCreated,
            ApprovalExpiresAtUtc = approvalExpiresAtUtc,
            PaymentExpiresAtUtc = paymentExpiresAtUtc
        };
        DbContext.Reservations.Add(reservation);
        await DbContext.SaveChangesAsync();
        return reservation;
    }

    public async Task<int> GetRemainingCapacityAsync()
    {
        var range = await EffectiveAvailability.GetRangeAsync([20], CheckIn, CheckOut);
        return range[20].Nights[CheckIn].RemainingCapacity;
    }

    public ValueTask DisposeAsync() => DbContext.DisposeAsync();

    private static User CreateUser(int id, UserRole role, string name) => new()
    {
        Id = id,
        FirstName = name,
        LastName = "user",
        Email = $"{name}@example.test",
        PasswordHash = "not-used",
        Role = role,
        IsActive = true
    };

    private static RoomType CreateRoomType(int id) => new()
    {
        Id = id,
        PropertyId = 10,
        Name = "Room type " + id,
        Slug = "room-type-" + id,
        Description = "Test",
        TotalInventory = 1,
        MaxAdults = 2,
        IsActive = true
    };
}

internal sealed class RecordingReservationNotificationDispatcher : IReservationNotificationDispatcher
{
    public List<int> PendingApprovalReservationIds { get; } = [];
    public List<int> TimedOutReservationIds { get; } = [];

    public Task NotifyPendingApprovalAsync(
        IReadOnlyCollection<int> reservationIds,
        CancellationToken cancellationToken = default)
    {
        PendingApprovalReservationIds.AddRange(reservationIds);
        return Task.CompletedTask;
    }

    public Task NotifyOwnerApprovalTimeoutAsync(
        int reservationId,
        CancellationToken cancellationToken = default)
    {
        TimedOutReservationIds.Add(reservationId);
        return Task.CompletedTask;
    }

    public Task<bool> NotifyApprovalReminderAsync(
        int reservationId,
        DateTime nowUtc,
        string occurrenceKey,
        CancellationToken cancellationToken = default) => Task.FromResult(false);
}

internal sealed class StubPermissionService(bool allowed) : IPermissionService
{
    public Task<bool> CanAsync(
        int userId,
        int propertyId,
        string permissionKey,
        CancellationToken cancellationToken = default) => Task.FromResult(allowed);

    public Task<bool> HasPermissionAsync(
        int userId,
        PermissionKey permissionKey,
        int? propertyId = null,
        CancellationToken cancellationToken = default) => Task.FromResult(allowed);
}

internal sealed class StubPropertyAuthorizationService(bool allowed) : IPropertyAuthorizationService
{
    public Task<bool> CanAccessPropertyAsync(int userId, int propertyId, CancellationToken cancellationToken = default) =>
        Task.FromResult(allowed);

    public Task<bool> CanAccessOwnerPanelAsync(int userId, CancellationToken cancellationToken = default) =>
        Task.FromResult(allowed);

    public Task<bool> HasPropertyPermissionAsync(
        int userId,
        int propertyId,
        string permissionKey,
        CancellationToken cancellationToken = default) => Task.FromResult(allowed);

    public Task<EffectivePropertyPermissions?> GetEffectivePropertyPermissionsAsync(
        int userId,
        int propertyId,
        CancellationToken cancellationToken = default) => Task.FromResult<EffectivePropertyPermissions?>(null);

    public Task<IReadOnlyList<int>> GetAccessiblePropertiesAsync(
        int userId,
        CancellationToken cancellationToken = default) =>
        Task.FromResult<IReadOnlyList<int>>(allowed ? [10] : []);
}

internal sealed class StubReservationAvailabilityService : IReservationAvailabilityService
{
    public Task<IReadOnlyList<AvailableRoomResponse>> GetAvailableRoomsAsync(
        int propertyId,
        DateOnly checkInDate,
        DateOnly checkOutDate,
        int? excludedReservationId = null,
        CancellationToken cancellationToken = default) =>
        Task.FromResult<IReadOnlyList<AvailableRoomResponse>>([]);

    public Task<ReservationAvailabilityResult> GetAvailabilityAsync(
        int propertyId,
        int roomTypeId,
        DateOnly checkInDate,
        DateOnly checkOutDate,
        int roomCount,
        int? excludedReservationId = null,
        CancellationToken cancellationToken = default) =>
        Task.FromResult(new ReservationAvailabilityResult());

    public Task ValidateAsync(
        int propertyId,
        int roomTypeId,
        DateOnly checkInDate,
        DateOnly checkOutDate,
        int roomCount,
        CancellationToken cancellationToken = default) => Task.CompletedTask;
}

internal sealed class StubReservationPricingService : IReservationPricingService
{
    public Task<ReservationPricePreviewResponse> PreviewReservationPriceAsync(
        ReservationPricePreviewRequest request,
        CancellationToken cancellationToken = default) =>
        Task.FromResult(new ReservationPricePreviewResponse
        {
            PropertyId = request.PropertyId,
            RoomTypeId = request.RoomTypeId,
            CheckInDate = request.CheckInDate,
            CheckOutDate = request.CheckOutDate,
            Adults = request.Adults,
            Children = request.Children,
            RoomCount = request.RoomCount,
            FinalAmount = 100
        });
}

internal sealed class StubReservationNumberGenerator : IReservationNumberGenerator
{
    public Task<string> GenerateAsync(DateTime? nowUtc = null, CancellationToken cancellationToken = default) =>
        Task.FromResult($"KCH-TEST-{Guid.NewGuid():N}");

    public Task<IReadOnlyList<string>> GenerateBatchAsync(
        int count,
        DateTime? nowUtc = null,
        CancellationToken cancellationToken = default) =>
        Task.FromResult<IReadOnlyList<string>>(
            Enumerable.Range(0, count)
                .Select(_ => $"KCH-TEST-{Guid.NewGuid():N}")
                .ToArray());
}

internal sealed class RecordingNotificationService : INotificationService
{
    public List<NotificationRequest> Requests { get; } = [];

    public Task SendAsync(NotificationRequest request, CancellationToken cancellationToken = default)
    {
        Requests.Add(request);
        return Task.CompletedTask;
    }
}

internal sealed class RecordingAuditLogService : IAuditLogService
{
    public List<AuditLogEntry> Entries { get; } = [];

    public void Add(
        int userId,
        AuditAction action,
        string entityType,
        int? entityId = null,
        int? propertyId = null,
        string? entityName = null,
        string? description = null)
    {
        Entries.Add(new AuditLogEntry(
            userId,
            action,
            entityType,
            entityId,
            propertyId,
            entityName,
            description));
    }

    public Task<IReadOnlyList<AuditLogResponse>> GetByPropertyAsync(
        int userId,
        UserRole role,
        int propertyId,
        CancellationToken cancellationToken = default) =>
        Task.FromResult<IReadOnlyList<AuditLogResponse>>([]);
}

internal sealed record AuditLogEntry(
    int UserId,
    AuditAction Action,
    string EntityType,
    int? EntityId,
    int? PropertyId,
    string? EntityName,
    string? Description);

internal sealed class NoOpAuditLogService : IAuditLogService
{
    public void Add(
        int userId,
        AuditAction action,
        string entityType,
        int? entityId = null,
        int? propertyId = null,
        string? entityName = null,
        string? description = null)
    {
    }

    public Task<IReadOnlyList<AuditLogResponse>> GetByPropertyAsync(
        int userId,
        UserRole role,
        int propertyId,
        CancellationToken cancellationToken = default) =>
        Task.FromResult<IReadOnlyList<AuditLogResponse>>([]);
}

internal sealed class TestHostEnvironment : IHostEnvironment
{
    public string EnvironmentName { get; set; } = Environments.Development;
    public string ApplicationName { get; set; } = "Kooch.Api.Tests";
    public string ContentRootPath { get; set; } = Directory.GetCurrentDirectory();
    public IFileProvider ContentRootFileProvider { get; set; } = new NullFileProvider();
}
