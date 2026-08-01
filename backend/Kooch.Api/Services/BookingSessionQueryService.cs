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
            StatusCounts = statusCounts
        };
    }
}
