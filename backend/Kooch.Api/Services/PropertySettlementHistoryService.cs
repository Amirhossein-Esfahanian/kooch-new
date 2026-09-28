using Kooch.Api.Data;
using Kooch.Api.Dtos.Reservations;
using Kooch.Api.Dtos.Settlements;
using Kooch.Api.Entities;
using Microsoft.EntityFrameworkCore;

namespace Kooch.Api.Services;

public sealed class PropertySettlementHistoryService(KoochDbContext context, IPermissionService permissionService,
    TimeProvider clock)
{
    public async Task<PagedResult<PropertySettlementHistoryItemResponse>> ListAsync(int userId, int propertyId,
        PropertySettlementHistoryQuery request, CancellationToken cancellationToken = default)
    {
        await EnsureAccessAsync(userId, propertyId, cancellationToken);
        var status = ParseStatus(request.Status);
        var descending = ParseDirection(request.SortDirection);
        var today = BusinessDate;
        var query = context.Settlements.AsNoTracking().Where(settlement => settlement.PropertyId == propertyId);
        var search = request.Search?.Trim();
        if (!string.IsNullOrEmpty(search))
            query = query.Where(settlement => settlement.SettlementNumber.Contains(search) ||
                settlement.Items.Any(item => item.ReservationNumberSnapshot != null &&
                    item.ReservationNumberSnapshot.Contains(search)));
        var summaries = query.Select(settlement => new
        {
            settlement.Id, settlement.SettlementNumber, settlement.TotalAmount, settlement.Currency,
            settlement.CreatedAtUtc, settlement.PaidAtUtc,
            ItemCount = settlement.Items.Count,
            OldestPayableDueDate = settlement.Items.Min(item => item.FinancialEntry.PayableDueDate),
            Status = settlement.PaidAtUtc.HasValue ? SettlementStatus.Paid
                : settlement.CancelledAtUtc.HasValue ? SettlementStatus.Cancelled
                : settlement.Items.Min(item => item.FinancialEntry.PayableDueDate) > today ? SettlementStatus.Pending
                : settlement.Items.Min(item => item.FinancialEntry.PayableDueDate) == today ? SettlementStatus.Due
                : SettlementStatus.Overdue,
            CanViewReceipt = settlement.PaidAtUtc.HasValue && settlement.CancelledAtUtc == null &&
                settlement.PaymentRecord != null && settlement.PaymentRecord.PropertyNameSnapshot != null &&
                settlement.PaymentRecord.PropertyNameSnapshot.Trim() != "" && settlement.Items.Any() &&
                settlement.Items.All(item => item.ReservationNumberSnapshot != null &&
                    item.ReservationNumberSnapshot.Trim() != "" && item.FinancialEntry.PayableDueDate.HasValue)
        });
        if (status.HasValue) summaries = summaries.Where(item => item.Status == status.Value);
        var ordered = request.SortBy?.Trim() switch
        {
            null or "" or "CreatedAt" => descending
                ? summaries.OrderByDescending(item => item.CreatedAtUtc) : summaries.OrderBy(item => item.CreatedAtUtc),
            "TotalAmount" => descending
                ? summaries.OrderByDescending(item => item.TotalAmount) : summaries.OrderBy(item => item.TotalAmount),
            "ItemCount" => descending
                ? summaries.OrderByDescending(item => item.ItemCount) : summaries.OrderBy(item => item.ItemCount),
            "DueDate" => descending
                ? summaries.OrderByDescending(item => item.OldestPayableDueDate)
                : summaries.OrderBy(item => item.OldestPayableDueDate),
            _ => throw new ArgumentException("Invalid settlement sort field.")
        };
        var page = Math.Max(1, request.Page);
        var pageSize = Math.Clamp(request.PageSize, 1, 50);
        var count = await summaries.CountAsync(cancellationToken);
        var items = await (descending ? ordered.ThenByDescending(item => item.Id) : ordered.ThenBy(item => item.Id))
            .Skip((page - 1) * pageSize).Take(pageSize)
            .Select(item => new PropertySettlementHistoryItemResponse(item.SettlementNumber, item.Status,
                item.TotalAmount, item.Currency, item.ItemCount, item.CreatedAtUtc, item.OldestPayableDueDate,
                item.PaidAtUtc, item.CanViewReceipt)).ToListAsync(cancellationToken);
        return new PagedResult<PropertySettlementHistoryItemResponse>
        {
            Items = items, Page = page, PageSize = pageSize, TotalCount = count,
            TotalPages = (int)Math.Ceiling(count / (double)pageSize)
        };
    }

    public async Task<PropertySettlementHistoryDetailResponse> GetAsync(int userId, int propertyId,
        string settlementNumber, CancellationToken cancellationToken = default)
    {
        await EnsureAccessAsync(userId, propertyId, cancellationToken);
        var number = settlementNumber?.Trim();
        if (string.IsNullOrEmpty(number)) throw new KeyNotFoundException("Settlement not found.");
        var settlement = await context.Settlements.AsNoTracking()
            .Where(item => item.PropertyId == propertyId && item.SettlementNumber == number)
            .Include(item => item.PaymentRecord)
            .Include(item => item.Items).ThenInclude(item => item.FinancialEntry)
            .SingleOrDefaultAsync(cancellationToken)
            ?? throw new KeyNotFoundException("Settlement not found.");
        var items = settlement.Items.OrderBy(item => item.FinancialEntryId).Select(item =>
            new PropertySettlementHistoryDetailItemResponse(item.ReservationNumberSnapshot,
                item.FinancialEntry.PayableDueDate, item.FinancialEntry.Amount)).ToList();
        var record = settlement.PaymentRecord;
        var canViewReceipt = settlement.PaidAtUtc.HasValue && !settlement.CancelledAtUtc.HasValue &&
            record is not null && !string.IsNullOrWhiteSpace(record.PropertyNameSnapshot) &&
            items.Count > 0 && items.All(item => !string.IsNullOrWhiteSpace(item.ReservationNumber) &&
                item.PayableDueDate.HasValue);
        var oldestDueDate = items.Min(item => item.PayableDueDate);
        var status = settlement.PaidAtUtc.HasValue ? SettlementStatus.Paid
            : settlement.CancelledAtUtc.HasValue ? SettlementStatus.Cancelled
            : oldestDueDate > BusinessDate ? SettlementStatus.Pending
            : oldestDueDate == BusinessDate ? SettlementStatus.Due : SettlementStatus.Overdue;
        return new PropertySettlementHistoryDetailResponse(settlement.SettlementNumber,
            status, settlement.TotalAmount, settlement.Currency,
            settlement.CreatedAtUtc, oldestDueDate, settlement.PaidAtUtc,
            record is null ? null : new PropertySettlementHistoryPaymentResponse(record.PaymentMethod,
                record.ReferenceNumber, record.PaidAtUtc), items.Count, canViewReceipt, items);
    }

    private DateOnly BusinessDate => DateOnly.FromDateTime(TimeZoneInfo.ConvertTime(clock.GetUtcNow(),
        TimeZoneInfo.FindSystemTimeZoneById("Asia/Tehran")).DateTime);

    private async Task EnsureAccessAsync(int userId, int propertyId, CancellationToken cancellationToken)
    {
        var hasMembership = await context.UserPropertyAccesses.AsNoTracking().AnyAsync(access =>
            access.UserId == userId && access.PropertyId == propertyId && access.IsActive &&
            access.Status == PropertyUserStatus.Active && !access.Property.IsDeleted, cancellationToken);
        if (!hasMembership || !await permissionService.CanAsync(userId, propertyId, "financial.view", cancellationToken))
            throw new UnauthorizedAccessException("You cannot view this property's settlement history.");
    }

    private static SettlementStatus? ParseStatus(string? status) => status?.Trim() switch
    {
        null or "" => null,
        "Pending" => SettlementStatus.Pending,
        "Due" => SettlementStatus.Due,
        "Overdue" => SettlementStatus.Overdue,
        "Paid" => SettlementStatus.Paid,
        "Cancelled" => SettlementStatus.Cancelled,
        _ => throw new ArgumentException("Invalid settlement status.")
    };

    private static bool ParseDirection(string? direction) => direction?.Trim() switch
    {
        null or "" or "Desc" => true,
        "Asc" => false,
        _ => throw new ArgumentException("Invalid sort direction. Use Asc or Desc.")
    };
}
