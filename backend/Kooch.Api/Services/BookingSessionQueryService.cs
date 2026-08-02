using System.Linq.Expressions;
using Kooch.Api.Data;
using Kooch.Api.Dtos.BookingSessions;
using Kooch.Api.Entities;
using Microsoft.EntityFrameworkCore;

namespace Kooch.Api.Services;

public sealed class BookingSessionQueryService(KoochDbContext dbContext) : IBookingSessionQueryService
{
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
                        PaymentExpiresAtUtc = reservation.PaymentExpiresAtUtc,
                        FinalAmount = reservation.FinalAmount,
                        Currency = reservation.Currency
                    })
                    .ToList()
            })
            .SingleOrDefaultAsync(cancellationToken)
            ?? throw new KeyNotFoundException("Booking session not found.");

        response.Summary = BuildSummary(response.Reservations);
        return response;
    }

    private static void CompleteAccountSummary(AccountBookingSessionResponse response)
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
                PaymentExpiresAtUtc = reservation.PaymentExpiresAtUtc,
                FinalAmount = reservation.FinalAmount,
                Currency = reservation.Currency
            })
            .ToArray();
        response.Summary = BuildSummary(summaryReservations);
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
        IReadOnlyList<BookingSessionReservationDetailsResponse> reservations)
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
            deadline <= DateTime.UtcNow);

        return new BookingSessionDerivedSummaryResponse
        {
            DerivedStatus = derivedStatus,
            ReservationCount = reservations.Count,
            TotalAmount = reservations.Sum(reservation => reservation.FinalAmount),
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
            HasPendingApprovals = hasPendingApprovals,
            HasRejectedReservations = hasRejectedReservations,
            HasInconsistentPaymentDeadlines = hasInconsistentPaymentDeadlines,
            EarliestPaymentDeadlineUtc = paymentDeadlines.Length == 0
                ? null
                : paymentDeadlines.Min(),
            StatusCounts = statusCounts
        };
    }
}
