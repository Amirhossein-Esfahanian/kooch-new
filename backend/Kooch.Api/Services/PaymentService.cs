using System.Collections.Concurrent;
using System.Data;
using System.Globalization;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Kooch.Api.Data;
using Kooch.Api.Dtos.Payments;
using Kooch.Api.Entities;
using Microsoft.EntityFrameworkCore;

namespace Kooch.Api.Services;

public class PaymentService(
    KoochDbContext dbContext,
    IEffectiveAvailabilityService effectiveAvailabilityService) : IPaymentService
{
    private const int MaximumIdempotencyKeyLength = 200;
    private const int MaximumProviderLength = 100;
    private static readonly ConcurrentDictionary<int, SemaphoreSlim> LocalSessionLocks = new();

    public async Task<BookingSessionPaymentInitiationResult> InitiateBookingSessionPaymentAsync(
        BookingSessionPaymentInitiationRequest request,
        CancellationToken cancellationToken = default)
    {
        var normalizedRequest = NormalizeInitiationRequest(request);
        var localSessionLock = LocalSessionLocks.GetOrAdd(
            normalizedRequest.BookingSessionId,
            static _ => new SemaphoreSlim(1, 1));
        await localSessionLock.WaitAsync(cancellationToken);

        try
        {
            return await InitiateUnderLockAsync(normalizedRequest, cancellationToken);
        }
        finally
        {
            localSessionLock.Release();
        }
    }

    private async Task<BookingSessionPaymentInitiationResult> InitiateUnderLockAsync(
        NormalizedPaymentInitiationRequest request,
        CancellationToken cancellationToken)
    {
        await using var transaction = await dbContext.Database.BeginTransactionAsync(
            IsolationLevel.Serializable,
            cancellationToken);
        var result = await CreateOrReplayPendingPaymentAsync(request, cancellationToken);
        await transaction.CommitAsync(cancellationToken);
        return result;
    }

    private async Task<BookingSessionPaymentInitiationResult> CreateOrReplayPendingPaymentAsync(
        NormalizedPaymentInitiationRequest request,
        CancellationToken cancellationToken)
    {
        var session = await LockBookingSessionAsync(request.BookingSessionId, cancellationToken);
        var reservations = await LockSessionReservationsAsync(session.Id, cancellationToken);
        var candidate = BuildInitiationCandidate(
            session,
            reservations,
            request.Provider,
            DateTime.UtcNow);
        return await PersistOrReplayAsync(session.Id, candidate, cancellationToken);
    }

    private async Task<BookingSessionPaymentInitiationResult> PersistOrReplayAsync(
        int bookingSessionId,
        PaymentInitiationCandidate candidate,
        CancellationToken cancellationToken)
    {
        var existingPayment = await GetExistingPendingPaymentAsync(
            bookingSessionId,
            cancellationToken);
        if (existingPayment is not null)
        {
            return ValidateAndMapReplay(existingPayment, candidate);
        }

        var payment = CreatePendingPayment(bookingSessionId, candidate);
        dbContext.Payments.Add(payment);
        await dbContext.SaveChangesAsync(cancellationToken);
        return ToInitiationResult(payment, candidate, isReplay: false);
    }

    public async Task<PaymentConfirmationResponse> ConfirmSuccessfulPaymentAsync(
        int reservationId,
        PaymentConfirmationRequest request,
        CancellationToken cancellationToken = default)
    {
        if (request.Amount <= 0 ||
            string.IsNullOrWhiteSpace(request.TransactionReference) ||
            string.IsNullOrWhiteSpace(request.Currency) ||
            request.Currency.Trim().Length != 3)
        {
            throw new ArgumentException("A positive payment amount and transaction reference are required.");
        }

        await using var transaction = await dbContext.Database.BeginTransactionAsync(
            IsolationLevel.Serializable,
            cancellationToken);

        var roomTypeId = await dbContext.Reservations.AsNoTracking()
            .Where(reservation => reservation.Id == reservationId)
            .Select(reservation => (int?)reservation.RoomTypeId)
            .SingleOrDefaultAsync(cancellationToken)
            ?? throw new KeyNotFoundException("Reservation not found.");

        var roomType = await dbContext.RoomTypes
            .FromSqlInterpolated($"SELECT * FROM RoomTypes WITH (UPDLOCK, HOLDLOCK) WHERE Id = {roomTypeId}")
            .AsNoTracking()
            .SingleAsync(cancellationToken);

        var reservation = await dbContext.Reservations
            .SingleAsync(item => item.Id == reservationId, cancellationToken);
        var normalizedReference = request.TransactionReference.Trim();
        var existingPayment = await dbContext.Payments.AsNoTracking()
            .SingleOrDefaultAsync(payment =>
                    payment.TransactionReference == normalizedReference &&
                    payment.Status == PaymentStatus.Successful,
                cancellationToken);
        if (existingPayment is not null)
        {
            if (existingPayment.ReservationId != reservation.Id)
            {
                throw new InvalidOperationException("Transaction reference is already assigned to another reservation.");
            }

            await transaction.CommitAsync(cancellationToken);
            return new PaymentConfirmationResponse
            {
                ReservationId = reservation.Id,
                ReservationStatus = ReservationStatusNormalizer.Normalize(reservation.Status),
                CapacityClaimed = reservation.Status is ReservationStatus.Confirmed or ReservationStatus.Paid
            };
        }

        var now = DateTime.UtcNow;
        if (reservation.Status != ReservationStatus.ApprovedAwaitingPayment)
        {
            throw new InvalidOperationException("Reservation is not awaiting payment confirmation.");
        }

        if (reservation.PaymentExpiresAtUtc is null || reservation.PaymentExpiresAtUtc <= now)
        {
            throw new InvalidOperationException("Reservation payment window has expired.");
        }

        var previouslyPaidAmount = await dbContext.Payments.AsNoTracking()
            .Where(payment =>
                payment.ReservationId == reservation.Id &&
                payment.Status == PaymentStatus.Successful)
            .SumAsync(payment => (decimal?)payment.Amount, cancellationToken) ?? 0;
        if (previouslyPaidAmount + request.Amount < reservation.FinalAmount)
        {
            throw new InvalidOperationException("Successful payment does not cover the reservation balance.");
        }

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

        dbContext.Payments.Add(new Payment
        {
            ReservationId = reservation.Id,
            Amount = request.Amount,
            Currency = request.Currency.Trim(),
            Provider = request.Provider?.Trim(),
            TransactionReference = normalizedReference,
            Status = PaymentStatus.Successful,
            PaidAtUtc = now
        });

        reservation.PaidAtUtc = now;
        reservation.ChangedAtUtc = now;
        if (capacityExists)
        {
            reservation.Status = ReservationStatus.Confirmed;
            reservation.ConfirmedAtUtc = now;
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
        }

        await dbContext.SaveChangesAsync(cancellationToken);
        await transaction.CommitAsync(cancellationToken);

        return new PaymentConfirmationResponse
        {
            ReservationId = reservation.Id,
            ReservationStatus = ReservationStatusNormalizer.Normalize(reservation.Status),
            CapacityClaimed = capacityExists
        };
    }

    public async Task<ReservationPaymentPreparationResponse> GetReservationPaymentPreparationAsync(
        string reservationNumber,
        string? rawToken,
        CancellationToken cancellationToken = default)
    {
        var normalizedReservationNumber = reservationNumber.Trim();
        if (string.IsNullOrWhiteSpace(normalizedReservationNumber) ||
            string.IsNullOrWhiteSpace(rawToken))
        {
            return Invalid(normalizedReservationNumber, "لینک پرداخت معتبر نیست.");
        }

        var tokenHash = HashToken(rawToken);
        var now = DateTime.UtcNow;
        var token = await dbContext.ReservationPaymentLinkTokens
            .AsNoTracking()
            .Include(item => item.Reservation)
                .ThenInclude(item => item.Property)
            .Include(item => item.Reservation)
                .ThenInclude(item => item.RoomType)
            .Include(item => item.Reservation)
                .ThenInclude(item => item.Payments)
            .SingleOrDefaultAsync(item => item.TokenHash == tokenHash, cancellationToken);

        if (token is null ||
            token.Reservation.ReservationNumber != normalizedReservationNumber)
        {
            return Invalid(normalizedReservationNumber, "لینک پرداخت معتبر نیست.");
        }

        var reservation = token.Reservation;
        var paidAmount = GetPaidAmount(reservation);
        var remainingAmount = Math.Max(0, reservation.FinalAmount - paidAmount);
        var response = CreateResponse(reservation, paidAmount, remainingAmount, now);

        if (token.UsedAtUtc.HasValue)
        {
            return MarkInvalid(response, "این لینک پرداخت دیگر فعال نیست.");
        }

        if (token.ExpiresAtUtc <= now ||
            reservation.PaymentExpiresAtUtc is null ||
            reservation.PaymentExpiresAtUtc.Value <= now)
        {
            return MarkInvalid(response, "مهلت پرداخت این رزرو تمام شده است.");
        }

        if (token.ExpiresAtUtc != reservation.PaymentExpiresAtUtc.Value)
        {
            return MarkInvalid(response, "این لینک پرداخت با مهلت فعلی رزرو هماهنگ نیست.");
        }

        if (reservation.Status != ReservationStatus.ApprovedAwaitingPayment)
        {
            return MarkInvalid(response, "این رزرو در وضعیت قابل پرداخت نیست.");
        }

        if (reservation.PaidAtUtc.HasValue ||
            reservation.Status == ReservationStatus.Paid ||
            remainingAmount <= 0)
        {
            return MarkInvalid(response, "این رزرو قبلا پرداخت شده است.");
        }

        response.IsValid = true;
        response.PlaceholderMessage = "درگاه پرداخت هنوز متصل نشده است. ادامه پرداخت فعلا فقط مرحله آماده‌سازی را نمایش می‌دهد.";
        return response;
    }

    public async Task<ReservationPaymentPlaceholderResponse> ContinueReservationPaymentAsync(
        string reservationNumber,
        string? rawToken,
        CancellationToken cancellationToken = default)
    {
        var preparation = await GetReservationPaymentPreparationAsync(
            reservationNumber,
            rawToken,
            cancellationToken);

        if (!preparation.IsValid)
        {
            return new ReservationPaymentPlaceholderResponse
            {
                IsValid = false,
                Message = preparation.InvalidReason ?? "لینک پرداخت معتبر نیست."
            };
        }

        return new ReservationPaymentPlaceholderResponse
        {
            IsValid = true,
            Message = "درگاه پرداخت هنوز فعال نشده است. رزرو پرداخت‌شده علامت نخورد.",
            PlaceholderReference = $"PAYMENT-PLACEHOLDER-{preparation.ReservationNumber}"
        };
    }

    private static ReservationPaymentPreparationResponse Invalid(
        string reservationNumber,
        string reason) =>
        new()
        {
            IsValid = false,
            ReservationNumber = reservationNumber,
            InvalidReason = reason,
            PlaceholderMessage = reason
        };

    private static ReservationPaymentPreparationResponse MarkInvalid(
        ReservationPaymentPreparationResponse response,
        string reason)
    {
        response.IsValid = false;
        response.InvalidReason = reason;
        response.PlaceholderMessage = reason;
        return response;
    }

    private static ReservationPaymentPreparationResponse CreateResponse(
        Reservation reservation,
        decimal paidAmount,
        decimal remainingAmount,
        DateTime now)
    {
        return new ReservationPaymentPreparationResponse
        {
            IsValid = false,
            ReservationId = reservation.Id,
            ReservationNumber = reservation.ReservationNumber ?? string.Empty,
            PropertyName = reservation.Property.Name,
            RoomTypeName = reservation.RoomType.Name,
            CheckInDate = reservation.CheckInDate,
            CheckOutDate = reservation.CheckOutDate,
            NightsCount = reservation.CheckOutDate.DayNumber - reservation.CheckInDate.DayNumber,
            Status = ReservationStatusNormalizer.Normalize(reservation.Status),
            TotalPrice = reservation.FinalAmount,
            PaidAmount = paidAmount,
            RemainingAmount = remainingAmount,
            Currency = reservation.Currency,
            PaymentExpiresAtUtc = reservation.PaymentExpiresAtUtc,
            RemainingPaymentSeconds = GetRemainingPaymentSeconds(
                reservation.Status,
                reservation.PaymentExpiresAtUtc,
                now)
        };
    }

    private static decimal GetPaidAmount(Reservation reservation) =>
        reservation.Payments
            .Where(payment => payment.Status == PaymentStatus.Successful)
            .Sum(payment => payment.Amount);

    private static int? GetRemainingPaymentSeconds(
        ReservationStatus status,
        DateTime? paymentExpiresAtUtc,
        DateTime now)
    {
        if (status != ReservationStatus.ApprovedAwaitingPayment ||
            !paymentExpiresAtUtc.HasValue)
        {
            return null;
        }

        var remainingSeconds = (int)Math.Ceiling((paymentExpiresAtUtc.Value - now).TotalSeconds);
        return Math.Max(0, remainingSeconds);
    }

    private Task<Payment?> GetExistingPendingPaymentAsync(
        int bookingSessionId,
        CancellationToken cancellationToken) =>
        dbContext.Payments
            .Include(payment => payment.Items)
            .SingleOrDefaultAsync(payment =>
                payment.BookingSessionId == bookingSessionId &&
                payment.Status == PaymentStatus.Pending,
                cancellationToken);

    private static BookingSessionPaymentInitiationResult ValidateAndMapReplay(
        Payment payment,
        PaymentInitiationCandidate candidate)
    {
        EnsureCandidateMatches(payment, candidate);
        return ToInitiationResult(payment, candidate, isReplay: true);
    }

    private async Task<BookingSession> LockBookingSessionAsync(int id, CancellationToken token) =>
        await GetBookingSessionLockQuery(id).SingleOrDefaultAsync(token)
        ?? throw new KeyNotFoundException("Booking session not found.");

    private IQueryable<BookingSession> GetBookingSessionLockQuery(int id) =>
        dbContext.Database.IsSqlServer()
            ? dbContext.BookingSessions.FromSqlInterpolated(
                $"SELECT * FROM BookingSessions WITH (UPDLOCK, HOLDLOCK) WHERE Id = {id}")
            : dbContext.BookingSessions.Where(session => session.Id == id);

    private async Task<IReadOnlyList<Reservation>> LockSessionReservationsAsync(
        int bookingSessionId,
        CancellationToken cancellationToken)
    {
        var ids = await dbContext.Reservations.AsNoTracking()
            .Where(reservation => reservation.BookingSessionId == bookingSessionId)
            .OrderBy(reservation => reservation.Id)
            .Select(reservation => reservation.Id)
            .ToListAsync(cancellationToken);
        var reservations = new List<Reservation>(ids.Count);
        foreach (var id in ids)
        {
            reservations.Add(await LockReservationAsync(id, cancellationToken));
        }

        return reservations;
    }

    private async Task<Reservation> LockReservationAsync(int id, CancellationToken token) =>
        await GetReservationLockQuery(id).SingleAsync(token);

    private IQueryable<Reservation> GetReservationLockQuery(int id) =>
        dbContext.Database.IsSqlServer()
            ? dbContext.Reservations.FromSqlInterpolated(
                $"SELECT * FROM Reservations WITH (UPDLOCK, HOLDLOCK) WHERE Id = {id}")
            : dbContext.Reservations.Where(reservation => reservation.Id == id);

    private static PaymentInitiationCandidate BuildInitiationCandidate(
        BookingSession session,
        IReadOnlyList<Reservation> reservations,
        string provider,
        DateTime now)
    {
        var deadline = ValidatePaymentReadiness(reservations, now);
        var currency = NormalizeCurrency(session.Currency);
        var allocations = BuildAllocations(reservations, currency);
        var amount = allocations.Sum(item => item.AllocatedAmount);
        var requestHash = ComputeInitiationRequestHash(
            session.Id,
            provider,
            deadline,
            allocations);
        return new PaymentInitiationCandidate(
            provider,
            currency,
            amount,
            deadline,
            requestHash,
            allocations);
    }

    private static DateTime ValidatePaymentReadiness(
        IReadOnlyList<Reservation> reservations,
        DateTime now)
    {
        ValidatePaymentStatuses(reservations);
        if (reservations.Any(reservation => !reservation.PaymentExpiresAtUtc.HasValue))
        {
            throw new InvalidOperationException("Every reservation must have a payment deadline.");
        }

        var deadlines = reservations
            .Select(reservation => reservation.PaymentExpiresAtUtc!.Value)
            .Distinct()
            .Order()
            .ToArray();
        if (deadlines.Length != 1)
        {
            throw new InvalidOperationException("Reservation payment deadlines are inconsistent.");
        }

        if (deadlines[0] <= now)
        {
            throw new InvalidOperationException("The booking session payment deadline has expired.");
        }

        return deadlines[0];
    }

    private static void ValidatePaymentStatuses(IReadOnlyList<Reservation> reservations)
    {
        if (reservations.Count == 0)
        {
            throw new InvalidOperationException("The booking session has no reservations.");
        }

        if (reservations.Any(x => x.Status == ReservationStatus.PendingApproval))
        {
            throw new InvalidOperationException("The booking session still has pending approvals.");
        }

        if (reservations.Any(x => x.Status == ReservationStatus.Rejected))
        {
            throw new InvalidOperationException("A rejected reservation prevents payment initiation.");
        }

        if (reservations.Any(x => x.Status != ReservationStatus.ApprovedAwaitingPayment))
        {
            throw new InvalidOperationException("The booking session is not ready for payment.");
        }
    }

    private static IReadOnlyList<PaymentInitiationAllocation> BuildAllocations(
        IReadOnlyList<Reservation> reservations,
        string currency) =>
        reservations.OrderBy(reservation => reservation.Id)
            .Select(reservation => CreateAllocation(reservation, currency))
            .ToArray();

    private static PaymentInitiationAllocation CreateAllocation(
        Reservation reservation,
        string currency)
    {
        if (!string.Equals(NormalizeCurrency(reservation.Currency), currency, StringComparison.Ordinal))
        {
            throw new InvalidOperationException(
                "All payment allocations must use the booking session currency.");
        }

        if (reservation.FinalAmount <= 0)
        {
            throw new InvalidOperationException("Every payment allocation must have a positive amount.");
        }

        return new PaymentInitiationAllocation(reservation.Id, reservation.FinalAmount, currency);
    }

    private static Payment CreatePendingPayment(
        int bookingSessionId,
        PaymentInitiationCandidate candidate) =>
        new()
        {
            BookingSessionId = bookingSessionId,
            Amount = candidate.Amount,
            Currency = candidate.Currency,
            Provider = candidate.Provider,
            Status = PaymentStatus.Pending,
            Items = candidate.Items.Select(item => new PaymentItem
            {
                ReservationId = item.ReservationId,
                AllocatedAmount = item.AllocatedAmount,
                Currency = item.Currency
            }).ToList()
        };

    private static void EnsureCandidateMatches(
        Payment payment,
        PaymentInitiationCandidate candidate)
    {
        if (!MatchesCandidate(payment, candidate))
        {
            throw new InvalidOperationException(
                "The idempotency key has already been used with a different payment payload.");
        }
    }

    private static bool MatchesCandidate(Payment payment, PaymentInitiationCandidate candidate)
    {
        if (payment.ReservationId is not null || payment.Amount != candidate.Amount ||
            payment.Currency != candidate.Currency || payment.Provider != candidate.Provider ||
            payment.TransactionReference is not null || payment.Items.Count != candidate.Items.Count)
        {
            return false;
        }

        var current = payment.Items.OrderBy(item => item.ReservationId).ToArray();
        var expected = candidate.Items.OrderBy(item => item.ReservationId).ToArray();
        return current.Zip(expected).All(pair =>
            pair.First.ReservationId == pair.Second.ReservationId &&
            pair.First.AllocatedAmount == pair.Second.AllocatedAmount &&
            pair.First.Currency == pair.Second.Currency);
    }

    private static BookingSessionPaymentInitiationResult ToInitiationResult(
        Payment payment,
        PaymentInitiationCandidate candidate,
        bool isReplay) =>
        new()
        {
            PaymentId = payment.Id,
            BookingSessionId = payment.BookingSessionId!.Value,
            Amount = payment.Amount,
            Currency = payment.Currency,
            Status = payment.Status,
            Provider = payment.Provider ?? string.Empty,
            TransactionReference = payment.TransactionReference,
            PaymentDeadlineUtc = candidate.PaymentDeadlineUtc,
            RequestHash = candidate.RequestHash,
            IsReplay = isReplay,
            Items = payment.Items.OrderBy(item => item.ReservationId)
                .Select(ToInitiationItemResult)
                .ToArray()
        };

    private static BookingSessionPaymentItemResult ToInitiationItemResult(PaymentItem item) =>
        new()
        {
            PaymentItemId = item.Id,
            ReservationId = item.ReservationId,
            AllocatedAmount = item.AllocatedAmount,
            Currency = item.Currency
        };

    private static NormalizedPaymentInitiationRequest NormalizeInitiationRequest(
        BookingSessionPaymentInitiationRequest request)
    {
        ArgumentNullException.ThrowIfNull(request);
        if (request.BookingSessionId <= 0)
        {
            throw new ArgumentOutOfRangeException(nameof(request.BookingSessionId));
        }

        var provider = request.Provider?.Trim();
        if (string.IsNullOrEmpty(provider) || provider.Length > MaximumProviderLength)
        {
            throw new ArgumentException("A valid payment provider is required.", nameof(request));
        }

        var key = request.IdempotencyKey?.Trim();
        if (string.IsNullOrEmpty(key) || key.Length > MaximumIdempotencyKeyLength)
        {
            throw new ArgumentException("A valid idempotency key is required.", nameof(request));
        }

        return new NormalizedPaymentInitiationRequest(request.BookingSessionId, provider, key);
    }

    private static string NormalizeCurrency(string currency)
    {
        var normalized = currency?.Trim().ToUpperInvariant();
        if (string.IsNullOrEmpty(normalized) || normalized.Length != 3)
        {
            throw new InvalidOperationException("Payment currency must contain exactly three characters.");
        }

        return normalized;
    }

    internal static string ComputeInitiationRequestHash(
        int bookingSessionId,
        string provider,
        DateTime paymentDeadlineUtc,
        IReadOnlyList<PaymentInitiationAllocation> items)
    {
        var canonical = new CanonicalPaymentInitiation(
            bookingSessionId,
            provider,
            paymentDeadlineUtc.ToUniversalTime().ToString("O", CultureInfo.InvariantCulture),
            items.OrderBy(item => item.ReservationId)
                .Select(item => new CanonicalPaymentItem(
                    item.ReservationId,
                    item.AllocatedAmount.ToString("0.00", CultureInfo.InvariantCulture),
                    item.Currency))
                .ToArray());
        var payload = JsonSerializer.SerializeToUtf8Bytes(canonical);
        return Convert.ToHexString(SHA256.HashData(payload));
    }

    private static string HashToken(string rawToken)
    {
        var bytes = SHA256.HashData(Encoding.UTF8.GetBytes(rawToken.Trim()));
        return Convert.ToHexString(bytes);
    }

    internal sealed record PaymentInitiationAllocation(
        int ReservationId,
        decimal AllocatedAmount,
        string Currency);

    private sealed record NormalizedPaymentInitiationRequest(
        int BookingSessionId,
        string Provider,
        string IdempotencyKey);

    private sealed record PaymentInitiationCandidate(
        string Provider,
        string Currency,
        decimal Amount,
        DateTime PaymentDeadlineUtc,
        string RequestHash,
        IReadOnlyList<PaymentInitiationAllocation> Items);

    private sealed record CanonicalPaymentInitiation(
        int BookingSessionId,
        string Provider,
        string PaymentDeadlineUtc,
        IReadOnlyList<CanonicalPaymentItem> Items);

    private sealed record CanonicalPaymentItem(
        int ReservationId,
        string AllocatedAmount,
        string Currency);
}
