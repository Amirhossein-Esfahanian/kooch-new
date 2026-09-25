using Kooch.Api.Authentication;
using Kooch.Api.Controllers;
using Kooch.Api.Data;
using Kooch.Api.Dtos.Payments;
using Kooch.Api.Dtos.Reservations;
using Kooch.Api.Entities;
using Kooch.Api.Services;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Diagnostics;
using Xunit;

namespace Kooch.Api.Tests;

public sealed class AdminManualPaymentServiceTests
{
    [Fact]
    public async Task Create_PersistsPendingManualPaymentWithoutConfirmingReservation()
    {
        await using var harness = await ManualPaymentHarness.CreateAsync();

        var result = await harness.CreateManualPaymentAsync();

        var payment = await harness.Context.Payments
            .Include(item => item.ManualDetails)
            .SingleAsync();
        var reservation = await harness.Context.Reservations.SingleAsync();
        Assert.Equal(PaymentChannel.Manual, result.Channel);
        Assert.Equal(PaymentStatus.Pending, payment.Status);
        Assert.Equal(
            ManualPaymentVerificationStatus.PendingVerification,
            payment.ManualDetails!.VerificationStatus);
        Assert.Equal(ManualPaymentHarness.AdminUserId, payment.ManualDetails.SubmittedByUserId);
        Assert.NotEqual(default, payment.ManualDetails.SubmittedAtUtc);
        Assert.Equal(ReservationStatus.ApprovedAwaitingPayment, reservation.Status);
        Assert.Null(reservation.ConfirmedAtUtc);
    }

    [Fact]
    public async Task Create_RejectsPaymentThatDoesNotCoverReservationBalance()
    {
        await using var harness = await ManualPaymentHarness.CreateAsync();

        var error = await Assert.ThrowsAsync<InvalidOperationException>(() =>
            harness.CreateManualPaymentAsync(amount: 99m, reservationAmount: 100m));

        Assert.Contains("does not cover", error.Message);
        Assert.Empty(await harness.Context.Payments.ToListAsync());
    }

    [Fact]
    public async Task Create_RejectsWhenSuccessfulPaymentsAlreadyCoverReservation()
    {
        await using var harness = await ManualPaymentHarness.CreateAsync();
        var pending = await harness.CreateManualPaymentAsync();
        harness.Context.Payments.Add(new Payment
        {
            ReservationId = pending.ReservationId,
            Amount = 100m,
            Currency = "IRR",
            Status = PaymentStatus.Successful,
            PaidAtUtc = DateTime.UtcNow
        });
        await harness.Context.SaveChangesAsync();

        var error = await Assert.ThrowsAsync<InvalidOperationException>(() =>
            harness.CreateManualPaymentAsync());

        Assert.Contains("already has sufficient successful payment", error.Message);
    }

    [Fact]
    public async Task GetByReservation_ReturnsManualPaymentsWithReviewMetadata()
    {
        await using var harness = await ManualPaymentHarness.CreateAsync();
        var created = await harness.CreateManualPaymentAsync();
        var details = await harness.Context.ManualPaymentDetails.SingleAsync();
        details.DestinationBank = "Test bank";
        details.DestinationAccountReference = "ACC-1";
        details.Notes = "Admin note";
        harness.Context.Reservations.Add(new Reservation
        {
            Id = 11,
            ReservationNumber = "KCH-MANUAL-11",
            ClientId = ManualPaymentHarness.AdminUserId,
            PropertyId = 30,
            RoomTypeId = 20,
            CheckInDate = new DateOnly(2036, 2, 1),
            CheckOutDate = new DateOnly(2036, 2, 2),
            AdultCount = 1,
            TotalPrice = 100m,
            FinalAmount = 100m,
            Currency = "IRR",
            CommissionType = CommissionType.Direct,
            Status = ReservationStatus.ApprovedAwaitingPayment,
            Source = ReservationSource.Website,
            PaymentExpiresAtUtc = DateTime.UtcNow.AddHours(1)
        });
        harness.Context.Payments.Add(new Payment
        {
            ReservationId = 11,
            Amount = 100m,
            Currency = "IRR",
            Channel = PaymentChannel.Manual,
            Status = PaymentStatus.Pending,
            ManualDetails = new ManualPaymentDetails
            {
                Method = ManualPaymentMethod.CardToCard,
                PaymentDate = DateOnly.FromDateTime(DateTime.UtcNow),
                SubmittedByUserId = ManualPaymentHarness.AdminUserId,
                SubmittedAtUtc = DateTime.UtcNow
            }
        });
        await harness.Context.SaveChangesAsync();

        var results = await harness.Service.GetByReservationAsync(created.ReservationId);

        var payment = Assert.Single(results);
        Assert.Equal(created.PaymentId, payment.PaymentId);
        Assert.Equal(PaymentStatus.Pending, payment.Status);
        Assert.Equal(ManualPaymentVerificationStatus.PendingVerification, payment.VerificationStatus);
        Assert.Equal("Admin User", payment.SubmittedBy);
        Assert.Equal("Test bank", payment.DestinationBank);
        Assert.Equal("ACC-1", payment.DestinationAccountReference);
        Assert.Equal("Admin note", payment.Notes);
    }

    [Fact]
    public async Task Approve_AtomicallyConfirmsAndUsesGlobalFinancializationPolicy()
    {
        await using var harness = await ManualPaymentHarness.CreateAsync();
        var created = await harness.CreateManualPaymentAsync();
        var before = DateTime.UtcNow;

        var result = await harness.Service.ApproveAsync(created.PaymentId, ManualPaymentHarness.AdminUserId);

        var payment = await harness.Context.Payments
            .Include(item => item.ManualDetails)
            .SingleAsync();
        var reservation = await harness.Context.Reservations.SingleAsync();
        var snapshot = await harness.Context.ReservationFinancialSnapshots.SingleAsync();
        var payable = await harness.Context.FinancialEntries.SingleAsync();
        var voucher = await harness.Context.ReservationVouchers.SingleAsync();
        Assert.Equal(PaymentStatus.Successful, payment.Status);
        Assert.NotNull(payment.PaidAtUtc);
        Assert.Equal(ManualPaymentVerificationStatus.Approved, payment.ManualDetails!.VerificationStatus);
        Assert.Equal(ManualPaymentHarness.AdminUserId, payment.ManualDetails.VerifiedByUserId);
        Assert.InRange(payment.ManualDetails.VerifiedAtUtc!.Value, before, DateTime.UtcNow);
        Assert.Equal(ReservationStatus.Confirmed, reservation.Status);
        Assert.Equal(payment.Amount, snapshot.GrossAmount);
        Assert.Equal(CommissionRateSource.Global, snapshot.CommissionRateSource);
        Assert.Equal(10m, snapshot.CommissionAmount);
        Assert.Equal(FinancialEntryType.PropertyPayable, payable.EntryType);
        Assert.Equal(90m, payable.Amount);
        Assert.Equal(payment.Amount, snapshot.CommissionAmount + snapshot.PropertyPayableAmount);
        Assert.Equal(snapshot.Id, voucher.ReservationFinancialSnapshotId);
        Assert.Equal(snapshot.GrossAmount, voucher.GrossAmount);
        Assert.True(result.CapacityClaimed);
    }

    [Fact]
    public async Task Approve_UsesPropertyCommissionOverride()
    {
        await using var harness = await ManualPaymentHarness.CreateAsync(propertyRate: 12.5m);
        var created = await harness.CreateManualPaymentAsync(amount: 1m, reservationAmount: 1m);

        await harness.Service.ApproveAsync(created.PaymentId, ManualPaymentHarness.AdminUserId);

        var snapshot = await harness.Context.ReservationFinancialSnapshots.SingleAsync();
        Assert.Equal(CommissionRateSource.PropertyOverride, snapshot.CommissionRateSource);
        Assert.Equal(12.5m, snapshot.CommissionRate);
        Assert.Equal(0.13m, snapshot.CommissionAmount);
        Assert.Equal(0.87m, snapshot.PropertyPayableAmount);
    }

    [Fact]
    public async Task Reject_FailsPaymentAndPreservesReservationEvidenceAndFinancialState()
    {
        await using var harness = await ManualPaymentHarness.CreateAsync();
        var created = await harness.CreateManualPaymentAsync(evidenceFilePath: "/manual/evidence.jpg");
        var originalStatus = (await harness.Context.Reservations.SingleAsync()).Status;

        await harness.Service.RejectAsync(
            created.PaymentId,
            new AdminManualPaymentRejectRequest { Reason = "  Bank receipt could not be verified.  " },
            ManualPaymentHarness.AdminUserId);

        var payment = await harness.Context.Payments
            .Include(item => item.ManualDetails)
            .SingleAsync();
        Assert.Equal(PaymentStatus.Failed, payment.Status);
        Assert.NotNull(payment.FailedAtUtc);
        Assert.Equal(ManualPaymentVerificationStatus.Rejected, payment.ManualDetails!.VerificationStatus);
        Assert.Equal(ManualPaymentHarness.AdminUserId, payment.ManualDetails.RejectedByUserId);
        Assert.NotNull(payment.ManualDetails.RejectedAtUtc);
        Assert.Equal("Bank receipt could not be verified.", payment.ManualDetails.RejectionReason);
        Assert.Equal("/manual/evidence.jpg", payment.ManualDetails.EvidenceFilePath);
        Assert.Equal(originalStatus, (await harness.Context.Reservations.SingleAsync()).Status);
        Assert.Empty(await harness.Context.ReservationFinancialSnapshots.ToListAsync());
        Assert.Empty(await harness.Context.FinancialEntries.ToListAsync());
        Assert.Empty(await harness.Context.ReservationVouchers.ToListAsync());
    }

    [Fact]
    public async Task ApproveAfterReject_IsRejectedWithoutFinancialization()
    {
        await using var harness = await ManualPaymentHarness.CreateAsync();
        var created = await harness.CreateManualPaymentAsync();
        await harness.Service.RejectAsync(
            created.PaymentId,
            new AdminManualPaymentRejectRequest { Reason = "Rejected receipt" },
            ManualPaymentHarness.AdminUserId);

        var error = await Assert.ThrowsAsync<InvalidOperationException>(() =>
            harness.Service.ApproveAsync(created.PaymentId, ManualPaymentHarness.AdminUserId));

        Assert.Contains("already finalized", error.Message);
        Assert.Empty(await harness.Context.ReservationFinancialSnapshots.ToListAsync());
        Assert.Empty(await harness.Context.FinancialEntries.ToListAsync());
    }

    [Fact]
    public async Task RejectAfterApprove_IsRejectedAndPreservesSuccessfulRecognition()
    {
        await using var harness = await ManualPaymentHarness.CreateAsync();
        var created = await harness.CreateManualPaymentAsync();
        await harness.Service.ApproveAsync(created.PaymentId, ManualPaymentHarness.AdminUserId);

        var error = await Assert.ThrowsAsync<InvalidOperationException>(() =>
            harness.Service.RejectAsync(
                created.PaymentId,
                new AdminManualPaymentRejectRequest { Reason = "Too late" },
                ManualPaymentHarness.AdminUserId));

        Assert.Contains("already finalized", error.Message);
        Assert.Equal(1, await harness.Context.ReservationFinancialSnapshots.CountAsync());
        Assert.Equal(1, await harness.Context.FinancialEntries.CountAsync());
        Assert.Equal(1, await harness.Context.ReservationVouchers.CountAsync());
    }

    [Fact]
    public async Task DuplicateApproval_IsRejectedWithoutDuplicatingFinancialRecords()
    {
        await using var harness = await ManualPaymentHarness.CreateAsync();
        var created = await harness.CreateManualPaymentAsync();
        await harness.Service.ApproveAsync(created.PaymentId, ManualPaymentHarness.AdminUserId);

        await Assert.ThrowsAsync<InvalidOperationException>(() =>
            harness.Service.ApproveAsync(created.PaymentId, ManualPaymentHarness.AdminUserId));

        Assert.Equal(1, await harness.Context.ReservationFinancialSnapshots.CountAsync());
        Assert.Equal(1, await harness.Context.FinancialEntries.CountAsync());
        Assert.Equal(1, await harness.Context.ReservationVouchers.CountAsync());
    }

    [Fact]
    public async Task ResolverFailure_LeavesPaymentVerificationAndReservationUnchanged()
    {
        await using var harness = await ManualPaymentHarness.CreateAsync(includeGlobalRate: false);
        var created = await harness.CreateManualPaymentAsync();

        await Assert.ThrowsAsync<KeyNotFoundException>(() =>
            harness.Service.ApproveAsync(created.PaymentId, ManualPaymentHarness.AdminUserId));

        var payment = await harness.Context.Payments
            .Include(item => item.ManualDetails)
            .SingleAsync();
        Assert.Equal(PaymentStatus.Pending, payment.Status);
        Assert.Null(payment.PaidAtUtc);
        Assert.Equal(
            ManualPaymentVerificationStatus.PendingVerification,
            payment.ManualDetails!.VerificationStatus);
        Assert.Null(payment.ManualDetails.VerifiedByUserId);
        Assert.Equal(
            ReservationStatus.ApprovedAwaitingPayment,
            (await harness.Context.Reservations.SingleAsync()).Status);
        Assert.Empty(await harness.Context.ReservationFinancialSnapshots.ToListAsync());
        Assert.Empty(await harness.Context.FinancialEntries.ToListAsync());
        Assert.Empty(await harness.Context.ReservationVouchers.ToListAsync());
    }

    [Fact]
    public async Task CapacityUnavailable_PreservesReceivedPaymentAndUsesExistingCapacityLostRule()
    {
        await using var harness = await ManualPaymentHarness.CreateAsync(hasCapacity: false);
        var created = await harness.CreateManualPaymentAsync();

        var result = await harness.Service.ApproveAsync(created.PaymentId, ManualPaymentHarness.AdminUserId);

        var payment = await harness.Context.Payments
            .Include(item => item.ManualDetails)
            .SingleAsync();
        Assert.Equal(PaymentStatus.Successful, payment.Status);
        Assert.Equal(ManualPaymentVerificationStatus.Approved, payment.ManualDetails!.VerificationStatus);
        Assert.Equal(ReservationStatus.CapacityLost, result.ReservationStatus);
        Assert.False(result.CapacityClaimed);
        Assert.Empty(await harness.Context.ReservationFinancialSnapshots.ToListAsync());
        Assert.Empty(await harness.Context.FinancialEntries.ToListAsync());
        Assert.Empty(await harness.Context.ReservationVouchers.ToListAsync());
    }

    [Fact]
    public void Controller_RequiresAdminAndManagePaymentsAuthorization()
    {
        Assert.Single(
            typeof(AdminManualPaymentsController)
                .GetCustomAttributes(typeof(AdminAuthorizeAttribute), inherit: true));
        var permission = Assert.Single(
            typeof(AdminManualPaymentsController)
                .GetCustomAttributes(typeof(PermissionAuthorizeAttribute), inherit: true)
                .OfType<PermissionAuthorizeAttribute>());
        Assert.Equal(
            $"{AuthorizationPolicies.PermissionPrefix}{PermissionKey.ManagePayments}",
            permission.Policy);
    }

    [Fact]
    public async Task AdminAssistantWithoutManagePayments_IsDeniedByCanonicalPermissionService()
    {
        var options = new DbContextOptionsBuilder<KoochDbContext>()
            .UseInMemoryDatabase(Guid.NewGuid().ToString("N"))
            .Options;
        await using var context = new KoochDbContext(options);
        context.Users.Add(new User
        {
            Id = 22,
            FirstName = "Assistant",
            LastName = "Without permission",
            PasswordHash = "not-used",
            Role = UserRole.AdminAssistant,
            IsActive = true
        });
        await context.SaveChangesAsync();
        var permissionService = new PermissionService(context, new PropertyAccessService(context));

        Assert.False(await permissionService.HasPermissionAsync(22, PermissionKey.ManagePayments));
    }

    [Fact]
    public async Task DirectAdminStatusMutation_CannotConfirmWithoutSuccessfulPayment()
    {
        await using var harness = await ReservationTestHarness.CreateAsync();
        var pending = await harness.AddReservationAsync(ReservationStatus.Pending);

        var error = await Assert.ThrowsAsync<InvalidOperationException>(() =>
            harness.Service.UpdateStatusAsync(
                pending.Id,
                new ReservationStatusUpdateRequest { Status = ReservationStatus.Confirmed },
                harness.SuperAdmin));

        Assert.Contains("without a successful payment", error.Message);
        Assert.Equal(
            ReservationStatus.Pending,
            (await harness.DbContext.Reservations.FindAsync(pending.Id))!.Status);
        Assert.Empty(await harness.DbContext.ReservationVouchers.ToListAsync());
    }

    [Fact]
    public async Task AdminManualCreation_CannotStartAsConfirmedWithoutSuccessfulPayment()
    {
        await using var harness = await ReservationTestHarness.CreateAsync();

        var error = await Assert.ThrowsAsync<InvalidOperationException>(() =>
            harness.Service.CreateAsync(
                new ReservationCreateRequest
                {
                    Status = ReservationStatus.Confirmed,
                    PropertyId = 10,
                    RoomTypeId = 20,
                    RoomId = 30,
                    GuestId = 40,
                    CheckInDate = harness.CheckIn,
                    CheckOutDate = harness.CheckOut,
                    Adults = 1,
                    RoomCount = 1
                },
                harness.SuperAdmin));

        Assert.Contains("without a successful payment", error.Message);
        Assert.Empty(await harness.DbContext.Reservations.ToListAsync());
    }

    private sealed class ManualPaymentHarness : IAsyncDisposable
    {
        public const int AdminUserId = 1;
        private const int ReservationId = 10;
        private ManualPaymentHarness(KoochDbContext context, StubAvailabilityService availability)
        {
            Context = context;
            Service = new AdminManualPaymentService(
                context,
                availability,
                new PaymentFinancializationService(context, new CommissionPolicyResolver(context)));
        }

        public KoochDbContext Context { get; }
        public AdminManualPaymentService Service { get; }

        public static async Task<ManualPaymentHarness> CreateAsync(
            bool hasCapacity = true,
            bool includeGlobalRate = true,
            decimal? propertyRate = null)
        {
            var options = new DbContextOptionsBuilder<KoochDbContext>()
                .UseInMemoryDatabase($"admin-manual-payment-{Guid.NewGuid():N}")
                .ConfigureWarnings(warnings =>
                    warnings.Ignore(InMemoryEventId.TransactionIgnoredWarning))
                .Options;
            var context = new KoochDbContext(options);
            var harness = new ManualPaymentHarness(context, new StubAvailabilityService(hasCapacity));
            context.Users.Add(new User
            {
                Id = AdminUserId,
                FirstName = "Admin",
                LastName = "User",
                PasswordHash = "not-used",
                Role = UserRole.SuperAdmin,
                IsActive = true
            });
            context.Properties.Add(new Property
            {
                Id = 30,
                OwnerId = AdminUserId,
                Name = "Manual payment property",
                Slug = "manual-payment-property"
            });
            context.RoomTypes.Add(new RoomType
            {
                Id = 20,
                PropertyId = 30,
                Name = "Room type",
                Slug = "room-type",
                TotalInventory = 1,
                InventoryMode = InventoryMode.TypeBasedInventory
            });
            if (includeGlobalRate)
            {
                context.SiteSettings.Add(new SiteSetting
                {
                    Key = CommissionPolicyResolver.DirectSettingKey,
                    Value = "10",
                    Type = SiteSettingType.Number,
                    Group = "Reservation",
                    Label = "Direct commission",
                    IsActive = true
                });
            }

            if (propertyRate.HasValue)
            {
                context.PropertyCommissionRates.Add(new PropertyCommissionRate
                {
                    Id = 41,
                    PropertyId = 30,
                    CommissionType = CommissionType.Direct,
                    Rate = propertyRate.Value,
                    IsEnabled = true
                });
            }

            await context.SaveChangesAsync();
            return harness;
        }

        public async Task<AdminManualPaymentResponse> CreateManualPaymentAsync(
            decimal amount = 100m,
            decimal reservationAmount = 100m,
            string? evidenceFilePath = null)
        {
            var reservation = await Context.Reservations.SingleOrDefaultAsync(item => item.Id == ReservationId);
            if (reservation is null)
            {
                reservation = new Reservation
                {
                    Id = ReservationId,
                    ReservationNumber = "KCH-MANUAL-10",
                    ClientId = AdminUserId,
                    PropertyId = 30,
                    RoomTypeId = 20,
                    CheckInDate = new DateOnly(2036, 1, 1),
                    CheckOutDate = new DateOnly(2036, 1, 2),
                    AdultCount = 1,
                    TotalPrice = reservationAmount,
                    FinalAmount = reservationAmount,
                    Currency = "IRR",
                    CommissionType = CommissionType.Direct,
                    Status = ReservationStatus.ApprovedAwaitingPayment,
                    Source = ReservationSource.Website,
                    PaymentExpiresAtUtc = DateTime.UtcNow.AddHours(1)
                };
                Context.Reservations.Add(reservation);
                await Context.SaveChangesAsync();
            }

            return await Service.CreateAsync(
                new AdminManualPaymentCreateRequest
                {
                    ReservationId = reservation.Id,
                    Amount = amount,
                    Currency = "IRR",
                    Method = ManualPaymentMethod.BankTransfer,
                    PaymentDate = DateOnly.FromDateTime(DateTime.UtcNow),
                    ReferenceNumber = "REF-100",
                    EvidenceFilePath = evidenceFilePath
                },
                AdminUserId);
        }

        public ValueTask DisposeAsync() => Context.DisposeAsync();
    }

    private sealed class StubAvailabilityService(bool hasCapacity) : IEffectiveAvailabilityService
    {
        public Task<IReadOnlyDictionary<int, EffectiveRoomTypeAvailability>> GetRangeAsync(
            IReadOnlyCollection<int> roomTypeIds,
            DateOnly checkInDate,
            DateOnly checkOutDate,
            int? excludedReservationId = null,
            CancellationToken cancellationToken = default)
        {
            IReadOnlyDictionary<int, EffectiveRoomTypeAvailability> result = roomTypeIds.ToDictionary(
                roomTypeId => roomTypeId,
                roomTypeId => new EffectiveRoomTypeAvailability
                {
                    RoomTypeId = roomTypeId,
                    Nights = Enumerable.Range(0, checkOutDate.DayNumber - checkInDate.DayNumber)
                        .ToDictionary(
                            offset => checkInDate.AddDays(offset),
                            offset => new EffectiveAvailabilityNight
                            {
                                Date = checkInDate.AddDays(offset),
                                ConfiguredCapacity = 1,
                                ClaimedCapacity = hasCapacity ? 0 : 1,
                                RemainingCapacity = hasCapacity ? 1 : 0,
                                ConfiguredStatus = AvailabilityStatus.Available,
                                EffectiveStatus = hasCapacity
                                    ? AvailabilityStatus.Available
                                    : AvailabilityStatus.Unavailable,
                                IsClosed = false
                            })
                });
            return Task.FromResult(result);
        }
    }
}
