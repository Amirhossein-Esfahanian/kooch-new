using Kooch.Api.Data;
using Kooch.Api.Entities;
using Kooch.Api.Dtos.Reservations;
using Kooch.Api.Dtos.Settlements;
using Microsoft.EntityFrameworkCore;

namespace Kooch.Api.Services;

public sealed class SettlementService(KoochDbContext context, TimeProvider clock)
{
    public DateOnly BusinessDate => DateOnly.FromDateTime(TimeZoneInfo.ConvertTime(
        clock.GetUtcNow(), TimeZoneInfo.FindSystemTimeZoneById("Asia/Tehran")).DateTime);

    public async Task<PagedResult<PropertyPayableResponse>> ListPayablesAsync(
        SettlementListQuery request, CancellationToken cancellationToken = default)
    {
        var today = BusinessDate;
        var query = context.FinancialEntries.AsNoTracking().Where(entry =>
            entry.EntryType == FinancialEntryType.PropertyPayable && entry.PayableDueDate.HasValue &&
            entry.Amount >= 0 && entry.ReversesEntryId == null &&
            !context.SettlementItems.IgnoreQueryFilters().Any(item => item.FinancialEntryId == entry.Id) &&
            !context.FinancialEntries.IgnoreQueryFilters().Any(reversal => reversal.ReversesEntryId == entry.Id));
        if (request.PropertyId.HasValue) query = query.Where(entry => entry.PropertyId == request.PropertyId);
        return await PageAsync(query.OrderBy(entry => entry.PayableDueDate).ThenBy(entry => entry.Id)
            .Select(entry => new PropertyPayableResponse(entry.Id, entry.PropertyId, entry.Property.Name,
                entry.Reservation == null ? null : entry.Reservation.ReservationNumber,
                entry.Amount, entry.Currency, entry.PayableDueDate!.Value,
                entry.PayableDueDate > today ? PayableStatus.Future
                    : entry.PayableDueDate == today ? PayableStatus.Due : PayableStatus.Overdue)), request, cancellationToken);
    }

    public async Task<PagedResult<SettlementListItemResponse>> ListAsync(
        SettlementListQuery request, CancellationToken cancellationToken = default)
    {
        var today = BusinessDate;
        var query = context.Settlements.AsNoTracking();
        if (request.PropertyId.HasValue) query = query.Where(settlement => settlement.PropertyId == request.PropertyId);
        return await PageAsync(query.OrderByDescending(settlement => settlement.CreatedAtUtc).ThenByDescending(settlement => settlement.Id)
            .Select(settlement => new SettlementListItemResponse(settlement.Id, settlement.PropertyId,
                settlement.Property.Name, settlement.TotalAmount, settlement.Currency, settlement.Items.Count,
                settlement.PaidAtUtc.HasValue ? SettlementStatus.Paid
                    : settlement.Items.Min(item => item.FinancialEntry.PayableDueDate) > today ? SettlementStatus.Pending
                    : settlement.Items.Min(item => item.FinancialEntry.PayableDueDate) == today ? SettlementStatus.Due
                    : SettlementStatus.Overdue,
                settlement.CreatedAtUtc, settlement.PaidAtUtc, settlement.IsEarlySettlement)), request, cancellationToken);
    }

    public Task<PagedResult<SettlementPropertyOption>> ListPropertiesAsync(
        SettlementListQuery request, CancellationToken cancellationToken = default)
    {
        var query = context.Properties.AsNoTracking();
        var search = request.Search?.Trim();
        if (!string.IsNullOrEmpty(search)) query = query.Where(property => property.Name.Contains(search));
        return PageAsync(query.OrderBy(property => property.Name).ThenBy(property => property.Id)
            .Select(property => new SettlementPropertyOption(property.Id, property.Name)), request, cancellationToken);
    }

    private static async Task<PagedResult<T>> PageAsync<T>(IQueryable<T> query, SettlementListQuery request,
        CancellationToken cancellationToken)
    {
        var page = Math.Max(1, request.Page);
        var pageSize = Math.Clamp(request.PageSize, 1, 50);
        var count = await query.CountAsync(cancellationToken);
        return new PagedResult<T>
        {
            Items = await query.Skip((page - 1) * pageSize).Take(pageSize).ToListAsync(cancellationToken),
            Page = page, PageSize = pageSize, TotalCount = count, TotalPages = (int)Math.Ceiling(count / (double)pageSize)
        };
    }

    public async Task<Settlement> CreateAsync(int propertyId, IReadOnlyCollection<int> payableIds,
        bool allowEarlySettlement = false, int? actorId = null, CancellationToken cancellationToken = default)
    {
        if (payableIds.Count == 0 || payableIds.Distinct().Count() != payableIds.Count)
            throw new ArgumentException("Select one or more distinct payable entries.");
        var entries = await context.FinancialEntries.AsNoTracking()
            .Where(entry => payableIds.Contains(entry.Id)).ToListAsync(cancellationToken);
        if (entries.Count != payableIds.Count || entries.Any(entry =>
                entry.PropertyId != propertyId || entry.EntryType != FinancialEntryType.PropertyPayable ||
                !entry.PayableDueDate.HasValue || entry.Amount < 0 || entry.ReversesEntryId.HasValue))
            throw new ArgumentException("Only eligible PropertyPayable entries from the selected property are allowed.");
        if (entries.Any(entry => string.IsNullOrWhiteSpace(entry.Currency) || entry.Currency.Length != 3) ||
            entries.Select(entry => entry.Currency).Distinct(StringComparer.OrdinalIgnoreCase).Count() != 1)
            throw new ArgumentException("Settlement entries must have one currency.");
        if (!allowEarlySettlement && entries.Any(entry => entry.PayableDueDate > BusinessDate))
            throw new InvalidOperationException("Future payables require explicit early settlement intent.");
        if (await context.SettlementItems.IgnoreQueryFilters().AnyAsync(
                item => payableIds.Contains(item.FinancialEntryId), cancellationToken) ||
            await context.FinancialEntries.IgnoreQueryFilters().AnyAsync(
                entry => entry.ReversesEntryId.HasValue && payableIds.Contains(entry.ReversesEntryId.Value), cancellationToken))
            throw new InvalidOperationException("A selected payable is already settled, allocated, or reversed.");

        var total = entries.Sum(entry => entry.Amount);
        if (total > 9999999999999999.99m)
            throw new ArgumentException("Settlement total exceeds monetary storage limits.");
        var settlement = new Settlement
        {
            PropertyId = propertyId, TotalAmount = total, Currency = entries[0].Currency,
            IsEarlySettlement = allowEarlySettlement, CreatedByUserId = actorId,
            Items = entries.Select(entry => new SettlementItem { FinancialEntryId = entry.Id }).ToList()
        };
        context.Settlements.Add(settlement);
        // One SaveChanges transaction; the unique payable index arbitrates concurrent creation.
        await context.SaveChangesAsync(cancellationToken);
        return await GetAsync(settlement.Id, cancellationToken);
    }

    public Task<Settlement> GetAsync(int id, CancellationToken cancellationToken = default) =>
        LoadAsync(id, cancellationToken);

    private async Task<Settlement> LoadAsync(int id, CancellationToken cancellationToken) =>
        await context.Settlements.Include(settlement => settlement.Property).Include(settlement => settlement.Items)
            .ThenInclude(item => item.FinancialEntry)
            .ThenInclude(entry => entry.Reservation)
            .SingleOrDefaultAsync(settlement => settlement.Id == id, cancellationToken)
        ?? throw new KeyNotFoundException("Settlement not found.");

    public async Task<Settlement> MarkPaidAsync(int id, CancellationToken cancellationToken = default)
    {
        var settlement = await LoadAsync(id, cancellationToken);
        if (settlement.PaidAtUtc.HasValue) return settlement;
        settlement.PaidAtUtc = clock.GetUtcNow().UtcDateTime;
        try
        {
            await context.SaveChangesAsync(cancellationToken);
        }
        catch (DbUpdateConcurrencyException)
        {
            await context.Entry(settlement).ReloadAsync(cancellationToken);
            if (!settlement.PaidAtUtc.HasValue) throw;
        }
        return settlement;
    }
}
