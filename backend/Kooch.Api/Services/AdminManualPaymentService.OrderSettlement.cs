using System.Data;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Kooch.Api.Dtos.Payments;
using Kooch.Api.Entities;
using Microsoft.EntityFrameworkCore;

namespace Kooch.Api.Services;

public sealed partial class AdminManualPaymentService
{
    public async Task<ManualOrderBalanceResponse> GetOrderBalanceAsync(int bookingSessionId, int actorUserId,
        CancellationToken cancellationToken = default)
    {
        var session = await LoadAuthorizedManualOrderAsync(bookingSessionId, actorUserId, cancellationToken);
        var reservations = await dbContext.Reservations.IgnoreQueryFilters().AsNoTracking()
            .Where(reservation => reservation.BookingSessionId == session.Id).OrderBy(reservation => reservation.Id)
            .ToListAsync(cancellationToken);
        EnsureManualOrder(session, reservations);
        var balances = await ReadRemainingBalancesAsync(reservations, cancellationToken);
        var reason = GetSettlementBlocker(session, reservations, balances, DateTime.UtcNow);
        return new ManualOrderBalanceResponse
        {
            BookingSessionId = session.Id, SessionCode = session.SessionCode, Currency = session.Currency,
            TotalAmount = reservations.Sum(reservation => reservation.FinalAmount),
            RemainingAmount = balances.Values.Sum(), CanSettle = reason is null, UnavailableReason = reason
        };
    }

    public async Task<ManualOrderSettlementResponse> SettleOrderAsync(int bookingSessionId,
        ManualOrderSettlementRequest request, int actorUserId, CancellationToken cancellationToken = default)
    {
        var key = NormalizeRequired(request.IdempotencyKey, 200, "Idempotency key");
        if (request.ConfirmedAmount <= 0 || decimal.Round(request.ConfirmedAmount, 2) != request.ConfirmedAmount ||
            request.ConfirmedAmount > 9999999999999999.99m)
            throw new ArgumentException("مبلغ تأییدشدهٔ تسویه معتبر نیست.");
        var session = await LoadAuthorizedManualOrderAsync(bookingSessionId, actorUserId, cancellationToken);
        // The existing receipt normalizer owns method/date/currency/text rules.
        var receipt = NormalizeCreateRequest(new AdminManualPaymentCreateRequest
        {
            ReservationId = 1, Amount = request.ConfirmedAmount, Currency = request.Currency,
            Method = request.Method, PaymentDate = request.PaymentDate, PaymentTime = request.PaymentTime,
            ReferenceNumber = request.ReferenceNumber, DestinationBank = request.DestinationBank,
            DestinationAccountReference = request.DestinationAccountReference, Notes = request.Notes
        });
        var hash = Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(JsonSerializer.Serialize(receipt))));
        await using var transaction = await dbContext.Database.BeginTransactionAsync(IsolationLevel.Serializable, cancellationToken);
        try
        {
            if (dbContext.Database.IsSqlServer())
                _ = await dbContext.BookingSessions.FromSqlInterpolated(
                    $"SELECT * FROM BookingSessions WITH (UPDLOCK, HOLDLOCK) WHERE Id = {session.Id}")
                    .AsNoTracking().SingleAsync(cancellationToken);
            var targets = await dbContext.Reservations.IgnoreQueryFilters().AsNoTracking()
                .Where(reservation => reservation.BookingSessionId == session.Id)
                .Select(reservation => new { reservation.Id, reservation.RoomTypeId }).ToListAsync(cancellationToken);
            foreach (var typeId in targets.Select(target => target.RoomTypeId).Distinct().Order())
                await LockRoomTypeAsync(typeId, cancellationToken);
            var reservations = new List<Reservation>();
            foreach (var id in targets.Select(target => target.Id).Order())
            {
                var locked = dbContext.Database.IsSqlServer()
                    ? dbContext.Reservations.FromSqlInterpolated(
                        $"SELECT * FROM Reservations WITH (UPDLOCK, HOLDLOCK) WHERE Id = {id}").IgnoreQueryFilters()
                    : dbContext.Reservations.IgnoreQueryFilters().Where(reservation => reservation.Id == id);
                var reservation = await locked.SingleAsync(cancellationToken);
                await dbContext.Entry(reservation).ReloadAsync(cancellationToken);
                if (reservation.RoomTypeId != targets.Single(target => target.Id == id).RoomTypeId)
                    throw new InvalidOperationException("اتاق رزرو تغییر کرده است؛ سفارش را دوباره بررسی کنید.");
                reservations.Add(reservation);
            }
            EnsureManualOrder(session, reservations);
            var existing = await dbContext.Payments.Include(payment => payment.Items)
                .SingleOrDefaultAsync(payment => payment.BookingSessionId == session.Id && payment.IdempotencyKey == key,
                    cancellationToken);
            if (existing is not null)
            {
                if (existing.Channel != PaymentChannel.Manual || existing.Status != PaymentStatus.Successful ||
                    existing.RequestHash != hash)
                    throw new InvalidOperationException("این شناسهٔ تسویه قبلاً با اطلاعات دیگری استفاده شده است.");
                await transaction.CommitAsync(cancellationToken);
                return SettlementResponse(existing, true);
            }
            var now = DateTime.UtcNow;
            var balances = await ReadRemainingBalancesAsync(reservations, cancellationToken);
            var blocker = GetSettlementBlocker(session, reservations, balances, now);
            if (blocker is not null) throw new InvalidOperationException(blocker);
            if (receipt.Currency != session.Currency || balances.Values.Sum() != request.ConfirmedAmount)
                throw new InvalidOperationException("ماندهٔ سفارش تغییر کرده است؛ مبلغ جدید را بررسی و تأیید کنید.");
            var payable = reservations.Where(reservation => balances[reservation.Id] > 0).ToArray();
            // Check every room before writing the receipt; no partial group settlement or
            // CapacityLost receipt is permitted for this explicit full-order action.
            foreach (var reservation in payable)
            {
                var range = await effectiveAvailabilityService.GetRangeAsync([reservation.RoomTypeId],
                    reservation.CheckInDate, reservation.CheckOutDate, reservation.Id, cancellationToken);
                if (!range.TryGetValue(reservation.RoomTypeId, out var availability) ||
                    !availability.HasCapacityForFullRange(1) ||
                    (reservation.RoomId.HasValue && availability.ClaimedRoomIds.Contains(reservation.RoomId.Value)))
                    throw new InvalidOperationException($"ظرفیت رزرو {reservation.ReservationNumber} برای تسویه موجود نیست.");
            }
            var payment = new Payment
            {
                BookingSessionId = session.Id, Channel = PaymentChannel.Manual, Amount = request.ConfirmedAmount,
                Currency = receipt.Currency, Status = PaymentStatus.Successful, PaidAtUtc = now,
                AppliedAtUtc = now, IdempotencyKey = key, RequestHash = hash, CreatedByUserId = actorUserId,
                ManualDetails = new ManualPaymentDetails
                {
                    Method = receipt.Method, PaymentDate = receipt.PaymentDate, PaymentTime = receipt.PaymentTime,
                    ReferenceNumber = receipt.ReferenceNumber, DestinationBank = receipt.DestinationBank,
                    DestinationAccountReference = receipt.DestinationAccountReference, Notes = receipt.Notes,
                    VerificationStatus = ManualPaymentVerificationStatus.Approved,
                    SubmittedByUserId = actorUserId, SubmittedAtUtc = now,
                    VerifiedByUserId = actorUserId, VerifiedAtUtc = now, CreatedByUserId = actorUserId
                },
                Items = payable.Select(reservation => new PaymentItem
                { ReservationId = reservation.Id, AllocatedAmount = balances[reservation.Id], Currency = receipt.Currency }).ToList()
            };
            dbContext.Payments.Add(payment);
            await dbContext.SaveChangesAsync(cancellationToken);
            foreach (var reservation in payable)
            {
                var item = payment.Items.Single(item => item.ReservationId == reservation.Id);
                await paymentFinancializationService.ApplyAsync(reservation, payment, item, item.AllocatedAmount, now, cancellationToken);
                reservation.Status = ReservationStatus.Confirmed;
                reservation.PaidAtUtc = now;
                reservation.ConfirmedAtUtc = now;
                reservation.ChangedAtUtc = now;
                reservation.ChangedByUserId = actorUserId;
                reservation.UpdatedByUserId = actorUserId;
                await reservationVoucherService.IssueAsync(reservation, payment, item, cancellationToken);
            }
            var ids = payable.Select(reservation => reservation.Id).ToArray();
            var tokens = await dbContext.ReservationPaymentLinkTokens
                .Where(token => ids.Contains(token.ReservationId) && token.UsedAtUtc == null).ToListAsync(cancellationToken);
            foreach (var token in tokens) { token.UsedAtUtc = now; token.UpdatedByUserId = actorUserId; }
            await dbContext.SaveWithVoucherNumberRetryAsync(cancellationToken);
            foreach (var reservation in payable)
                await new ReservationActivityService(dbContext).AppendPaymentConfirmedAsync(reservation.Id, actorUserId, cancellationToken);
            await transaction.CommitAsync(cancellationToken);
            return SettlementResponse(payment, false);
        }
        catch
        {
            await transaction.RollbackAsync(CancellationToken.None);
            dbContext.ChangeTracker.Clear();
            throw;
        }
    }

    private async Task<BookingSession> LoadAuthorizedManualOrderAsync(int id, int actorUserId, CancellationToken ct)
    {
        if (permissionService is null || propertyAuthorizationService is null ||
            !await permissionService.HasPermissionAsync(actorUserId, PermissionKey.ManagePayments, cancellationToken: ct))
            throw new UnauthorizedAccessException("اجازهٔ ثبت تسویه ندارید.");
        if (!await dbContext.Users.AsNoTracking().AnyAsync(user => user.Id == actorUserId && user.IsActive &&
            (user.Role == UserRole.SuperAdmin || user.Role == UserRole.AdminAssistant), ct))
            throw new UnauthorizedAccessException("ثبت تسویه فقط برای مدیر مجاز است.");
        var session = await dbContext.BookingSessions.AsNoTracking().SingleOrDefaultAsync(session => session.Id == id, ct)
            ?? throw new KeyNotFoundException("سفارش پیدا نشد.");
        if (!await propertyAuthorizationService.CanAccessPropertyAsync(actorUserId, session.PropertyId, ct))
            throw new UnauthorizedAccessException("به اقامتگاه این سفارش دسترسی ندارید.");
        return session;
    }

    private static void EnsureManualOrder(BookingSession session, IReadOnlyCollection<Reservation> reservations)
    {
        if (reservations.Count == 0 || reservations.Any(reservation => reservation.Source != ReservationSource.AdminCreated ||
            reservation.PropertyId != session.PropertyId || reservation.BookingSessionId != session.Id ||
            reservation.Currency != session.Currency || reservation.FinalAmount < 0 ||
            decimal.Round(reservation.FinalAmount, 2) != reservation.FinalAmount))
            throw new InvalidOperationException("تسویهٔ کل فقط برای سفارش دستی مدیر مجاز است.");
    }

    private async Task<Dictionary<int, decimal>> ReadRemainingBalancesAsync(IReadOnlyCollection<Reservation> reservations, CancellationToken ct)
    {
        var ids = reservations.Select(reservation => reservation.Id).ToArray();
        var direct = await dbContext.Payments.IgnoreQueryFilters().AsNoTracking().Where(payment => payment.ReservationId.HasValue &&
            ids.Contains(payment.ReservationId.Value) && payment.Status == PaymentStatus.Successful)
            .Select(payment => new { Id = payment.ReservationId!.Value, payment.Amount }).ToListAsync(ct);
        var allocated = await dbContext.PaymentItems.IgnoreQueryFilters().AsNoTracking().Where(item => ids.Contains(item.ReservationId) &&
            item.Payment.Status == PaymentStatus.Successful)
            .Select(item => new { Id = item.ReservationId, Amount = item.AllocatedAmount }).ToListAsync(ct);
        var paid = direct.Concat(allocated).GroupBy(item => item.Id).ToDictionary(group => group.Key, group => group.Sum(item => item.Amount));
        return reservations.ToDictionary(reservation => reservation.Id,
            reservation => Math.Max(0, reservation.FinalAmount - paid.GetValueOrDefault(reservation.Id)));
    }

    private static string? GetSettlementBlocker(BookingSession session, IReadOnlyCollection<Reservation> reservations,
        IReadOnlyDictionary<int, decimal> balances, DateTime now)
    {
        if (balances.Values.Sum() <= 0) return "این سفارش ماندهٔ قابل تسویه ندارد.";
        foreach (var reservation in reservations.Where(reservation => balances[reservation.Id] > 0))
        {
            if (reservation.IsDeleted) return $"رزرو {reservation.ReservationNumber} حذف شده و قابل تسویه نیست.";
            // Existing cancellation/voucher accounting requires one successful financial
            // source per room. Do not turn a legacy partial receipt into split funding here.
            if (balances[reservation.Id] != reservation.FinalAmount)
                return $"رزرو {reservation.ReservationNumber} دارای پرداخت جزئی قبلی است و پیش از تسویه نیاز به بررسی مالی دارد.";
            var paymentBlocker = GetDirectReservationPaymentBlocker(reservation, session.Currency, now);
            if (paymentBlocker is not null)
                return paymentBlocker switch
                {
                    DirectReservationPaymentBlocker.StatusNotPayable => ReservationStatusNormalizer.Normalize(reservation.Status) switch
                    {
                        ReservationStatus.PendingApproval or ReservationStatus.Draft =>
                            $"رزرو {reservation.ReservationNumber} در انتظار تأیید است؛ ابتدا رزرو را تأیید کنید، سپس ماندهٔ سفارش را دوباره دریافت کنید.",
                        ReservationStatus.Pending =>
                            $"رزرو {reservation.ReservationNumber} در وضعیت «در انتظار» است و قابل پرداخت نیست؛ وضعیت و مسیر مجاز آن را در جزئیات رزرو بررسی کنید.",
                        ReservationStatus.Cancelled => $"رزرو {reservation.ReservationNumber} لغو شده و قابل تسویه نیست.",
                        ReservationStatus.PaymentExpired => $"مهلت پرداخت رزرو {reservation.ReservationNumber} پایان یافته است؛ وضعیت رزرو را در جزئیات بررسی کنید.",
                        _ => $"رزرو {reservation.ReservationNumber} در وضعیت قابل پرداخت نیست؛ وضعیت رزرو را در جزئیات بررسی کنید."
                    },
                    DirectReservationPaymentBlocker.MissingDeadline =>
                        $"برای رزرو {reservation.ReservationNumber} مهلت پرداخت ثبت نشده است؛ وضعیت و مهلت را در جزئیات رزرو بررسی کنید.",
                    DirectReservationPaymentBlocker.ExpiredDeadline =>
                        $"مهلت پرداخت رزرو {reservation.ReservationNumber} پایان یافته است؛ وضعیت رزرو را در جزئیات بررسی کنید.",
                    DirectReservationPaymentBlocker.SessionPaymentRequired =>
                        $"رزرو {reservation.ReservationNumber} باید از مسیر پرداخت سفارش آنلاین پرداخت شود.",
                    _ => $"ارز پرداخت با ارز رزرو {reservation.ReservationNumber} یکسان نیست؛ سفارش نیاز به بررسی مالی دارد."
                };
            if (reservation.PaidAtUtc.HasValue) return $"وضعیت مالی رزرو {reservation.ReservationNumber} نیاز به بررسی دارد.";
        }
        return null;
    }

    private static ManualOrderSettlementResponse SettlementResponse(Payment payment, bool replay) => new()
    {
        PaymentId = payment.Id, BookingSessionId = payment.BookingSessionId!.Value,
        Amount = payment.Amount, Currency = payment.Currency, IsReplay = replay,
        Allocations = payment.Items.OrderBy(item => item.ReservationId)
            .Select(item => new ManualOrderAllocationResponse(item.ReservationId, item.AllocatedAmount)).ToArray()
    };
}
