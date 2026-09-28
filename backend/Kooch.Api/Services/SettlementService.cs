using Kooch.Api.Data;
using Kooch.Api.Entities;
using Kooch.Api.Dtos.Reservations;
using Kooch.Api.Dtos.Settlements;
using Microsoft.EntityFrameworkCore;
using Microsoft.Data.SqlClient;

namespace Kooch.Api.Services;

public sealed class SettlementService(KoochDbContext context, TimeProvider clock, SettlementNumberGenerator? numberGenerator = null)
{
    public DateOnly BusinessDate => DateOnly.FromDateTime(TimeZoneInfo.ConvertTime(
        clock.GetUtcNow(), TimeZoneInfo.FindSystemTimeZoneById("Asia/Tehran")).DateTime);

    public async Task<PagedResult<PropertyPayableResponse>> ListPayablesAsync(
        SettlementListQuery request, CancellationToken cancellationToken = default)
    {
        var today = BusinessDate;
        PayableStatus? status = request.Status?.Trim() switch
        {
            null or "" => null,
            "Future" => PayableStatus.Future,
            "Due" => PayableStatus.Due,
            "Overdue" => PayableStatus.Overdue,
            _ => throw new ArgumentException("Invalid payable status.")
        };
        var descending = IsDescending(request.SortDirection, defaultDescending: false);
        var query = context.FinancialEntries.AsNoTracking().Where(entry =>
            entry.EntryType == FinancialEntryType.PropertyPayable && entry.PayableDueDate.HasValue &&
            entry.Amount >= 0 && entry.ReversesEntryId == null &&
            !context.SettlementItems.IgnoreQueryFilters().Any(item => item.FinancialEntryId == entry.Id && item.ReleasedAtUtc == null) &&
            !context.FinancialEntries.IgnoreQueryFilters().Any(reversal => reversal.ReversesEntryId == entry.Id));
        if (request.PropertyId.HasValue) query = query.Where(entry => entry.PropertyId == request.PropertyId);
        if (status.HasValue) query = status.Value switch
        {
            PayableStatus.Future => query.Where(entry => entry.PayableDueDate > today),
            PayableStatus.Due => query.Where(entry => entry.PayableDueDate == today),
            _ => query.Where(entry => entry.PayableDueDate < today)
        };
        var search = request.Search?.Trim();
        if (!string.IsNullOrEmpty(search)) query = query.Where(entry => entry.Reservation != null && entry.Reservation.ReservationNumber != null &&
            entry.Reservation.ReservationNumber.Contains(search));
        var ordered = request.SortBy?.Trim() switch
        {
            null or "" or "PayableDueDate" => descending
                ? query.OrderByDescending(entry => entry.PayableDueDate)
                : query.OrderBy(entry => entry.PayableDueDate),
            "Amount" => descending ? query.OrderByDescending(entry => entry.Amount) : query.OrderBy(entry => entry.Amount),
            _ => throw new ArgumentException("Invalid payable sort field.")
        };
        return await PageAsync((descending ? ordered.ThenByDescending(entry => entry.Id) : ordered.ThenBy(entry => entry.Id))
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
        SettlementStatus? status = request.Status?.Trim() switch
        {
            null or "" => null,
            "Pending" => SettlementStatus.Pending,
            "Due" => SettlementStatus.Due,
            "Overdue" => SettlementStatus.Overdue,
            "Paid" => SettlementStatus.Paid,
            "Cancelled" => SettlementStatus.Cancelled,
            _ => throw new ArgumentException("Invalid settlement status.")
        };
        var descending = IsDescending(request.SortDirection, defaultDescending: true);
        var query = context.Settlements.AsNoTracking();
        if (request.PropertyId.HasValue) query = query.Where(settlement => settlement.PropertyId == request.PropertyId);
        var items = query.Select(settlement => new
        {
            settlement.Id, settlement.SettlementNumber, settlement.PropertyId, PropertyName = settlement.Property.Name,
            settlement.TotalAmount, settlement.Currency, ItemCount = settlement.Items.Count,
            Status = settlement.PaidAtUtc.HasValue ? SettlementStatus.Paid
                    : settlement.CancelledAtUtc.HasValue ? SettlementStatus.Cancelled
                    : settlement.Items.Min(item => item.FinancialEntry.PayableDueDate) > today ? SettlementStatus.Pending
                    : settlement.Items.Min(item => item.FinancialEntry.PayableDueDate) == today ? SettlementStatus.Due
                    : SettlementStatus.Overdue,
                settlement.CreatedAtUtc, settlement.PaidAtUtc, settlement.IsEarlySettlement,
                CanViewReceipt = settlement.PaidAtUtc.HasValue && settlement.CancelledAtUtc == null &&
                    settlement.PaymentRecord != null && settlement.PaymentRecord.PropertyNameSnapshot != null &&
                    settlement.PaymentRecord.PropertyNameSnapshot.Trim() != "" && settlement.Items.Any() &&
                    settlement.Items.All(item => item.ReservationNumberSnapshot != null &&
                        item.ReservationNumberSnapshot.Trim() != "" && item.FinancialEntry.PayableDueDate.HasValue)
        });
        if (status.HasValue) items = items.Where(item => item.Status == status.Value);
        var ordered = request.SortBy?.Trim() switch
        {
            null or "" or "CreatedAt" => descending
                ? items.OrderByDescending(item => item.CreatedAtUtc)
                : items.OrderBy(item => item.CreatedAtUtc),
            "TotalAmount" => descending ? items.OrderByDescending(item => item.TotalAmount) : items.OrderBy(item => item.TotalAmount),
            "ItemCount" => descending ? items.OrderByDescending(item => item.ItemCount) : items.OrderBy(item => item.ItemCount),
            _ => throw new ArgumentException("Invalid settlement sort field.")
        };
        return await PageAsync((descending ? ordered.ThenByDescending(item => item.Id) : ordered.ThenBy(item => item.Id))
            .Select(item => new SettlementListItemResponse(item.Id, item.SettlementNumber, item.PropertyId, item.PropertyName,
                item.TotalAmount, item.Currency, item.ItemCount, item.Status, item.CreatedAtUtc,
                item.PaidAtUtc, item.IsEarlySettlement, item.CanViewReceipt)), request, cancellationToken);
    }

    private static bool IsDescending(string? direction, bool defaultDescending) => direction?.Trim() switch
    {
        null or "" => defaultDescending,
        "Asc" => false,
        "Desc" => true,
        _ => throw new ArgumentException("Invalid sort direction. Use Asc or Desc.")
    };

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
        await using var ownedTransaction = context.Database.IsRelational() && context.Database.CurrentTransaction is null
            ? await context.Database.BeginTransactionAsync(cancellationToken) : null;
        var entries = await context.FinancialEntries.AsNoTracking()
            .Where(entry => payableIds.Contains(entry.Id)).ToListAsync(cancellationToken);
        if (entries.Count != payableIds.Count || entries.Any(entry =>
                entry.PropertyId != propertyId || entry.EntryType != FinancialEntryType.PropertyPayable ||
                !entry.PayableDueDate.HasValue || entry.Amount < 0 || entry.ReversesEntryId.HasValue))
            throw new ArgumentException("Only eligible PropertyPayable entries from the selected property are allowed.");
        if (entries.Any(entry => string.IsNullOrWhiteSpace(entry.Currency) || entry.Currency.Length != 3) ||
            entries.Select(entry => entry.Currency).Distinct(StringComparer.OrdinalIgnoreCase).Count() != 1)
            throw new ArgumentException("Settlement entries must have one currency.");
        if (entries.Any(entry => !entry.ReservationId.HasValue))
            throw new InvalidOperationException("A reservation is required for every settlement item.");
        var reservationIds = entries.Select(entry => entry.ReservationId!.Value).Distinct().ToArray();
        var reservationReferences = await context.Reservations.IgnoreQueryFilters().AsNoTracking()
            .Where(reservation => reservationIds.Contains(reservation.Id))
            .Select(reservation => new { reservation.Id, reservation.ReservationNumber })
            .ToDictionaryAsync(reservation => reservation.Id, reservation => reservation.ReservationNumber, cancellationToken);
        var reservationNumbers = entries.ToDictionary(entry => entry.Id,
            entry => reservationReferences.GetValueOrDefault(entry.ReservationId!.Value)?.Trim());
        if (reservationNumbers.Values.Any(number => string.IsNullOrWhiteSpace(number) || number.Length > 32))
            throw new InvalidOperationException("A valid reservation number is required for every settlement item.");
        if (!allowEarlySettlement && entries.Any(entry => entry.PayableDueDate > BusinessDate))
            throw new InvalidOperationException("Future payables require explicit early settlement intent.");
        if (await context.SettlementItems.IgnoreQueryFilters().AnyAsync(
                item => payableIds.Contains(item.FinancialEntryId) && item.ReleasedAtUtc == null, cancellationToken) ||
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
            Items = entries.Select(entry => new SettlementItem
            {
                FinancialEntryId = entry.Id,
                ReservationNumberSnapshot = reservationNumbers[entry.Id]
            }).ToList()
        };
        var generator = numberGenerator ?? new SettlementNumberGenerator(context);
        settlement.SettlementNumber = await generator.GenerateAsync(cancellationToken);
        context.Settlements.Add(settlement);
        var transaction = context.Database.CurrentTransaction;
        const string savepoint = "SettlementNumberAllocation";
        var canRetry = transaction?.SupportsSavepoints == true;
        if (canRetry) await transaction!.CreateSavepointAsync(savepoint, cancellationToken);
        for (var attempt = 0; ; attempt++)
        {
            try
            {
                await context.SaveChangesAsync(cancellationToken);
                if (canRetry) await transaction!.ReleaseSavepointAsync(savepoint, cancellationToken);
                break;
            }
            catch (DbUpdateException error) when (IsSettlementNumberCollision(error))
            {
                if (!canRetry) throw;
                await transaction!.RollbackToSavepointAsync(savepoint, cancellationToken);
                if (attempt == 4)
                    throw new InvalidOperationException("Unable to persist a unique settlement reference after 5 attempts.", error);
                settlement.SettlementNumber = await generator.GenerateAsync(cancellationToken);
            }
        }
        if (ownedTransaction is not null) await ownedTransaction.CommitAsync(cancellationToken);
        return await GetAsync(settlement.Id, cancellationToken);
    }

    private static bool IsSettlementNumberCollision(DbUpdateException error) =>
        error.InnerException is SqlException sql && sql.Errors.Cast<SqlError>().Any(item =>
            item.Number is 2601 or 2627 &&
            item.Message.Contains("IX_Settlements_SettlementNumber", StringComparison.Ordinal));

    public Task<Settlement> GetAsync(int id, CancellationToken cancellationToken = default) =>
        LoadAsync(id, cancellationToken);

    private async Task<Settlement> LoadAsync(int id, CancellationToken cancellationToken) =>
        await context.Settlements.Include(settlement => settlement.Property).Include(settlement => settlement.PaymentRecord)
            .Include(settlement => settlement.Items)
            .ThenInclude(item => item.FinancialEntry)
            .SingleOrDefaultAsync(settlement => settlement.Id == id, cancellationToken)
        ?? throw new KeyNotFoundException("Settlement not found.");

    public async Task<Settlement> MarkPaidAsync(int id, MarkSettlementPaidRequest request, int actorId,
        CancellationToken cancellationToken = default)
    {
        if (!request.PaymentMethod.HasValue || !Enum.IsDefined(request.PaymentMethod.Value))
            throw new ArgumentException("A valid settlement payment method is required.");
        var referenceNumber = request.ReferenceNumber?.Trim();
        if (string.IsNullOrEmpty(referenceNumber) || referenceNumber.Length > 200)
            throw new ArgumentException("A payment reference of up to 200 characters is required.");
        if (!request.PaidAtUtc.HasValue || request.PaidAtUtc.Value == default)
            throw new ArgumentException("The actual payment timestamp is required.");
        if (actorId <= 0) throw new ArgumentException("A valid Admin actor is required.");
        var note = string.IsNullOrWhiteSpace(request.Note) ? null : request.Note.Trim();
        if (note?.Length > 2000) throw new ArgumentException("Payment note cannot exceed 2000 characters.");

        var settlement = await LoadAsync(id, cancellationToken);
        if (settlement.CancelledAtUtc.HasValue)
            throw new InvalidOperationException("Cancelled settlements cannot be marked paid.");
        if (settlement.PaidAtUtc.HasValue || settlement.PaymentRecord is not null)
            throw new InvalidOperationException("Settlement is already paid or has a payment record.");
        var propertyNameSnapshot = settlement.Property?.Name?.Trim();
        if (string.IsNullOrWhiteSpace(propertyNameSnapshot) || propertyNameSnapshot.Length > 200)
            throw new InvalidOperationException("A valid property name is required to record settlement payment.");
        var paidAtUtc = request.PaidAtUtc.Value.UtcDateTime;
        settlement.PaidAtUtc = paidAtUtc;
        var paymentRecord = new SettlementPaymentRecord
        {
            Settlement = settlement,
            PropertyNameSnapshot = propertyNameSnapshot,
            PaymentMethod = request.PaymentMethod.Value,
            ReferenceNumber = referenceNumber,
            PaidAtUtc = paidAtUtc,
            Note = note,
            RecordedByUserId = actorId,
            RecordedAtUtc = clock.GetUtcNow().UtcDateTime
        };
        settlement.PaymentRecord = paymentRecord;
        context.SettlementPaymentRecords.Add(paymentRecord);
        try
        {
            // EF Core wraps the record insert and Paid transition in one transaction.
            await context.SaveChangesAsync(cancellationToken);
        }
        catch (DbUpdateConcurrencyException)
        {
            await context.Entry(settlement).ReloadAsync(cancellationToken);
            if (settlement.CancelledAtUtc.HasValue)
                throw new InvalidOperationException("Cancelled settlements cannot be marked paid.");
            if (settlement.PaidAtUtc.HasValue)
                throw new InvalidOperationException("Settlement was marked paid by another request.");
            throw;
        }
        catch (DbUpdateException error) when (IsPaymentRecordCollision(error))
        {
            throw new InvalidOperationException("Settlement payment was recorded by another request.", error);
        }
        return settlement;
    }

    private static bool IsPaymentRecordCollision(DbUpdateException error) =>
        error.InnerException is SqlException sql && sql.Errors.Cast<SqlError>().Any(item =>
            item.Number is 2601 or 2627 &&
            item.Message.Contains("IX_SettlementPaymentRecords_SettlementId", StringComparison.Ordinal));

    public async Task<Settlement> CancelAsync(int id, string reason, int? actorId = null,
        CancellationToken cancellationToken = default)
    {
        if (string.IsNullOrWhiteSpace(reason) || reason.Trim().Length > 2000)
            throw new ArgumentException("A cancellation reason of up to 2000 characters is required.");
        var settlement = await LoadAsync(id, cancellationToken);
        if (settlement.PaidAtUtc.HasValue || settlement.CancelledAtUtc.HasValue)
            throw new InvalidOperationException("Only an active unpaid settlement can be cancelled.");

        var now = clock.GetUtcNow().UtcDateTime;
        settlement.CancelledAtUtc = now;
        settlement.CancelledByUserId = actorId;
        settlement.CancellationReason = reason.Trim();
        foreach (var item in settlement.Items) item.ReleasedAtUtc = now;
        try
        {
            // The default SaveChanges transaction makes cancellation and all releases atomic.
            // Both terminal timestamps are concurrency tokens, so Paid and Cancel cannot both win.
            await context.SaveChangesAsync(cancellationToken);
        }
        catch (DbUpdateConcurrencyException)
        {
            await context.Entry(settlement).ReloadAsync(cancellationToken);
            foreach (var item in settlement.Items) await context.Entry(item).ReloadAsync(cancellationToken);
            throw new InvalidOperationException("Settlement changed concurrently. Refresh before trying again.");
        }
        return settlement;
    }
}
