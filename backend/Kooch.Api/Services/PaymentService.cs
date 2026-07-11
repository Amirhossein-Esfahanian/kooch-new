using System.Data;
using System.Security.Cryptography;
using System.Text;
using Kooch.Api.Data;
using Kooch.Api.Dtos.Payments;
using Kooch.Api.Entities;
using Microsoft.EntityFrameworkCore;

namespace Kooch.Api.Services;

public class PaymentService(KoochDbContext dbContext) : IPaymentService
{
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
                ReservationStatus = reservation.Status,
                CapacityClaimed = reservation.Status is ReservationStatus.Confirmed or ReservationStatus.Paid
            };
        }

        if (reservation.Status != ReservationStatus.ApprovedAwaitingPayment)
        {
            throw new InvalidOperationException("Reservation is not awaiting payment confirmation.");
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

        var availabilityRows = await dbContext.Availabilities.AsNoTracking()
            .Where(availability =>
                availability.RoomTypeId == roomTypeId &&
                availability.Date >= reservation.CheckInDate &&
                availability.Date < reservation.CheckOutDate)
            .ToDictionaryAsync(availability => availability.Date, cancellationToken);
        var claimedReservations = await dbContext.Reservations.AsNoTracking()
            .Where(item =>
                item.Id != reservation.Id &&
                item.RoomTypeId == roomTypeId &&
                item.CheckInDate < reservation.CheckOutDate &&
                item.CheckOutDate > reservation.CheckInDate &&
                (item.Status == ReservationStatus.Confirmed || item.Status == ReservationStatus.Paid) &&
                item.Payments.Any(payment => payment.Status == PaymentStatus.Successful))
            .Select(item => new { item.RoomId, item.CheckInDate, item.CheckOutDate })
            .ToListAsync(cancellationToken);

        var capacityExists = true;
        if (reservation.RoomId.HasValue && claimedReservations.Any(item => item.RoomId == reservation.RoomId))
        {
            capacityExists = false;
        }

        for (var date = reservation.CheckInDate; date < reservation.CheckOutDate; date = date.AddDays(1))
        {
            availabilityRows.TryGetValue(date, out var availability);
            var configuredCapacity = availability?.AvailableCount ?? roomType.TotalInventory;
            var claimedCount = claimedReservations.Count(item =>
                item.CheckInDate <= date && item.CheckOutDate > date);
            if (availability?.IsClosed == true ||
                availability?.Status == AvailabilityStatus.Unavailable ||
                configuredCapacity - claimedCount <= 0)
            {
                capacityExists = false;
                break;
            }
        }

        var now = DateTime.UtcNow;
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
            ReservationStatus = reservation.Status,
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
            Status = reservation.Status,
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

    private static string HashToken(string rawToken)
    {
        var bytes = SHA256.HashData(Encoding.UTF8.GetBytes(rawToken.Trim()));
        return Convert.ToHexString(bytes);
    }
}
