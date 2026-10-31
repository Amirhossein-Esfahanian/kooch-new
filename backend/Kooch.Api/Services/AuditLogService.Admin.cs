using System.ComponentModel.DataAnnotations;
using System.Globalization;
using System.Text.Json;
using Kooch.Api.Data;
using Kooch.Api.Dtos.AuditLogs;
using Kooch.Api.Dtos.Reservations;
using Kooch.Api.Entities;
using Microsoft.EntityFrameworkCore;

namespace Kooch.Api.Services;

public partial class AuditLogService
{
    // Text, identity, contacts and access-control fields are deliberately absent.
    private static readonly string[] PropertyFields =
    [
        nameof(Property.Status), nameof(Property.Type), nameof(Property.InventoryMode),
        nameof(Property.DestinationId), nameof(Property.DefaultMealPlanId),
        nameof(Property.CheckInTime), nameof(Property.CheckOutTime),
        nameof(Property.RegularReceptionFrom), nameof(Property.RegularReceptionUntil),
        nameof(Property.SameNightInstantBookingTime), nameof(Property.SameNightInstantBookingDayOffset),
        nameof(Property.SameNightFinalBookingTime), nameof(Property.SameNightFinalBookingDayOffset),
        nameof(Property.TotalAreaM2), nameof(Property.LandAreaM2), nameof(Property.FloorsCount),
        nameof(Property.StairCount), nameof(Property.HasElevator), nameof(Property.IsWheelchairAccessible),
        nameof(Property.HasGroundFloorRoom), nameof(Property.HasAccessibleBathroom),
        nameof(Property.HasSeparateForeignPricing), nameof(Property.FreeChildAgeLimit),
        nameof(Property.MaxFreeChildren), nameof(Property.ChildPrice), nameof(Property.ExtraGuestPrice)
    ];
    private static readonly string[] CapacityFields =
    [nameof(RoomType.TotalInventory), nameof(RoomType.MaxAdults), nameof(RoomType.MaxChildren),
        nameof(RoomType.AllowExtraGuest), nameof(RoomType.MaxExtraGuests)];
    private static readonly string[] InventoryFields =
    [nameof(Availability.AvailableCount), nameof(Availability.Status), nameof(Availability.IsClosed),
        nameof(Availability.MinNightsOverride)];
    private static readonly string[] CashbackFields =
    [nameof(CashbackSetting.Enabled), nameof(CashbackSetting.CalculationMode), nameof(CashbackSetting.PercentageRate),
        nameof(CashbackSetting.SpendUnitAmount), nameof(CashbackSetting.RewardAmount),
        nameof(CashbackSetting.MaxCashbackPerReservation), nameof(CashbackSetting.ExpiryDays)];
    private static readonly HashSet<string> NumericSettingKeys = new(StringComparer.Ordinal)
    {
        "ReservationCommissionPercent", "ReferralCommissionPercent", "CommissionType3Percent",
        "image.maxFileSizeMb", "image.minWidth", "image.minHeight", "image.maxImagesPerProperty",
        PricingBoundsService.MinimumPriceKey, PricingBoundsService.MaximumPriceKey,
        ChildPricingRuleResolver.FreeChildMaxAgeKey, ChildPricingRuleResolver.HalfPriceChildMinAgeKey,
        ChildPricingRuleResolver.HalfPriceChildMaxAgeKey, ChildPricingRuleResolver.HalfPriceChildRateKey,
        ReservationPaymentWindowSettings.SettingKey, ReservationOwnerApprovalWindowSettings.SettingKey,
        ReservationOwnerApprovalReminderSettings.SettingKey
    };

    public void RecordInventoryChanges(int userId, int propertyId, IReadOnlyCollection<int> authorizedRoomTypeIds)
    {
        dbContext.ChangeTracker.DetectChanges();
        var roomIds = authorizedRoomTypeIds.ToHashSet();
        foreach (var entry in dbContext.ChangeTracker.Entries<Availability>().ToArray())
        {
            if (entry.State is not (EntityState.Added or EntityState.Modified)) continue;
            if (!roomIds.Contains(entry.Entity.RoomTypeId))
                throw new InvalidOperationException("Inventory audit requires an authorized Property-scoped RoomType.");
            CaptureChange(dbContext, userId, entry.Entity, propertyId);
        }
    }

    public void RecordPriceChanges(int userId, int propertyId, IReadOnlyCollection<RoomDailyPriceHistory> history,
        IReadOnlyDictionary<int, string> roomNames)
    {
        var occurredAt = DateTime.UtcNow;
        foreach (var group in history.GroupBy(item => item.RoomTypeId))
        {
            var log = new AuditLog
            {
                UserId = userId, PropertyId = propertyId, Action = AuditAction.PriceChanged,
                EntityType = "RoomDailyPrice", EntityId = group.Key, EntityName = roomNames[group.Key],
                Description = "Room daily prices changed.", OccurredAtUtc = occurredAt,
                NewValuesJson = JsonSerializer.Serialize(new
                {
                    ChangedCellCount = group.Sum(item => item.AffectedDateTo.DayNumber - item.AffectedDateFrom.DayNumber + 1),
                    RoomTypeCount = 1, GuestType = group.First().GuestType.ToString(),
                    From = group.Min(item => item.AffectedDateFrom).ToString("yyyy-MM-dd", CultureInfo.InvariantCulture),
                    To = group.Max(item => item.AffectedDateTo).ToString("yyyy-MM-dd", CultureInfo.InvariantCulture)
                })
            };
            foreach (var item in group)
            {
                item.AuditLog = log;
                item.ChangedAtUtc = occurredAt;
            }
            dbContext.AuditLogs.Add(log);
        }
    }

    public static void CaptureApprovedChange(KoochDbContext context, int userId, BaseEntity entity,
        int? inventoryPropertyId = null)
    {
        context.ChangeTracker.DetectChanges();
        CaptureChange(context, userId, entity, inventoryPropertyId);
    }

    private static void CaptureChange(KoochDbContext context, int userId, BaseEntity entity,
        int? inventoryPropertyId)
    {
        var entry = context.Entry(entity);
        if (entry.State is not (EntityState.Modified or EntityState.Added)) return;
        string[] fields;
        AuditAction action;
        int? propertyId;
        var previous = new Dictionary<string, object?>();
        var next = new Dictionary<string, object?>();
        switch (entity)
        {
            case Property property:
                fields = PropertyFields;
                action = AuditAction.PropertyInformationChanged;
                propertyId = property.Id;
                break;
            case RoomType room:
                fields = CapacityFields;
                action = AuditAction.RoomCapacityChanged;
                propertyId = room.PropertyId;
                break;
            case Availability availability:
                fields = InventoryFields;
                action = AuditAction.InventoryChanged;
                propertyId = inventoryPropertyId ?? throw new ArgumentException("PropertyId is required.");
                break;
            case SiteSetting setting:
                // Only numeric/boolean global settings qualify; arbitrary text is never captured.
                if (!NumericSettingKeys.Contains(setting.Key) && setting.Key != "image.enableWebpConversion") return;
                action = AuditAction.SiteSettingsChanged;
                propertyId = null;
                fields = [nameof(SiteSetting.Value)];
                break;
            case CashbackSetting cashback:
                // Property overrides are outside this Admin-only setting event's scope.
                if (cashback.PropertyId.HasValue) return;
                action = AuditAction.SiteSettingsChanged;
                propertyId = null;
                fields = CashbackFields;
                break;
            default:
                throw new ArgumentException("Entity is not approved for structured auditing.");
        }
        foreach (var field in fields)
        {
            var oldValue = entry.State == EntityState.Added ? null : entry.Property(field).OriginalValue;
            var newValue = entry.Property(field).CurrentValue;
            if (entity is SiteSetting setting)
            {
                oldValue = SafeSettingValue(setting.Key, oldValue as string);
                newValue = SafeSettingValue(setting.Key, newValue as string);
            }
            oldValue = Scalar(oldValue);
            newValue = Scalar(newValue);
            if (Equals(oldValue, newValue)) continue;
            var key = entity is SiteSetting siteSetting ? siteSetting.Key : field;
            previous[key] = oldValue;
            next[key] = newValue;
        }
        if (next.Count == 0) return;
        if (entity is Availability day)
        {
            previous["RoomTypeId"] = next["RoomTypeId"] = day.RoomTypeId;
            previous["Date"] = next["Date"] = day.Date.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture);
        }
        if (entity is CashbackSetting policy)
            previous["Currency"] = next["Currency"] = policy.Currency;
        context.AuditLogs.Add(new AuditLog
        {
            UserId = userId, PropertyId = propertyId, Action = action,
            EntityType = entity.GetType().Name, EntityId = entity.Id > 0 ? entity.Id : null,
            // These labels are safe for the existing Owner feed. Structured values are Admin-only.
            Description = action switch
            {
                AuditAction.InventoryChanged => "Room availability changed.",
                AuditAction.RoomCapacityChanged => "Room capacity changed.",
                AuditAction.PropertyInformationChanged => "Property information changed.",
                _ => "Site settings changed."
            },
            PreviousValuesJson = JsonSerializer.Serialize(previous),
            NewValuesJson = JsonSerializer.Serialize(next), OccurredAtUtc = DateTime.UtcNow
        });
    }

    private static object? SafeSettingValue(string key, string? value)
    {
        if (key == "image.enableWebpConversion")
            return bool.TryParse(value, out var boolean) ? boolean : null;
        return decimal.TryParse(value, NumberStyles.Number, CultureInfo.InvariantCulture, out var number)
            ? number : null;
    }

    private static object? Scalar(object? value) => value switch
    {
        null => null,
        Enum enumeration => enumeration.ToString(),
        TimeOnly time => time.ToString("HH:mm:ss", CultureInfo.InvariantCulture),
        bool or int or short or decimal or string => value,
        _ => throw new ArgumentException("Unsupported audit value.")
    };

    public async Task<PagedResult<AdminAuditLogResponse>> GetForAdminAsync(
        int userId, AdminAuditLogQuery query, CancellationToken cancellationToken = default)
    {
        await EnsureAdminHistoryAccessAsync(userId, cancellationToken);
        Validator.ValidateObject(query, new ValidationContext(query), validateAllProperties: true);
        var logs = dbContext.AuditLogs.AsNoTracking().AsQueryable();
        return await ReadAdminLogsAsync(logs, query, cancellationToken);
    }

    private async Task EnsureAdminHistoryAccessAsync(int userId, CancellationToken cancellationToken)
    {
        var role = await dbContext.Users.AsNoTracking().Where(user => user.Id == userId && user.IsActive)
            .Select(user => (UserRole?)user.Role).SingleOrDefaultAsync(cancellationToken);
        if (role is not (UserRole.SuperAdmin or UserRole.AdminAssistant) ||
            !await permissionService.HasPermissionAsync(userId, PermissionKey.ViewReports,
                cancellationToken: cancellationToken))
            throw new UnauthorizedAccessException("You cannot view Admin activity history.");
    }

    private async Task<PagedResult<AdminAuditLogResponse>> ReadAdminLogsAsync(IQueryable<AuditLog> logs,
        AdminAuditLogQuery query, CancellationToken cancellationToken)
    {
        if (query.ActorUserId.HasValue) logs = logs.Where(log => log.UserId == query.ActorUserId);
        if (query.PropertyId.HasValue) logs = logs.Where(log => log.PropertyId == query.PropertyId);
        if (query.Action.HasValue) logs = logs.Where(log => log.Action == query.Action);
        if (query.FromUtc.HasValue)
        {
            var from = query.FromUtc.Value.UtcDateTime;
            logs = logs.Where(log => log.OccurredAtUtc >= from);
        }
        if (query.ToUtc.HasValue)
        {
            var to = query.ToUtc.Value.UtcDateTime;
            logs = logs.Where(log => log.OccurredAtUtc < to);
        }
        var total = await logs.CountAsync(cancellationToken);
        var rows = await logs.OrderByDescending(log => log.OccurredAtUtc).ThenByDescending(log => log.Id)
            .Skip((query.Page - 1) * query.PageSize).Take(query.PageSize)
            .Select(log => new
            {
                log.Id, log.UserId, Actor = (log.User.FirstName + " " + log.User.LastName).Trim(),
                log.OccurredAtUtc, log.Action, log.EntityType, log.EntityId, log.PropertyId,
                EntityName = log.Action == AuditAction.PriceChanged && log.EntityType == "RoomDailyPrice" ? log.EntityName : null,
                HasPriceDetails = log.Action == AuditAction.PriceChanged && log.EntityType == "RoomDailyPrice" &&
                    dbContext.RoomDailyPriceHistory.Any(history => history.AuditLogId == log.Id &&
                        history.PropertyId == log.PropertyId && history.RoomTypeId == log.EntityId &&
                        history.OldBasePrice != history.NewBasePrice),
                PropertyName = log.Property == null ? null : log.Property.Name, log.Description,
                log.PreviousValuesJson, log.NewValuesJson
            }).ToListAsync(cancellationToken);
        return new PagedResult<AdminAuditLogResponse>
        {
            Page = query.Page, PageSize = query.PageSize, TotalCount = total,
            TotalPages = (int)Math.Ceiling(total / (double)query.PageSize),
            Items = rows.Select(row => new AdminAuditLogResponse
            {
                Id = row.Id, UserId = row.UserId,
                ActorDisplayName = row.Actor.Length == 0 ? $"User {row.UserId}" : row.Actor,
                OccurredAtUtc = DateTime.SpecifyKind(row.OccurredAtUtc, DateTimeKind.Utc), Action = row.Action,
                EntityType = row.EntityType, EntityId = row.EntityId, EntityName = row.EntityName,
                HasPriceDetails = row.HasPriceDetails, PropertyId = row.PropertyId,
                PropertyName = row.PropertyName, Description = row.Description,
                PreviousValues = ReadValues(row.EntityType, row.PreviousValuesJson),
                NewValues = ReadValues(row.EntityType, row.NewValuesJson)
            }).ToList()
        };
    }

    public async Task<AdminPriceChangePage> GetPriceChangesForAdminAsync(int userId, int auditLogId,
        AdminPriceChangeQuery query, CancellationToken cancellationToken = default)
    {
        await EnsureAdminHistoryAccessAsync(userId, cancellationToken);
        Validator.ValidateObject(query, new ValidationContext(query), validateAllProperties: true);
        // Both the parent event and its children must match the explicitly requested Property.
        var log = await dbContext.AuditLogs.AsNoTracking()
            .Where(item => item.Id == auditLogId && item.PropertyId == query.PropertyId &&
                item.Action == AuditAction.PriceChanged && item.EntityType == "RoomDailyPrice")
            .Select(item => new { item.EntityId }).SingleOrDefaultAsync(cancellationToken)
            ?? throw new KeyNotFoundException("Price activity was not found for this Property.");
        var history = dbContext.RoomDailyPriceHistory.AsNoTracking().Where(item =>
            item.AuditLogId == auditLogId && item.PropertyId == query.PropertyId &&
            item.RoomTypeId == log.EntityId && item.OldBasePrice != item.NewBasePrice);
        if (query.After.HasValue) history = history.Where(item => item.AffectedDateTo > query.After.Value);
        // A new event contains disjoint ranges for one RoomType/category. Reading at most N+1
        // ranges and expanding at most N+1 dates bounds both database work and the payload.
        var ranges = await history.OrderBy(item => item.AffectedDateFrom).ThenBy(item => item.Id)
            .Take(query.PageSize + 1)
            .Select(item => new { item.AffectedDateFrom, item.AffectedDateTo, item.OldBasePrice,
                item.NewBasePrice, item.GuestType }).ToListAsync(cancellationToken);
        var days = new List<AdminDailyPriceChange>();
        foreach (var range in ranges)
        {
            var start = Math.Max(range.AffectedDateFrom.DayNumber,
                query.After.HasValue ? query.After.Value.DayNumber + 1 : 0);
            for (var day = start; day <= range.AffectedDateTo.DayNumber && days.Count <= query.PageSize; day++)
                days.Add(new AdminDailyPriceChange(DateOnly.FromDayNumber(day), range.OldBasePrice,
                    range.NewBasePrice, range.GuestType));
            if (days.Count > query.PageSize) break;
        }
        var hasMore = days.Count > query.PageSize;
        var items = days.Take(query.PageSize).ToList();
        return new AdminPriceChangePage(items, hasMore, hasMore ? items[^1].Date : null);
    }

    private static IReadOnlyDictionary<string, JsonElement>? ReadValues(string entityType, string? json)
    {
        if (json is null) return null;
        var allowed = entityType switch
        {
            nameof(Property) => PropertyFields.AsEnumerable(),
            nameof(RoomType) => CapacityFields,
            nameof(Availability) => InventoryFields.Concat(["RoomTypeId", "Date"]),
            nameof(SiteSetting) => NumericSettingKeys.Concat(["image.enableWebpConversion"]),
            nameof(CashbackSetting) => CashbackFields.Concat(["Currency"]),
            "RoomDailyPrice" => new[] { "ChangedCellCount", "RoomTypeCount", "GuestType", "From", "To" },
            _ => []
        };
        var values = JsonSerializer.Deserialize<Dictionary<string, JsonElement>>(json);
        return values?.Where(pair => allowed.Contains(pair.Key) &&
            pair.Value.ValueKind is not (JsonValueKind.Object or JsonValueKind.Array))
            .ToDictionary(pair => pair.Key, pair => pair.Value);
    }
}
