using System.Linq.Expressions;
using Kooch.Api.Data;
using Kooch.Api.Dtos.BookingSessions;
using Kooch.Api.Entities;
using Kooch.Api.Dtos.Reservations;
using Microsoft.EntityFrameworkCore;

namespace Kooch.Api.Services;

public sealed class BookingSessionQueryService : IBookingSessionQueryService
{
    private readonly KoochDbContext dbContext;
    private readonly IBookingSessionPayableScopeResolver payableScopeResolver;
    private readonly TimeProvider timeProvider;

    public BookingSessionQueryService(KoochDbContext dbContext)
        : this(dbContext, new BookingSessionPayableScopeResolver(), TimeProvider.System)
    {
    }

    internal BookingSessionQueryService(
        KoochDbContext dbContext,
        IBookingSessionPayableScopeResolver payableScopeResolver,
        TimeProvider timeProvider)
    {
        this.dbContext = dbContext;
        this.payableScopeResolver = payableScopeResolver;
        this.timeProvider = timeProvider;
    }

    public async Task<PagedResult<AccountBookingSessionListItemResponse>> GetForClientAsync(
        int clientId,
        AccountBookingSessionListQuery query,
        CancellationToken cancellationToken = default)
    {
        if (clientId <= 0)
        {
            throw new ArgumentOutOfRangeException(nameof(clientId));
        }

        var page = Math.Max(1, query.Page);
        var pageSize = Math.Clamp(query.PageSize, 1, 50);
        var now = timeProvider.GetUtcNow().UtcDateTime;
        var sessions = dbContext.BookingSessions.AsNoTracking()
            .Where(session => session.ClientId == clientId);
        var totalCount = await sessions.CountAsync(cancellationToken);
        var projections = await sessions
            .OrderByDescending(session => session.CreatedAtUtc)
            .ThenByDescending(session => session.Id)
            .Skip((page - 1) * pageSize)
            .Take(pageSize)
            .Select(session => new AccountBookingSessionListProjection
            {
                SessionCode = session.SessionCode,
                PropertyId = session.PropertyId,
                PropertyName = session.Property.Name,
                PropertySlug = session.Property.Slug,
                CheckInDate = session.Reservations.Select(reservation => (DateOnly?)reservation.CheckInDate).Min(),
                CheckOutDate = session.Reservations.Select(reservation => (DateOnly?)reservation.CheckOutDate).Max(),
                ReservationCount = session.Reservations.Count,
                TotalAmount = session.Reservations.Sum(reservation => reservation.FinalAmount),
                Currency = session.Currency,
                PaymentStatus = session.Payments
                    .OrderByDescending(payment => payment.CreatedAtUtc)
                    .ThenByDescending(payment => payment.Id)
                    .Select(payment => (PaymentStatus?)payment.Status)
                    .FirstOrDefault(),
                PaymentDeadlineUtc = session.Reservations
                    .Where(reservation =>
                        reservation.Status == ReservationStatus.ApprovedAwaitingPayment &&
                        reservation.PaymentExpiresAtUtc.HasValue)
                    .Select(reservation => reservation.PaymentExpiresAtUtc)
                    .Min(),
                HasPendingApproval = session.Reservations.Any(reservation =>
                    reservation.Status == ReservationStatus.PendingApproval),
                AllPendingApproval = session.Reservations.Count != 0 && session.Reservations.All(reservation =>
                    reservation.Status == ReservationStatus.PendingApproval),
                HasRejected = session.Reservations.Any(reservation =>
                    reservation.Status == ReservationStatus.Rejected),
                AllRejected = session.Reservations.Count != 0 && session.Reservations.All(reservation =>
                    reservation.Status == ReservationStatus.Rejected),
                AllExpired = session.Reservations.Count != 0 && session.Reservations.All(reservation =>
                    reservation.Status == ReservationStatus.PaymentExpired ||
                    reservation.Status == ReservationStatus.CapacityLost),
                AllConfirmed = session.Reservations.Count != 0 && session.Reservations.All(reservation =>
                    reservation.Status == ReservationStatus.Confirmed ||
                    reservation.Status == ReservationStatus.Paid ||
                    reservation.Status == ReservationStatus.Completed),
                AllAwaitingPayment = session.Reservations.Count != 0 && session.Reservations.All(reservation =>
                    reservation.Status == ReservationStatus.ApprovedAwaitingPayment),
                HasMissingPaymentDeadline = session.Reservations.Any(reservation =>
                    reservation.Status == ReservationStatus.ApprovedAwaitingPayment &&
                    !reservation.PaymentExpiresAtUtc.HasValue),
                MinimumPaymentDeadlineUtc = session.Reservations
                    .Where(reservation => reservation.Status == ReservationStatus.ApprovedAwaitingPayment)
                    .Select(reservation => reservation.PaymentExpiresAtUtc)
                    .Min(),
                MaximumPaymentDeadlineUtc = session.Reservations
                    .Where(reservation => reservation.Status == ReservationStatus.ApprovedAwaitingPayment)
                    .Select(reservation => reservation.PaymentExpiresAtUtc)
                    .Max()
            })
            .ToListAsync(cancellationToken);
        var items = projections.Select(projection => ToListItem(projection, now)).ToArray();

        return new PagedResult<AccountBookingSessionListItemResponse>
        {
            Items = items,
            TotalCount = totalCount,
            Page = page,
            PageSize = pageSize,
            TotalPages = totalCount == 0 ? 0 : (int)Math.Ceiling(totalCount / (double)pageSize)
        };
    }
    public Task<BookingSessionDetailsResponse> GetByIdAsync(
        int bookingSessionId,
        CancellationToken cancellationToken = default)
    {
        if (bookingSessionId <= 0)
        {
            throw new ArgumentOutOfRangeException(nameof(bookingSessionId));
        }

        return GetAsync(
            session => session.Id == bookingSessionId,
            cancellationToken);
    }

    public Task<BookingSessionDetailsResponse> GetBySessionCodeAsync(
        string sessionCode,
        CancellationToken cancellationToken = default)
    {
        var normalizedSessionCode = sessionCode?.Trim();
        if (string.IsNullOrEmpty(normalizedSessionCode))
        {
            throw new ArgumentException("Session code is required.", nameof(sessionCode));
        }

        return GetAsync(
            session => session.SessionCode == normalizedSessionCode,
            cancellationToken);
    }

    public async Task<AccountBookingSessionResponse> GetBySessionCodeForClientAsync(
        int clientId,
        string sessionCode,
        CancellationToken cancellationToken = default)
    {
        if (clientId <= 0)
        {
            throw new ArgumentOutOfRangeException(nameof(clientId));
        }

        var normalizedSessionCode = sessionCode?.Trim();
        if (string.IsNullOrEmpty(normalizedSessionCode))
        {
            throw new ArgumentException("Session code is required.", nameof(sessionCode));
        }

        var response = await dbContext.BookingSessions
            .AsNoTracking()
            .AsSingleQuery()
            .Where(session =>
                session.ClientId == clientId &&
                session.SessionCode == normalizedSessionCode)
            .Select(session => new AccountBookingSessionResponse
            {
                SessionCode = session.SessionCode,
                Property = new BookingSessionPropertyResponse
                {
                    PropertyId = session.PropertyId,
                    Name = session.Property.Name,
                    Slug = session.Property.Slug
                },
                Currency = session.Currency,
                Payment = session.Payments
                    .OrderByDescending(payment => payment.CreatedAtUtc)
                    .ThenByDescending(payment => payment.Id)
                    .Select(payment => new AccountBookingSessionPaymentResponse
                    {
                        PaymentId = payment.Id,
                        Status = payment.Status,
                        Amount = payment.Amount,
                        Currency = payment.Currency,
                        Provider = payment.Provider,
                        AppliedAtUtc = payment.AppliedAtUtc
                    })
                    .FirstOrDefault(),
                Reservations = session.Reservations
                    .OrderBy(reservation => reservation.Id)
                    .Select(reservation => new AccountBookingSessionReservationResponse
                    {
                        ReservationNumber = reservation.ReservationNumber ?? string.Empty,
                        RoomTypeId = reservation.RoomTypeId,
                        RoomTypeName = reservation.RoomType.Name,
                        RoomId = reservation.RoomId,
                        RoomName = reservation.Room == null ? null : reservation.Room.Name,
                        CheckInDate = reservation.CheckInDate,
                        CheckOutDate = reservation.CheckOutDate,
                        Status = reservation.Status,
                        ApprovalExpiresAtUtc = reservation.ApprovalExpiresAtUtc,
                        PaymentExpiresAtUtc = reservation.PaymentExpiresAtUtc,
                        FinalAmount = reservation.FinalAmount,
                        Currency = reservation.Currency
                    })
                    .ToList()
            })
            .SingleOrDefaultAsync(cancellationToken)
            ?? throw new KeyNotFoundException("Booking session not found.");

        CompleteAccountSummary(response);
        return response;
    }

    private async Task<BookingSessionDetailsResponse> GetAsync(
        Expression<Func<BookingSession, bool>> predicate,
        CancellationToken cancellationToken)
    {
        var response = await dbContext.BookingSessions
            .AsNoTracking()
            .AsSingleQuery()
            .Where(predicate)
            .Select(session => new BookingSessionDetailsResponse
            {
                BookingSessionId = session.Id,
                SessionCode = session.SessionCode,
                Currency = session.Currency,
                Property = new BookingSessionPropertyResponse
                {
                    PropertyId = session.PropertyId,
                    Name = session.Property.Name,
                    Slug = session.Property.Slug
                },
                Client = new BookingSessionClientResponse
                {
                    ClientId = session.ClientId,
                    FirstName = session.Client.FirstName,
                    LastName = session.Client.LastName,
                    PhoneNumber = session.Client.PhoneNumber,
                    Email = session.Client.Email
                },
                Guest = session.Guest == null
                    ? null
                    : new BookingSessionGuestResponse
                    {
                        GuestId = session.Guest.Id,
                        FirstName = session.Guest.FirstName,
                        LastName = session.Guest.LastName,
                        Mobile = session.Guest.Mobile,
                        Email = session.Guest.Email
                    },
                Reservations = session.Reservations
                    .OrderBy(reservation => reservation.Id)
                    .Select(reservation => new BookingSessionReservationDetailsResponse
                    {
                        ReservationId = reservation.Id,
                        ReservationNumber = reservation.ReservationNumber ?? string.Empty,
                        RoomTypeId = reservation.RoomTypeId,
                        RoomTypeName = reservation.RoomType.Name,
                        RoomId = reservation.RoomId,
                        RoomName = reservation.Room == null ? null : reservation.Room.Name,
                        CheckInDate = reservation.CheckInDate,
                        CheckOutDate = reservation.CheckOutDate,
                        Status = reservation.Status,
                        ApprovalExpiresAtUtc = reservation.ApprovalExpiresAtUtc,
                        PaymentExpiresAtUtc = reservation.PaymentExpiresAtUtc,
                        FinalAmount = reservation.FinalAmount,
                        Currency = reservation.Currency
                    })
                    .ToList()
            })
            .SingleOrDefaultAsync(cancellationToken)
            ?? throw new KeyNotFoundException("Booking session not found.");

        response.Summary = BuildSummary(
            response.Reservations,
            response.Currency,
            payableScopeResolver,
            timeProvider.GetUtcNow().UtcDateTime);
        return response;
    }

    private void CompleteAccountSummary(AccountBookingSessionResponse response)
    {
        var summaryReservations = response.Reservations
            .Select(reservation => new BookingSessionReservationDetailsResponse
            {
                ReservationNumber = reservation.ReservationNumber,
                RoomTypeId = reservation.RoomTypeId,
                RoomTypeName = reservation.RoomTypeName,
                RoomId = reservation.RoomId,
                RoomName = reservation.RoomName,
                CheckInDate = reservation.CheckInDate,
                CheckOutDate = reservation.CheckOutDate,
                Status = reservation.Status,
                ApprovalExpiresAtUtc = reservation.ApprovalExpiresAtUtc,
                PaymentExpiresAtUtc = reservation.PaymentExpiresAtUtc,
                FinalAmount = reservation.FinalAmount,
                Currency = reservation.Currency
            })
            .ToArray();
        response.Summary = BuildSummary(
            summaryReservations,
            response.Currency,
            payableScopeResolver,
            timeProvider.GetUtcNow().UtcDateTime);
        response.TotalAmount = response.Summary.TotalAmount;
        var deadlines = response.Reservations
            .Where(reservation =>
                reservation.Status == ReservationStatus.ApprovedAwaitingPayment &&
                reservation.PaymentExpiresAtUtc.HasValue)
            .Select(reservation => reservation.PaymentExpiresAtUtc!.Value)
            .Distinct()
            .ToArray();
        response.CommonPaymentDeadlineUtc = deadlines.Length is 1 ? deadlines[0] : null;
    }

    internal static BookingSessionDerivedSummaryResponse BuildSummary(
        IReadOnlyList<BookingSessionReservationDetailsResponse> reservations,
        string? sessionCurrency = null) =>
        BuildSummary(
            reservations,
            sessionCurrency ?? reservations.FirstOrDefault()?.Currency ?? string.Empty,
            new BookingSessionPayableScopeResolver(),
            DateTime.UtcNow);

    internal static BookingSessionDerivedSummaryResponse BuildSummary(
        IReadOnlyList<BookingSessionReservationDetailsResponse> reservations,
        string sessionCurrency,
        IBookingSessionPayableScopeResolver payableScopeResolver,
        DateTime utcNow)
    {
        var statusCounts = reservations
            .GroupBy(reservation => reservation.Status)
            .OrderBy(group => group.Key)
            .Select(group => new BookingSessionStatusCountResponse
            {
                Status = group.Key,
                Count = group.Count()
            })
            .ToArray();
        var derivedStatus = statusCounts.Length switch
        {
            0 => "Empty",
            1 => statusCounts[0].Status.ToString(),
            _ => "Mixed"
        };

        var paymentReservations = reservations
            .Where(reservation =>
                reservation.Status == ReservationStatus.ApprovedAwaitingPayment)
            .ToArray();
        var paymentDeadlines = paymentReservations
            .Where(reservation => reservation.PaymentExpiresAtUtc.HasValue)
            .Select(reservation => reservation.PaymentExpiresAtUtc!.Value)
            .ToArray();
        var hasPendingApprovals = reservations.Any(reservation =>
            reservation.Status == ReservationStatus.PendingApproval);
        var approvalDeadlines = reservations
            .Where(reservation =>
                reservation.Status == ReservationStatus.PendingApproval &&
                reservation.ApprovalExpiresAtUtc.HasValue)
            .Select(reservation => reservation.ApprovalExpiresAtUtc!.Value)
            .ToArray();
        var hasRejectedReservations = reservations.Any(reservation =>
            reservation.Status == ReservationStatus.Rejected);
        var hasMissingPaymentDeadline =
            paymentReservations.Any(reservation => !reservation.PaymentExpiresAtUtc.HasValue);
        var hasInconsistentPaymentDeadlines =
            paymentDeadlines.Distinct().Skip(1).Any();
        var allReservationsAwaitingPayment = reservations.Count > 0 &&
            reservations.All(reservation =>
                reservation.Status == ReservationStatus.ApprovedAwaitingPayment);
        var hasExpiredPaymentDeadline = paymentDeadlines.Any(deadline =>
            deadline <= utcNow);
        var payableScope = payableScopeResolver.Resolve(
            sessionCurrency,
            reservations.Select((reservation, index) => new BookingSessionPayableChild(
                reservation.ReservationId == 0 ? index + 1 : reservation.ReservationId,
                reservation.Status,
                reservation.FinalAmount,
                reservation.Currency,
                reservation.PaymentExpiresAtUtc))
                .ToArray(),
            utcNow);
        var originalTotalAmount = reservations.Sum(reservation => reservation.FinalAmount);

        return new BookingSessionDerivedSummaryResponse
        {
            DerivedStatus = derivedStatus,
            ReservationCount = reservations.Count,
            TotalAmount = originalTotalAmount,
            OriginalTotalAmount = originalTotalAmount,
            EarliestCheckInDate = reservations.Count == 0
                ? null
                : reservations.Min(reservation => reservation.CheckInDate),
            LatestCheckOutDate = reservations.Count == 0
                ? null
                : reservations.Max(reservation => reservation.CheckOutDate),
            IsPaymentReady = allReservationsAwaitingPayment &&
                !hasMissingPaymentDeadline &&
                !hasInconsistentPaymentDeadlines &&
                !hasExpiredPaymentDeadline,
            CanContinueWithApprovedReservations =
                payableScope.CanContinueWithApprovedReservations,
            PayableReservationCount = payableScope.PayableChildren.Count,
            PayableAmount = payableScope.PayableAmount,
            ContinuationPaymentDeadlineUtc = payableScope.RejectedChildren.Count > 0
                ? payableScope.EarliestPayableDeadlineUtc
                : null,
            HasPendingApprovals = hasPendingApprovals,
            HasRejectedReservations = hasRejectedReservations,
            HasInconsistentPaymentDeadlines = hasInconsistentPaymentDeadlines,
            EarliestPaymentDeadlineUtc = paymentDeadlines.Length == 0
                ? null
                : paymentDeadlines.Min(),
            EarliestApprovalDeadlineUtc = approvalDeadlines.Length == 0
                ? null
                : approvalDeadlines.Min(),
            StatusCounts = statusCounts
        };
    }

    private static AccountBookingSessionListItemResponse ToListItem(
        AccountBookingSessionListProjection projection,
        DateTime now)
    {
        var hasConsistentFutureDeadline =
            projection.MinimumPaymentDeadlineUtc.HasValue &&
            projection.MinimumPaymentDeadlineUtc == projection.MaximumPaymentDeadlineUtc &&
            projection.MinimumPaymentDeadlineUtc > now;
        var isPaymentReady = projection.AllAwaitingPayment &&
            !projection.HasMissingPaymentDeadline &&
            hasConsistentFutureDeadline;
        var derivedStatus = projection.PaymentStatus switch
        {
            PaymentStatus.Successful => "PaymentSuccessful",
            PaymentStatus.Failed => "PaymentFailed",
            _ when projection.AllPendingApproval => "AwaitingApproval",
            _ when isPaymentReady => "ReadyForPayment",
            _ when projection.AllExpired ||
                projection.AllAwaitingPayment && projection.MinimumPaymentDeadlineUtc <= now => "Expired",
            _ when projection.AllRejected => "Rejected",
            _ when projection.AllConfirmed => "PaymentSuccessful",
            _ when projection.HasPendingApproval || projection.HasRejected => "Mixed",
            _ => "Mixed"
        };

        return new AccountBookingSessionListItemResponse
        {
            SessionCode = projection.SessionCode,
            Property = new BookingSessionPropertyResponse
            {
                PropertyId = projection.PropertyId,
                Name = projection.PropertyName,
                Slug = projection.PropertySlug
            },
            CheckInDate = projection.CheckInDate,
            CheckOutDate = projection.CheckOutDate,
            ReservationCount = projection.ReservationCount,
            TotalAmount = projection.TotalAmount,
            Currency = projection.Currency,
            DerivedStatus = derivedStatus,
            PaymentStatus = projection.PaymentStatus,
            PaymentDeadlineUtc = projection.PaymentDeadlineUtc,
            IsPaymentReady = isPaymentReady
        };
    }

    private sealed class AccountBookingSessionListProjection
    {
        public string SessionCode { get; set; } = string.Empty;
        public int PropertyId { get; set; }
        public string PropertyName { get; set; } = string.Empty;
        public string PropertySlug { get; set; } = string.Empty;
        public DateOnly? CheckInDate { get; set; }
        public DateOnly? CheckOutDate { get; set; }
        public int ReservationCount { get; set; }
        public decimal TotalAmount { get; set; }
        public string Currency { get; set; } = string.Empty;
        public PaymentStatus? PaymentStatus { get; set; }
        public DateTime? PaymentDeadlineUtc { get; set; }
        public bool HasPendingApproval { get; set; }
        public bool AllPendingApproval { get; set; }
        public bool HasRejected { get; set; }
        public bool AllRejected { get; set; }
        public bool AllExpired { get; set; }
        public bool AllConfirmed { get; set; }
        public bool AllAwaitingPayment { get; set; }
        public bool HasMissingPaymentDeadline { get; set; }
        public DateTime? MinimumPaymentDeadlineUtc { get; set; }
        public DateTime? MaximumPaymentDeadlineUtc { get; set; }
    }
}
