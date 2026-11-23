using System.Data;
using Kooch.Api.Data;
using Kooch.Api.Dtos.Payments;
using Kooch.Api.Entities;
using Microsoft.EntityFrameworkCore;

namespace Kooch.Api.Services;

public sealed partial class AdminManualPaymentService(
    KoochDbContext dbContext,
    IEffectiveAvailabilityService effectiveAvailabilityService,
    IPaymentFinancializationService paymentFinancializationService,
    IReservationVoucherService reservationVoucherService,
    IPermissionService? permissionService = null,
    IPropertyAuthorizationService? propertyAuthorizationService = null)
    : IAdminManualPaymentService
{
    public AdminManualPaymentService(
        KoochDbContext dbContext,
        IEffectiveAvailabilityService effectiveAvailabilityService,
        IPaymentFinancializationService paymentFinancializationService)
        : this(
            dbContext,
            effectiveAvailabilityService,
            paymentFinancializationService,
            new ReservationVoucherService(dbContext, new VoucherNumberGenerator(dbContext)))
    {
    }

    private const int ReferenceNumberMaxLength = 200;
    private const int DestinationBankMaxLength = 100;
    private const int DestinationAccountReferenceMaxLength = 200;
    private const int NotesMaxLength = 2000;
    private const int EvidenceFilePathMaxLength = 2048;
    private const int RejectionReasonMaxLength = 1000;

    public async Task<IReadOnlyList<AdminManualPaymentDetailsResponse>> GetByReservationAsync(
        int reservationId,
        int actorUserId,
        CancellationToken cancellationToken = default)
    {
        await EnsureReceiptReservationAccessAsync(reservationId, actorUserId, cancellationToken);

        return await dbContext.Payments.AsNoTracking()
            .Where(payment =>
                (payment.ReservationId == reservationId || payment.Items.Any(item => item.ReservationId == reservationId)) &&
                payment.Channel == PaymentChannel.Manual &&
                payment.ManualDetails != null)
            .OrderByDescending(payment => payment.ManualDetails!.SubmittedAtUtc)
            .ThenByDescending(payment => payment.Id)
            .Select(payment => new AdminManualPaymentDetailsResponse
            {
                PaymentId = payment.Id,
                ReservationId = reservationId,
                Amount = payment.ReservationId == reservationId ? payment.Amount :
                    payment.Items.Where(item => item.ReservationId == reservationId).Sum(item => item.AllocatedAmount),
                Currency = payment.Currency,
                Status = payment.Status,
                Method = payment.ManualDetails!.Method,
                VerificationStatus = payment.ManualDetails.VerificationStatus,
                PaymentDate = payment.ManualDetails.PaymentDate,
                PaymentTime = payment.ManualDetails.PaymentTime,
                ReferenceNumber = payment.ManualDetails.ReferenceNumber,
                DestinationBank = payment.ManualDetails.DestinationBank,
                DestinationAccountReference = payment.ManualDetails.DestinationAccountReference,
                Notes = payment.ManualDetails.Notes,
                SubmittedByUserId = payment.ManualDetails.SubmittedByUserId,
                SubmittedBy = payment.ManualDetails.SubmittedByUser == null
                    ? null
                    : (payment.ManualDetails.SubmittedByUser.FirstName + " " +
                       payment.ManualDetails.SubmittedByUser.LastName).Trim(),
                SubmittedAtUtc = payment.ManualDetails.SubmittedAtUtc,
                VerifiedByUserId = payment.ManualDetails.VerifiedByUserId,
                VerifiedBy = payment.ManualDetails.VerifiedByUser == null
                    ? null
                    : (payment.ManualDetails.VerifiedByUser.FirstName + " " +
                       payment.ManualDetails.VerifiedByUser.LastName).Trim(),
                VerifiedAtUtc = payment.ManualDetails.VerifiedAtUtc,
                RejectedByUserId = payment.ManualDetails.RejectedByUserId,
                RejectedBy = payment.ManualDetails.RejectedByUser == null
                    ? null
                    : (payment.ManualDetails.RejectedByUser.FirstName + " " +
                       payment.ManualDetails.RejectedByUser.LastName).Trim(),
                RejectedAtUtc = payment.ManualDetails.RejectedAtUtc,
                RejectionReason = payment.ManualDetails.RejectionReason
            })
            .ToListAsync(cancellationToken);
    }

    public async Task<AdminManualPaymentResponse> CreateAsync(
        AdminManualPaymentCreateRequest request,
        int actorUserId,
        CancellationToken cancellationToken = default)
    {
        var normalized = NormalizeCreateRequest(request);
        await EnsureReceiptReservationAccessAsync(normalized.ReservationId, actorUserId, cancellationToken);
        var target = await ManualPaymentReviewProtection.ReadTargetAsync(dbContext, normalized.ReservationId, cancellationToken);
        await using var transaction = await dbContext.Database.BeginTransactionAsync(
            IsolationLevel.Serializable,
            cancellationToken);

        await ManualPaymentReviewProtection.LockAsync(dbContext, target, cancellationToken);
        var reservation = await LockReservationAsync(normalized.ReservationId, cancellationToken);
        ManualPaymentReviewProtection.EnsureTarget(reservation, target);
        await EnsureReceivedPaymentAccessAsync(actorUserId, reservation.PropertyId, cancellationToken);
        EnsureDirectReservationCanAcceptPayment(reservation, normalized.Currency, DateTime.UtcNow);
        await EnsurePaymentCoversBalanceAsync(
            reservation,
            normalized.Amount,
            excludedPaymentId: null,
            cancellationToken);

        var now = DateTime.UtcNow;
        var payment = new Payment
        {
            ReservationId = reservation.Id,
            Channel = PaymentChannel.Manual,
            Amount = normalized.Amount,
            Currency = normalized.Currency,
            Status = PaymentStatus.Pending,
            CreatedByUserId = actorUserId,
            ManualDetails = new ManualPaymentDetails
            {
                Method = normalized.Method,
                VerificationStatus = ManualPaymentVerificationStatus.PendingVerification,
                PaymentDate = normalized.PaymentDate,
                PaymentTime = normalized.PaymentTime,
                ReferenceNumber = normalized.ReferenceNumber,
                DestinationBank = normalized.DestinationBank,
                DestinationAccountReference = normalized.DestinationAccountReference,
                Notes = normalized.Notes,
                EvidenceFilePath = normalized.EvidenceFilePath,
                SubmittedByUserId = actorUserId,
                SubmittedAtUtc = now,
                CreatedByUserId = actorUserId
            }
        };

        dbContext.Payments.Add(payment);
        await dbContext.SaveChangesAsync(cancellationToken);
        if (reservation.PaymentExpiresAtUtc is not { } deadline || payment.CreatedAtUtc >= deadline)
            throw new ManualPaymentReviewException("مهلت ثبت رسید پرداخت پایان یافته است.", ManualPaymentReviewException.DeadlineExpired);
        await transaction.CommitAsync(cancellationToken);

        return ToResponse(payment, payment.ManualDetails, reservation, capacityClaimed: false);
    }

    public async Task<AdminManualPaymentResponse> ApproveAsync(
        int paymentId,
        int actorUserId,
        CancellationToken cancellationToken = default)
    {
        var reservationId = await ReceiptReservationIdAsync(paymentId, actorUserId, cancellationToken);
        var target = await ManualPaymentReviewProtection.ReadTargetAsync(dbContext, reservationId, cancellationToken);
        await using var transaction = await dbContext.Database.BeginTransactionAsync(
            IsolationLevel.Serializable,
            cancellationToken);

        await ManualPaymentReviewProtection.LockAsync(dbContext, target, cancellationToken);
        var payment = await LockPaymentAsync(paymentId, cancellationToken);
        var details = await LockManualDetailsAsync(paymentId, cancellationToken);
        EnsurePendingVerification(payment, details);

        if (payment.ReservationId != reservationId) throw new InvalidOperationException("Payment reservation changed.");
        var roomTypeId = target.RoomTypeId;
        var reservation = await LockReservationAsync(reservationId, cancellationToken);
        ManualPaymentReviewProtection.EnsureTarget(reservation, target);
        await EnsureReceivedPaymentAccessAsync(actorUserId, reservation.PropertyId, cancellationToken);
        var reviewNow = DateTime.UtcNow;
        EnsureDirectReservationCanAcceptPayment(reservation, payment.Currency, reviewNow,
            ManualPaymentReviewProtection.Protects(reservation, payment, details, reviewNow));
        await EnsurePaymentCoversBalanceAsync(
            reservation,
            payment.Amount,
            payment.Id,
            cancellationToken);

        var effectiveAvailability = await effectiveAvailabilityService.GetRangeAsync(
            [roomTypeId],
            reservation.CheckInDate,
            reservation.CheckOutDate,
            reservation.Id,
            cancellationToken);
        var roomAvailability = effectiveAvailability[roomTypeId];
        var capacityExists = roomAvailability.HasCapacityForFullRange(1) &&
                             (!reservation.RoomId.HasValue ||
                              !roomAvailability.ClaimedRoomIds.Contains(reservation.RoomId.Value));

        var now = DateTime.UtcNow;
        EnsureDirectReservationCanAcceptPayment(reservation, payment.Currency, now,
            ManualPaymentReviewProtection.Protects(reservation, payment, details, now));
        if (capacityExists)
        {
            await paymentFinancializationService.ApplyAsync(
                reservation,
                payment,
                paymentItem: null,
                grossAmount: payment.Amount,
                calculatedAtUtc: now,
                cancellationToken);
        }

        details.VerificationStatus = ManualPaymentVerificationStatus.Approved;
        details.VerifiedByUserId = actorUserId;
        details.VerifiedAtUtc = now;
        details.UpdatedByUserId = actorUserId;
        payment.Status = PaymentStatus.Successful;
        payment.PaidAtUtc = now;
        payment.UpdatedByUserId = actorUserId;
        reservation.PaidAtUtc = now;
        reservation.ChangedAtUtc = now;
        reservation.ChangedByUserId = actorUserId;
        reservation.UpdatedByUserId = actorUserId;

        if (capacityExists)
        {
            reservation.Status = ReservationStatus.Confirmed;
            reservation.ConfirmedAtUtc = now;
            await reservationVoucherService.IssueAsync(
                reservation,
                payment,
                paymentItem: null,
                cancellationToken);
        }
        else
        {
            reservation.Status = ReservationStatus.CapacityLost;
        }

        var activeTokens = await dbContext.ReservationPaymentLinkTokens
            .Where(token => token.ReservationId == reservation.Id && token.UsedAtUtc == null)
            .ToListAsync(cancellationToken);
        foreach (var token in activeTokens)
        {
            token.UsedAtUtc = now;
            token.UpdatedByUserId = actorUserId;
        }

        await dbContext.SaveWithVoucherNumberRetryAsync(cancellationToken);
        await new ReservationActivityService(dbContext)
            .AppendPaymentConfirmedAsync(reservation.Id, actorUserId, cancellationToken);
        await transaction.CommitAsync(cancellationToken);
        return ToResponse(payment, details, reservation, capacityExists);
    }

    public async Task<AdminManualPaymentResponse> RejectAsync(
        int paymentId,
        AdminManualPaymentRejectRequest request,
        int actorUserId,
        CancellationToken cancellationToken = default)
    {
        var reason = NormalizeRequired(request.Reason, RejectionReasonMaxLength, "Rejection reason");
        var reservationId = await ReceiptReservationIdAsync(paymentId, actorUserId, cancellationToken);
        var target = await ManualPaymentReviewProtection.ReadTargetAsync(dbContext, reservationId, cancellationToken);
        await using var transaction = await dbContext.Database.BeginTransactionAsync(
            IsolationLevel.Serializable,
            cancellationToken);

        await ManualPaymentReviewProtection.LockAsync(dbContext, target, cancellationToken);
        var payment = await LockPaymentAsync(paymentId, cancellationToken);
        var details = await LockManualDetailsAsync(paymentId, cancellationToken);
        EnsurePendingVerification(payment, details);
        if (payment.ReservationId != reservationId) throw new InvalidOperationException("Payment reservation changed.");
        var reservation = await LockReservationAsync(reservationId, cancellationToken);
        ManualPaymentReviewProtection.EnsureTarget(reservation, target);
        await EnsureReceivedPaymentAccessAsync(actorUserId, reservation.PropertyId, cancellationToken);

        var now = DateTime.UtcNow;
        details.VerificationStatus = ManualPaymentVerificationStatus.Rejected;
        details.RejectedByUserId = actorUserId;
        details.RejectedAtUtc = now;
        details.RejectionReason = reason;
        details.UpdatedByUserId = actorUserId;
        payment.Status = PaymentStatus.Failed;
        payment.FailedAtUtc = now;
        payment.UpdatedByUserId = actorUserId;

        await dbContext.SaveChangesAsync(cancellationToken);
        await transaction.CommitAsync(cancellationToken);
        return ToResponse(payment, details, reservation, capacityClaimed: false);
    }

    private async Task EnsureReceiptReservationAccessAsync(int id, int actorUserId, CancellationToken ct)
    {
        var propertyId = await dbContext.Reservations.AsNoTracking().Where(row => row.Id == id)
            .Select(row => (int?)row.PropertyId).SingleOrDefaultAsync(ct)
            ?? throw new KeyNotFoundException("Reservation not found.");
        await EnsureReceivedPaymentAccessAsync(actorUserId, propertyId, ct);
    }

    private async Task<int> ReceiptReservationIdAsync(int paymentId, int actorUserId, CancellationToken ct)
    {
        var id = await dbContext.Payments.AsNoTracking().Where(row => row.Id == paymentId)
            .Select(row => row.ReservationId).SingleOrDefaultAsync(ct)
            ?? throw new KeyNotFoundException("Direct manual payment not found.");
        await EnsureReceiptReservationAccessAsync(id, actorUserId, ct);
        return id;
    }

    private async Task<Reservation> LockReservationAsync(
        int reservationId,
        CancellationToken cancellationToken)
    {
        var query = dbContext.Database.IsSqlServer()
            ? dbContext.Reservations.FromSqlInterpolated(
                $"SELECT * FROM Reservations WITH (UPDLOCK, HOLDLOCK) WHERE Id = {reservationId}")
            : dbContext.Reservations.Where(reservation => reservation.Id == reservationId);
        var reservation = await query.SingleOrDefaultAsync(cancellationToken)
               ?? throw new KeyNotFoundException("Reservation not found.");
        await dbContext.Entry(reservation).ReloadAsync(cancellationToken);
        return reservation;
    }

    private async Task<Payment> LockPaymentAsync(int paymentId, CancellationToken cancellationToken)
    {
        var query = dbContext.Database.IsSqlServer()
            ? dbContext.Payments.FromSqlInterpolated(
                $"SELECT * FROM Payments WITH (UPDLOCK, HOLDLOCK) WHERE Id = {paymentId}")
            : dbContext.Payments.Where(payment => payment.Id == paymentId);
        var payment = await query.SingleOrDefaultAsync(cancellationToken)
               ?? throw new KeyNotFoundException("Payment not found.");
        await dbContext.Entry(payment).ReloadAsync(cancellationToken);
        return payment;
    }

    private async Task<ManualPaymentDetails> LockManualDetailsAsync(
        int paymentId,
        CancellationToken cancellationToken)
    {
        var query = dbContext.Database.IsSqlServer()
            ? dbContext.ManualPaymentDetails.FromSqlInterpolated(
                $"SELECT * FROM ManualPaymentDetails WITH (UPDLOCK, HOLDLOCK) WHERE PaymentId = {paymentId}")
            : dbContext.ManualPaymentDetails.Where(details => details.PaymentId == paymentId);
        var details = await query.SingleOrDefaultAsync(cancellationToken)
               ?? throw new InvalidOperationException("Manual payment details are missing.");
        await dbContext.Entry(details).ReloadAsync(cancellationToken);
        return details;
    }

    private async Task LockRoomTypeAsync(int roomTypeId, CancellationToken cancellationToken)
    {
        var query = dbContext.Database.IsSqlServer()
            ? dbContext.RoomTypes.FromSqlInterpolated(
                $"SELECT * FROM RoomTypes WITH (UPDLOCK, HOLDLOCK) WHERE Id = {roomTypeId}")
            : dbContext.RoomTypes.Where(roomType => roomType.Id == roomTypeId);
        _ = await query.AsNoTracking().SingleAsync(cancellationToken);
    }

    private async Task EnsurePaymentCoversBalanceAsync(
        Reservation reservation,
        decimal amount,
        int? excludedPaymentId,
        CancellationToken cancellationToken)
    {
        var previouslyPaidAmount = await dbContext.Payments.AsNoTracking()
            .Where(payment =>
                payment.ReservationId == reservation.Id &&
                payment.Status == PaymentStatus.Successful &&
                (!excludedPaymentId.HasValue || payment.Id != excludedPaymentId.Value))
            .SumAsync(payment => (decimal?)payment.Amount, cancellationToken) ?? 0;
        if (previouslyPaidAmount >= reservation.FinalAmount)
        {
            throw new InvalidOperationException("Reservation already has sufficient successful payment.");
        }

        if (previouslyPaidAmount + amount < reservation.FinalAmount)
        {
            throw new InvalidOperationException("Manual payment does not cover the reservation balance.");
        }
    }

    private static void EnsureDirectReservationCanAcceptPayment(
        Reservation reservation,
        string currency,
        DateTime now, bool protectedReview = false)
    {
        var blocker = GetDirectReservationPaymentBlocker(reservation, currency, now);
        if (blocker == DirectReservationPaymentBlocker.ExpiredDeadline && protectedReview)
        {
            if (!string.Equals(reservation.Currency.Trim(), currency, StringComparison.OrdinalIgnoreCase))
                throw new InvalidOperationException("Payment currency does not match the reservation.");
            return;
        }
        if (blocker is DirectReservationPaymentBlocker.MissingDeadline or DirectReservationPaymentBlocker.ExpiredDeadline ||
            blocker == DirectReservationPaymentBlocker.StatusNotPayable && reservation.Status == ReservationStatus.PaymentExpired)
            throw new ManualPaymentReviewException("مهلت پرداخت یا حفاظت بررسی رسید پایان یافته است؛ رسید برای پیگیری مالی باقی می‌ماند.", ManualPaymentReviewException.DeadlineExpired);
        if (blocker is not null)
            throw new InvalidOperationException(blocker switch
            {
                DirectReservationPaymentBlocker.SessionPaymentRequired => "Booking session reservations must use the session payment flow.",
                DirectReservationPaymentBlocker.StatusNotPayable => "Reservation is not awaiting payment confirmation.",
                DirectReservationPaymentBlocker.MissingDeadline or DirectReservationPaymentBlocker.ExpiredDeadline => "Reservation payment window has expired.",
                _ => "Payment currency does not match the reservation."
            });
    }

    private enum DirectReservationPaymentBlocker { SessionPaymentRequired, StatusNotPayable, MissingDeadline, ExpiredDeadline, CurrencyMismatch }

    private static DirectReservationPaymentBlocker? GetDirectReservationPaymentBlocker(
        Reservation reservation, string currency, DateTime now)
    {
        if (ReservationPaymentFlow.RequiresSessionPayment(reservation))
            return DirectReservationPaymentBlocker.SessionPaymentRequired;
        if (reservation.Status != ReservationStatus.ApprovedAwaitingPayment)
            return DirectReservationPaymentBlocker.StatusNotPayable;
        if (reservation.PaymentExpiresAtUtc is null)
            return DirectReservationPaymentBlocker.MissingDeadline;
        if (reservation.PaymentExpiresAtUtc <= now)
            return DirectReservationPaymentBlocker.ExpiredDeadline;
        if (!string.Equals(reservation.Currency.Trim(), currency, StringComparison.OrdinalIgnoreCase))
            return DirectReservationPaymentBlocker.CurrencyMismatch;
        return null;
    }

    private static void EnsurePendingVerification(Payment payment, ManualPaymentDetails details)
    {
        if (payment.Channel != PaymentChannel.Manual ||
            payment.BookingSessionId.HasValue ||
            !payment.ReservationId.HasValue)
        {
            throw new InvalidOperationException("Payment is not an eligible direct manual payment.");
        }

        if (payment.Status != PaymentStatus.Pending ||
            details.VerificationStatus != ManualPaymentVerificationStatus.PendingVerification)
        {
            throw new ManualPaymentReviewException("این رسید قبلاً بررسی شده است.", ManualPaymentReviewException.AlreadyReviewed);
        }

        if (payment.Amount <= 0 || !Enum.IsDefined(details.Method))
        {
            throw new InvalidOperationException("Manual payment details are invalid.");
        }
    }

    private static NormalizedCreateRequest NormalizeCreateRequest(AdminManualPaymentCreateRequest request)
    {
        if (request.ReservationId <= 0)
        {
            throw new ArgumentException("Reservation id is required.");
        }

        if (request.Amount <= 0)
        {
            throw new ArgumentException("Manual payment amount must be positive.");
        }

        var currency = request.Currency?.Trim().ToUpperInvariant() ?? string.Empty;
        if (currency.Length != 3)
        {
            throw new ArgumentException("Payment currency must contain exactly three characters.");
        }

        if (!Enum.IsDefined(request.Method))
        {
            throw new ArgumentException("Manual payment method is invalid.");
        }

        if (request.PaymentDate == default)
        {
            throw new ArgumentException("Payment date is required.");
        }

        return new NormalizedCreateRequest(
            request.ReservationId,
            request.Amount,
            currency,
            request.Method,
            request.PaymentDate,
            request.PaymentTime,
            NormalizeOptional(request.ReferenceNumber, ReferenceNumberMaxLength, "Reference number"),
            NormalizeOptional(request.DestinationBank, DestinationBankMaxLength, "Destination bank"),
            NormalizeOptional(
                request.DestinationAccountReference,
                DestinationAccountReferenceMaxLength,
                "Destination account reference"),
            NormalizeOptional(request.Notes, NotesMaxLength, "Notes"),
            NormalizeOptional(request.EvidenceFilePath, EvidenceFilePathMaxLength, "Evidence file path"));
    }

    private static string NormalizeRequired(string? value, int maxLength, string fieldName)
    {
        var normalized = value?.Trim() ?? string.Empty;
        if (normalized.Length == 0)
        {
            throw new ArgumentException($"{fieldName} is required.");
        }

        if (normalized.Length > maxLength)
        {
            throw new ArgumentException($"{fieldName} cannot exceed {maxLength} characters.");
        }

        return normalized;
    }

    private static string? NormalizeOptional(string? value, int maxLength, string fieldName)
    {
        var normalized = value?.Trim();
        if (string.IsNullOrEmpty(normalized))
        {
            return null;
        }

        if (normalized.Length > maxLength)
        {
            throw new ArgumentException($"{fieldName} cannot exceed {maxLength} characters.");
        }

        return normalized;
    }

    private static AdminManualPaymentResponse ToResponse(
        Payment payment,
        ManualPaymentDetails details,
        Reservation reservation,
        bool capacityClaimed) => new()
    {
        PaymentId = payment.Id,
        ReservationId = reservation.Id,
        Amount = payment.Amount,
        Currency = payment.Currency,
        Channel = payment.Channel,
        Status = payment.Status,
        Method = details.Method,
        VerificationStatus = details.VerificationStatus,
        PaymentDate = details.PaymentDate,
        PaymentTime = details.PaymentTime,
        ReferenceNumber = details.ReferenceNumber,
        DestinationBank = details.DestinationBank,
        DestinationAccountReference = details.DestinationAccountReference,
        Notes = details.Notes,
        EvidenceFilePath = details.EvidenceFilePath,
        SubmittedByUserId = details.SubmittedByUserId,
        SubmittedAtUtc = details.SubmittedAtUtc,
        VerifiedByUserId = details.VerifiedByUserId,
        VerifiedAtUtc = details.VerifiedAtUtc,
        RejectedByUserId = details.RejectedByUserId,
        RejectedAtUtc = details.RejectedAtUtc,
        RejectionReason = details.RejectionReason,
        ReservationStatus = ReservationStatusNormalizer.Normalize(reservation.Status),
        CapacityClaimed = capacityClaimed
    };

    private sealed record NormalizedCreateRequest(
        int ReservationId,
        decimal Amount,
        string Currency,
        ManualPaymentMethod Method,
        DateOnly PaymentDate,
        TimeOnly? PaymentTime,
        string? ReferenceNumber,
        string? DestinationBank,
        string? DestinationAccountReference,
        string? Notes,
        string? EvidenceFilePath);
}
