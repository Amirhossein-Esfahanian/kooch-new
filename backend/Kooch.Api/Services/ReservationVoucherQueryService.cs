using Kooch.Api.Data;
using Kooch.Api.Dtos.Reservations;
using Microsoft.EntityFrameworkCore;

namespace Kooch.Api.Services;

public sealed class ReservationVoucherQueryService(
    KoochDbContext dbContext,
    IPermissionService permissionService) : IReservationVoucherQueryService
{
    public async Task<GuestReservationVoucherResponse> GetForGuestAsync(
        int userId,
        string reservationNumber,
        CancellationToken cancellationToken = default)
    {
        if (string.IsNullOrWhiteSpace(reservationNumber))
        {
            throw new KeyNotFoundException("Voucher not found.");
        }

        var normalizedReservationNumber = reservationNumber.Trim();
        return await dbContext.ReservationVouchers.AsNoTracking()
            .Where(voucher =>
                voucher.Reservation.ReservationNumber == normalizedReservationNumber &&
                voucher.Reservation.Guest != null &&
                voucher.Reservation.Guest.UserId == userId)
            .Select(voucher => new GuestReservationVoucherResponse
            {
                VoucherNumber = voucher.VoucherNumber,
                ReservationNumber = voucher.ReservationNumberSnapshot,
                IssuedAtUtc = voucher.IssuedAtUtc,
                PropertyName = voucher.PropertyNameSnapshot,
                GuestName = voucher.GuestNameSnapshot,
                RoomTypeName = voucher.RoomTypeNameSnapshot,
                RoomName = voucher.RoomNameSnapshot,
                CheckIn = voucher.CheckInSnapshot,
                CheckOut = voucher.CheckOutSnapshot,
                Nights = voucher.NightsSnapshot,
                AdultCount = voucher.AdultCountSnapshot,
                ChildCount = voucher.ChildCountSnapshot,
                GrossAmount = voucher.GrossAmount,
                Currency = voucher.Currency
            })
            .SingleOrDefaultAsync(cancellationToken)
            ?? throw new KeyNotFoundException("Voucher not found.");
    }

    public async Task<OwnerReservationVoucherResponse> GetForPropertyAsync(
        int userId,
        int propertyId,
        int reservationId,
        CancellationToken cancellationToken = default)
    {
        if (!await permissionService.CanAsync(
                userId,
                propertyId,
                "financial.view",
                cancellationToken))
        {
            throw new UnauthorizedAccessException("You cannot view this property's financial vouchers.");
        }

        return await dbContext.ReservationVouchers.AsNoTracking()
            .Where(voucher =>
                voucher.ReservationId == reservationId &&
                voucher.PropertyId == propertyId)
            .Select(voucher => new OwnerReservationVoucherResponse
            {
                VoucherNumber = voucher.VoucherNumber,
                ReservationNumber = voucher.ReservationNumberSnapshot,
                IssuedAtUtc = voucher.IssuedAtUtc,
                PropertyName = voucher.PropertyNameSnapshot,
                GuestName = voucher.GuestNameSnapshot,
                RoomTypeName = voucher.RoomTypeNameSnapshot,
                RoomName = voucher.RoomNameSnapshot,
                CheckIn = voucher.CheckInSnapshot,
                CheckOut = voucher.CheckOutSnapshot,
                Nights = voucher.NightsSnapshot,
                AdultCount = voucher.AdultCountSnapshot,
                ChildCount = voucher.ChildCountSnapshot,
                GrossAmount = voucher.GrossAmount,
                Currency = voucher.Currency,
                CommissionRate = voucher.CommissionRate,
                CommissionAmount = voucher.CommissionAmount,
                PropertyPayableAmount = voucher.PropertyPayableAmount
            })
            .SingleOrDefaultAsync(cancellationToken)
            ?? throw new KeyNotFoundException("Voucher not found.");
    }
}
