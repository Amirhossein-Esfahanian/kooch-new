using Kooch.Api.Data;
using Kooch.Api.Entities;
using Microsoft.EntityFrameworkCore;

namespace Kooch.Api.Services;

public sealed class ReservationVoucherService(
    KoochDbContext dbContext,
    IVoucherNumberGenerator voucherNumberGenerator) : IReservationVoucherService
{
    public async Task<ReservationVoucher> IssueAsync(
        Reservation reservation,
        Payment payment,
        PaymentItem? paymentItem,
        CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(reservation);
        ArgumentNullException.ThrowIfNull(payment);
        if (reservation.Status != ReservationStatus.Confirmed)
        {
            throw new InvalidOperationException("A voucher can only be issued for a confirmed reservation.");
        }

        var reservationNumber = reservation.ReservationNumber?.Trim();
        if (string.IsNullOrWhiteSpace(reservationNumber))
        {
            throw new InvalidOperationException("A confirmed reservation must have a reservation number before voucher issuance.");
        }

        var nights = reservation.CheckOutDate.DayNumber - reservation.CheckInDate.DayNumber;
        if (nights <= 0)
        {
            throw new InvalidOperationException("A voucher cannot be issued for an invalid reservation stay range.");
        }

        var financialSnapshot = await ResolveFinancialSnapshotAsync(
            reservation,
            payment,
            paymentItem,
            cancellationToken);
        var existing = dbContext.ReservationVouchers.Local
            .SingleOrDefault(voucher => voucher.ReservationId == reservation.Id)
            ?? await dbContext.ReservationVouchers.IgnoreQueryFilters()
                .SingleOrDefaultAsync(voucher => voucher.ReservationId == reservation.Id, cancellationToken);
        if (existing is not null)
        {
            ValidateExisting(existing, reservation, financialSnapshot);
            return existing;
        }

        var property = await dbContext.Properties.IgnoreQueryFilters().AsNoTracking()
            .SingleOrDefaultAsync(item => item.Id == reservation.PropertyId, cancellationToken)
            ?? throw new InvalidOperationException("Voucher property source is unavailable.");
        var roomType = await dbContext.RoomTypes.IgnoreQueryFilters().AsNoTracking()
            .SingleOrDefaultAsync(item => item.Id == reservation.RoomTypeId, cancellationToken)
            ?? throw new InvalidOperationException("Voucher room type source is unavailable.");
        string? roomName = null;
        if (reservation.RoomId.HasValue)
        {
            roomName = (await dbContext.Rooms.IgnoreQueryFilters().AsNoTracking()
                .SingleOrDefaultAsync(item => item.Id == reservation.RoomId.Value, cancellationToken))?.Name
                ?? throw new InvalidOperationException("Voucher room source is unavailable.");
        }

        var guest = await ResolveGuestAsync(reservation, cancellationToken);
        var voucher = new ReservationVoucher
        {
            ReservationId = reservation.Id,
            ReservationFinancialSnapshot = financialSnapshot,
            PropertyId = reservation.PropertyId,
            VoucherNumber = await voucherNumberGenerator.GenerateAsync(cancellationToken),
            IssuedAtUtc = DateTime.UtcNow,
            ReservationNumberSnapshot = reservationNumber,
            PropertyNameSnapshot = property.Name,
            GuestNameSnapshot = guest.Name,
            GuestMobileSnapshot = guest.Mobile,
            GuestEmailSnapshot = guest.Email,
            RoomTypeNameSnapshot = roomType.Name,
            RoomNameSnapshot = roomName,
            CheckInSnapshot = reservation.CheckInDate,
            CheckOutSnapshot = reservation.CheckOutDate,
            NightsSnapshot = nights,
            AdultCountSnapshot = reservation.AdultCount,
            ChildCountSnapshot = reservation.ChildCount,
            GrossAmount = financialSnapshot.GrossAmount,
            Currency = financialSnapshot.Currency,
            CommissionRate = financialSnapshot.CommissionRate,
            CommissionAmount = financialSnapshot.CommissionAmount,
            PropertyPayableAmount = financialSnapshot.PropertyPayableAmount
        };
        dbContext.ReservationVouchers.Add(voucher);
        return voucher;
    }

    private async Task<ReservationFinancialSnapshot> ResolveFinancialSnapshotAsync(
        Reservation reservation,
        Payment payment,
        PaymentItem? paymentItem,
        CancellationToken cancellationToken)
    {
        var local = dbContext.ReservationFinancialSnapshots.Local
            .Where(snapshot => snapshot.ReservationId == reservation.Id && snapshot.PaymentId == payment.Id)
            .ToArray();
        var candidates = local.Length > 0
            ? local
            : await dbContext.ReservationFinancialSnapshots.IgnoreQueryFilters()
                .Where(snapshot => snapshot.ReservationId == reservation.Id && snapshot.PaymentId == payment.Id)
                .ToArrayAsync(cancellationToken);
        var snapshot = candidates.Length switch
        {
            1 => candidates[0],
            0 => throw new InvalidOperationException(
                "A confirmed reservation requires its authoritative financial snapshot before voucher issuance."),
            _ => throw new InvalidOperationException(
                "Multiple financial snapshot sources exist for voucher issuance.")
        };
        if (snapshot.PropertyId != reservation.PropertyId || snapshot.PaymentItemId != paymentItem?.Id)
        {
            throw new InvalidOperationException("The financial snapshot does not match the voucher reservation allocation.");
        }

        return snapshot;
    }

    private async Task<GuestSnapshot> ResolveGuestAsync(
        Reservation reservation,
        CancellationToken cancellationToken)
    {
        if (reservation.GuestId.HasValue)
        {
            var guest = await dbContext.Guests.IgnoreQueryFilters().AsNoTracking()
                .SingleOrDefaultAsync(item => item.Id == reservation.GuestId.Value, cancellationToken)
                ?? throw new InvalidOperationException("Voucher guest source is unavailable.");
            return CreateGuestSnapshot(guest.FirstName, guest.LastName, guest.Mobile, guest.Email);
        }

        var client = await dbContext.Users.IgnoreQueryFilters().AsNoTracking()
            .SingleOrDefaultAsync(item => item.Id == reservation.ClientId, cancellationToken)
            ?? throw new InvalidOperationException("Voucher client source is unavailable.");
        return CreateGuestSnapshot(client.FirstName, client.LastName, client.PhoneNumber, client.Email);
    }

    private static GuestSnapshot CreateGuestSnapshot(
        string firstName,
        string lastName,
        string? mobile,
        string? email)
    {
        var name = $"{firstName} {lastName}".Trim();
        if (string.IsNullOrWhiteSpace(name))
        {
            throw new InvalidOperationException("Voucher guest name is unavailable.");
        }

        return new GuestSnapshot(name, NormalizeOptional(mobile), NormalizeOptional(email));
    }

    private static void ValidateExisting(
        ReservationVoucher voucher,
        Reservation reservation,
        ReservationFinancialSnapshot financialSnapshot)
    {
        var snapshotMatches = financialSnapshot.Id > 0
            ? voucher.ReservationFinancialSnapshotId == financialSnapshot.Id
            : ReferenceEquals(voucher.ReservationFinancialSnapshot, financialSnapshot);
        if (voucher.ReservationId != reservation.Id ||
            voucher.PropertyId != reservation.PropertyId ||
            !snapshotMatches ||
            string.IsNullOrWhiteSpace(voucher.VoucherNumber) ||
            string.IsNullOrWhiteSpace(voucher.ReservationNumberSnapshot) ||
            string.IsNullOrWhiteSpace(voucher.PropertyNameSnapshot) ||
            string.IsNullOrWhiteSpace(voucher.GuestNameSnapshot) ||
            string.IsNullOrWhiteSpace(voucher.RoomTypeNameSnapshot) ||
            voucher.NightsSnapshot <= 0 ||
            voucher.GrossAmount != financialSnapshot.GrossAmount ||
            voucher.Currency != financialSnapshot.Currency ||
            voucher.CommissionRate != financialSnapshot.CommissionRate ||
            voucher.CommissionAmount != financialSnapshot.CommissionAmount ||
            voucher.PropertyPayableAmount != financialSnapshot.PropertyPayableAmount)
        {
            throw new InvalidOperationException("Existing reservation voucher is incomplete or inconsistent.");
        }
    }

    private static string? NormalizeOptional(string? value) =>
        string.IsNullOrWhiteSpace(value) ? null : value.Trim();

    private sealed record GuestSnapshot(string Name, string? Mobile, string? Email);
}
