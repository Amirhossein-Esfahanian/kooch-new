using Kooch.Api.Data;
using Kooch.Api.Dtos.Settlements;
using Kooch.Api.Entities;
using Microsoft.EntityFrameworkCore;

namespace Kooch.Api.Services;

public sealed class SettlementReceiptQueryService(KoochDbContext context, IPermissionService permissionService)
{
    public async Task<AdminSettlementReceiptResponse> GetForAdminAsync(string settlementNumber,
        CancellationToken cancellationToken = default)
    {
        var settlement = await LoadAvailableAsync(settlementNumber, null, cancellationToken);
        var record = settlement.PaymentRecord!;
        return new AdminSettlementReceiptResponse(settlement.SettlementNumber, record.PropertyNameSnapshot!,
            settlement.TotalAmount, settlement.Currency, record.PaidAtUtc, record.PaymentMethod,
            record.ReferenceNumber, record.RecordedAtUtc, record.Note, settlement.Items.Count, ProjectItems(settlement));
    }

    public async Task<PropertySettlementReceiptResponse> GetForPropertyAsync(int userId, int propertyId,
        string settlementNumber, CancellationToken cancellationToken = default)
    {
        // Owner-panel access alone is not sufficient: this document requires an active membership and financial.view.
        var hasMembership = await context.UserPropertyAccesses.AsNoTracking().AnyAsync(access =>
            access.UserId == userId && access.PropertyId == propertyId && access.IsActive &&
            access.Status == PropertyUserStatus.Active && !access.Property.IsDeleted, cancellationToken);
        if (!hasMembership || !await permissionService.CanAsync(userId, propertyId, "financial.view", cancellationToken))
            throw new UnauthorizedAccessException("You cannot view this property's settlement receipts.");

        var settlement = await LoadAvailableAsync(settlementNumber, propertyId, cancellationToken);
        var record = settlement.PaymentRecord!;
        return new PropertySettlementReceiptResponse(settlement.SettlementNumber, record.PropertyNameSnapshot!,
            settlement.TotalAmount, settlement.Currency, record.PaidAtUtc, record.PaymentMethod,
            record.ReferenceNumber, settlement.Items.Count, ProjectItems(settlement));
    }

    private async Task<Settlement> LoadAvailableAsync(string settlementNumber, int? propertyId,
        CancellationToken cancellationToken)
    {
        var normalized = settlementNumber?.Trim();
        if (string.IsNullOrEmpty(normalized)) throw new KeyNotFoundException("Settlement receipt not found.");
        var query = context.Settlements.AsNoTracking().Where(settlement => settlement.SettlementNumber == normalized);
        if (propertyId.HasValue) query = query.Where(settlement => settlement.PropertyId == propertyId.Value);
        var settlement = await query.Include(settlement => settlement.PaymentRecord)
            .Include(settlement => settlement.Items).ThenInclude(item => item.FinancialEntry)
            .SingleOrDefaultAsync(cancellationToken);
        if (settlement is null || !settlement.PaidAtUtc.HasValue || settlement.CancelledAtUtc.HasValue ||
            settlement.PaymentRecord is null || string.IsNullOrWhiteSpace(settlement.PaymentRecord.PropertyNameSnapshot) ||
            settlement.Items.Count == 0 || settlement.Items.Any(item =>
                string.IsNullOrWhiteSpace(item.ReservationNumberSnapshot) || !item.FinancialEntry.PayableDueDate.HasValue))
            throw new KeyNotFoundException("Settlement receipt not found.");
        return settlement;
    }

    private static IReadOnlyList<SettlementReceiptItemResponse> ProjectItems(Settlement settlement) =>
        settlement.Items.OrderBy(item => item.FinancialEntryId)
            .Select(item => new SettlementReceiptItemResponse(item.ReservationNumberSnapshot!,
                item.FinancialEntry.PayableDueDate!.Value, item.FinancialEntry.Amount)).ToList();
}
