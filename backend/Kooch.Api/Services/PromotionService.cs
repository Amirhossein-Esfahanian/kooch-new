using Kooch.Api.Data;
using Kooch.Api.Dtos.Promotions;
using Kooch.Api.Entities;
using Microsoft.EntityFrameworkCore;

namespace Kooch.Api.Services;

public sealed class PromotionService(KoochDbContext dbContext, IPropertyAccessService propertyAccessService)
    : IPromotionService
{
    public async Task<IReadOnlyList<PromotionResponse>> GetAllForAdminAsync(CancellationToken cancellationToken = default)
    {
        var promotions = await PromotionQuery().ToListAsync(cancellationToken);
        return await MapAsync(promotions, null, cancellationToken);
    }

    public async Task<IReadOnlyList<PromotionResponse>> GetByPropertyAsync(
        int userId, UserRole role, int propertyId, CancellationToken cancellationToken = default)
    {
        await EnsurePropertyAccessAsync(userId, role, propertyId, cancellationToken);

        var propertyPromotions = await PromotionQuery()
            .Where(promotion => promotion.PropertyId == propertyId)
            .ToListAsync(cancellationToken);

        var activatedTemplateIds = propertyPromotions
            .Where(promotion => promotion.SourcePromotionId.HasValue)
            .Select(promotion => promotion.SourcePromotionId!.Value)
            .ToHashSet();

        var libraryTemplates = await PromotionQuery()
            .Where(promotion =>
                promotion.PropertyId == null &&
                promotion.Source == PromotionSource.Admin &&
                promotion.IsPublished &&
                !activatedTemplateIds.Contains(promotion.Id))
            .ToListAsync(cancellationToken);

        return await MapAsync([.. propertyPromotions, .. libraryTemplates], propertyId, cancellationToken);
    }

    public async Task<PromotionResponse> CreateAsync(
        int userId, UserRole role, int? ownerPropertyId, PromotionUpsertRequest request,
        CancellationToken cancellationToken = default)
    {
        var propertyId = ownerPropertyId ?? NormalizePropertyId(request.PropertyId);
        await EnsureMutationAccessAsync(userId, role, ownerPropertyId, propertyId, cancellationToken);
        var roomTypes = await ValidateAsync(propertyId, request, cancellationToken);

        var promotion = new Promotion
        {
            PropertyId = propertyId,
            Source = ownerPropertyId.HasValue ? PromotionSource.Owner : PromotionSource.Admin,
            IsPublished = ownerPropertyId is null && request.IsPublished,
            CreatedByUserId = userId
        };
        Apply(promotion, request);
        promotion.PromotionRoomTypes = roomTypes.Select(room => new PromotionRoomType { RoomTypeId = room.Id }).ToList();
        dbContext.Promotions.Add(promotion);
        await dbContext.SaveChangesAsync(cancellationToken);
        return await GetResponseAsync(promotion.Id, ownerPropertyId, cancellationToken);
    }

    public async Task<PromotionResponse> UpdateAsync(
        int userId, UserRole role, int? ownerPropertyId, int promotionId, PromotionUpsertRequest request,
        CancellationToken cancellationToken = default)
    {
        var promotion = await dbContext.Promotions
            .Include(item => item.PromotionRoomTypes)
            .SingleOrDefaultAsync(item => item.Id == promotionId, cancellationToken)
            ?? throw new KeyNotFoundException("پروموشن پیدا نشد.");

        if (ownerPropertyId.HasValue && promotion.Source == PromotionSource.Admin)
            throw new UnauthorizedAccessException("پروموشن‌های مدیریتی فقط قابل فعال‌سازی، غیرفعال‌سازی یا کپی هستند.");

        await EnsureMutationAccessAsync(userId, role, ownerPropertyId, promotion.PropertyId, cancellationToken);

        var propertyId = ownerPropertyId ?? NormalizePropertyId(request.PropertyId);
        await EnsureMutationAccessAsync(userId, role, ownerPropertyId, propertyId, cancellationToken);
        var roomTypes = await ValidateAsync(propertyId, request, cancellationToken);

        promotion.PropertyId = propertyId;
        promotion.UpdatedByUserId = userId;
        Apply(promotion, request);
        promotion.IsPublished = ownerPropertyId is null && request.IsPublished;

        var selectedRoomIds = roomTypes.Select(room => room.Id).ToHashSet();
        var existingRoomIds = promotion.PromotionRoomTypes.Select(item => item.RoomTypeId).ToHashSet();
        dbContext.PromotionRoomTypes.RemoveRange(
            promotion.PromotionRoomTypes.Where(item => !selectedRoomIds.Contains(item.RoomTypeId)));
        foreach (var roomTypeId in selectedRoomIds.Where(id => !existingRoomIds.Contains(id)))
            promotion.PromotionRoomTypes.Add(new PromotionRoomType { RoomTypeId = roomTypeId });

        await dbContext.SaveChangesAsync(cancellationToken);
        return await GetResponseAsync(promotion.Id, ownerPropertyId, cancellationToken);
    }

    public async Task<PromotionResponse> SetActiveAsync(
        int userId, UserRole role, int? ownerPropertyId, int promotionId, bool isActive,
        CancellationToken cancellationToken = default)
    {
        var promotion = await FindForMutationAsync(userId, role, ownerPropertyId, promotionId, cancellationToken);
        promotion.IsActive = isActive;
        promotion.UpdatedByUserId = userId;
        await dbContext.SaveChangesAsync(cancellationToken);
        return await GetResponseAsync(promotion.Id, ownerPropertyId, cancellationToken);
    }

    public async Task<PromotionResponse> ActivateAdminPromotionAsync(
        int userId, UserRole role, int ownerPropertyId, int templatePromotionId,
        CancellationToken cancellationToken = default)
    {
        await EnsurePropertyAccessAsync(userId, role, ownerPropertyId, cancellationToken);

        var template = await dbContext.Promotions.AsNoTracking()
            .Include(item => item.PromotionRoomTypes)
            .SingleOrDefaultAsync(item =>
                item.Id == templatePromotionId &&
                item.PropertyId == null &&
                item.Source == PromotionSource.Admin &&
                item.IsPublished,
                cancellationToken)
            ?? throw new KeyNotFoundException("پروموشن مدیریتی منتشرشده پیدا نشد.");

        var existing = await dbContext.Promotions
            .SingleOrDefaultAsync(item =>
                item.PropertyId == ownerPropertyId &&
                item.SourcePromotionId == templatePromotionId,
                cancellationToken);
        if (existing is not null)
        {
            existing.IsActive = true;
            existing.UpdatedByUserId = userId;
            await dbContext.SaveChangesAsync(cancellationToken);
            return await GetResponseAsync(existing.Id, ownerPropertyId, cancellationToken);
        }

        var rooms = await GetActiveRoomsAsync(ownerPropertyId, cancellationToken);
        if (rooms.Count == 0) throw new ArgumentException("برای فعال‌سازی پروموشن حداقل یک اتاق فعال لازم است.");
        ValidateAmountAgainstRooms(template, rooms);

        var activation = CopyPromotion(template, ownerPropertyId, userId, PromotionSource.Admin, true);
        activation.SourcePromotionId = template.Id;
        activation.PromotionRoomTypes = rooms.Select(room => new PromotionRoomType { RoomTypeId = room.Id }).ToList();
        dbContext.Promotions.Add(activation);
        await dbContext.SaveChangesAsync(cancellationToken);
        return await GetResponseAsync(activation.Id, ownerPropertyId, cancellationToken);
    }

    public async Task<PromotionResponse> DuplicateAsync(
        int userId, UserRole role, int? ownerPropertyId, int promotionId,
        CancellationToken cancellationToken = default)
    {
        var source = await dbContext.Promotions.AsNoTracking()
            .Include(item => item.PromotionRoomTypes)
            .SingleOrDefaultAsync(item => item.Id == promotionId, cancellationToken)
            ?? throw new KeyNotFoundException("پروموشن پیدا نشد.");

        var targetPropertyId = ownerPropertyId ?? source.PropertyId;
        await EnsureMutationAccessAsync(userId, role, ownerPropertyId, targetPropertyId, cancellationToken);

        var copySource = ownerPropertyId.HasValue ? PromotionSource.Owner : source.Source;
        var copy = CopyPromotion(source, targetPropertyId, userId, copySource, false);

        var roomIds = source.PromotionRoomTypes.Select(item => item.RoomTypeId).Distinct().ToList();
        if (targetPropertyId.HasValue)
        {
            var validRooms = await GetActiveRoomsAsync(targetPropertyId.Value, cancellationToken);
            var validRoomIds = validRooms.Select(room => room.Id).ToHashSet();
            roomIds = roomIds.Where(validRoomIds.Contains).ToList();
            if (roomIds.Count == 0) roomIds = validRooms.Select(room => room.Id).ToList();
            ValidateAmountAgainstRooms(source, validRooms.Where(room => roomIds.Contains(room.Id)).ToList());
        }

        copy.PromotionRoomTypes = roomIds.Select(roomTypeId => new PromotionRoomType { RoomTypeId = roomTypeId }).ToList();
        dbContext.Promotions.Add(copy);
        await dbContext.SaveChangesAsync(cancellationToken);
        return await GetResponseAsync(copy.Id, ownerPropertyId, cancellationToken);
    }

    public async Task DeleteAsync(
        int userId, UserRole role, int? ownerPropertyId, int promotionId,
        CancellationToken cancellationToken = default)
    {
        var promotion = await FindForMutationAsync(userId, role, ownerPropertyId, promotionId, cancellationToken);
        if (ownerPropertyId.HasValue && promotion.Source == PromotionSource.Admin)
            throw new UnauthorizedAccessException("پروموشن‌های مدیریتی را نمی‌توانید حذف کنید؛ فقط غیرفعال کنید.");

        promotion.IsDeleted = true;
        promotion.DeletedAtUtc = DateTime.UtcNow;
        promotion.DeletedByUserId = userId;
        await dbContext.SaveChangesAsync(cancellationToken);
    }

    public async Task ReorderAsync(
        int userId, UserRole role, int? ownerPropertyId, IReadOnlyList<int> promotionIds,
        CancellationToken cancellationToken = default)
    {
        var ids = promotionIds.Distinct().ToArray();
        var promotions = await dbContext.Promotions.Where(item => ids.Contains(item.Id)).ToListAsync(cancellationToken);
        if (promotions.Count != ids.Length) throw new KeyNotFoundException("یک یا چند پروموشن پیدا نشد.");

        foreach (var propertyId in promotions.Select(item => item.PropertyId).Distinct())
            await EnsureMutationAccessAsync(userId, role, ownerPropertyId, propertyId, cancellationToken);

        for (var index = 0; index < promotionIds.Count; index++)
        {
            var promotion = promotions.FirstOrDefault(item => item.Id == promotionIds[index]);
            if (promotion is null) continue;
            promotion.SortOrder = index;
            promotion.UpdatedByUserId = userId;
        }
        await dbContext.SaveChangesAsync(cancellationToken);
    }

    private IQueryable<Promotion> PromotionQuery() => dbContext.Promotions.AsNoTracking()
        .Include(promotion => promotion.Property)
        .Include(promotion => promotion.PromotionRoomTypes).ThenInclude(item => item.RoomType)
        .OrderBy(promotion => promotion.SortOrder).ThenByDescending(promotion => promotion.CreatedAtUtc);

    private async Task<Promotion> FindForMutationAsync(
        int userId, UserRole role, int? ownerPropertyId, int promotionId, CancellationToken cancellationToken)
    {
        var promotion = await dbContext.Promotions.SingleOrDefaultAsync(item => item.Id == promotionId, cancellationToken)
            ?? throw new KeyNotFoundException("پروموشن پیدا نشد.");
        await EnsureMutationAccessAsync(userId, role, ownerPropertyId, promotion.PropertyId, cancellationToken);
        return promotion;
    }

    private async Task EnsureMutationAccessAsync(
        int userId, UserRole role, int? ownerPropertyId, int? propertyId, CancellationToken cancellationToken)
    {
        if (ownerPropertyId.HasValue)
        {
            if (propertyId != ownerPropertyId.Value)
                throw new UnauthorizedAccessException("پروموشن به این اقامتگاه تعلق ندارد.");
            await EnsurePropertyAccessAsync(userId, role, ownerPropertyId.Value, cancellationToken);
            return;
        }

        if (role is not (UserRole.SuperAdmin or UserRole.AdminAssistant))
            throw new UnauthorizedAccessException("اجازه مدیریت پروموشن‌ها را ندارید.");
    }

    private async Task EnsurePropertyAccessAsync(int userId, UserRole role, int propertyId, CancellationToken cancellationToken)
    {
        if (!await propertyAccessService.CanManagePricingAsync(userId, role, propertyId, cancellationToken))
            throw new UnauthorizedAccessException("اجازه مدیریت پروموشن‌های این اقامتگاه را ندارید.");
    }

    private async Task<List<RoomType>> ValidateAsync(
        int? propertyId, PromotionUpsertRequest request, CancellationToken cancellationToken)
    {
        if (string.IsNullOrWhiteSpace(request.Title)) throw new ArgumentException("عنوان پروموشن الزامی است.");
        if (request.StartDate > request.EndDate) throw new ArgumentException("تاریخ شروع نمی‌تواند بعد از تاریخ پایان باشد.");
        if (request.Weekdays.Count == 0) throw new ArgumentException("حداقل یک روز هفته را انتخاب کنید.");

        var rooms = new List<RoomType>();
        if (propertyId.HasValue)
        {
            if (request.RoomTypeIds.Count == 0) throw new ArgumentException("حداقل یک اتاق را انتخاب کنید.");
            var roomIds = request.RoomTypeIds.Distinct().ToArray();
            rooms = await dbContext.RoomTypes.AsNoTracking()
                .Where(room => room.PropertyId == propertyId.Value && roomIds.Contains(room.Id) && room.IsActive)
                .ToListAsync(cancellationToken);
            if (rooms.Count != roomIds.Length) throw new ArgumentException("یک یا چند اتاق انتخاب‌شده معتبر نیست.");
        }

        if (request.Type is PromotionType.PercentageDiscount or PromotionType.LastMinute)
        {
            if (request.Percentage is null or < 0 or > 100)
                throw new ArgumentException("درصد تخفیف باید بین صفر تا صد باشد.");
        }
        if (request.Type == PromotionType.FixedAmountDiscount)
        {
            if (request.Amount is null or < 0) throw new ArgumentException("مبلغ تخفیف نمی‌تواند منفی باشد.");
            if (rooms.Any(room => room.BasePrice.HasValue && request.Amount > room.BasePrice.Value))
                throw new ArgumentException("مبلغ تخفیف نمی‌تواند از نرخ پایه اتاق بیشتر باشد.");
        }
        if (request.Type == PromotionType.LastMinute && request.LastMinuteDays is null or < 0)
            throw new ArgumentException("تعداد روزهای لحظه آخری معتبر نیست.");

        return rooms;
    }

    private static void Apply(Promotion promotion, PromotionUpsertRequest request)
    {
        promotion.Title = request.Title.Trim();
        promotion.InternalDescription = NullIfEmpty(request.InternalDescription);
        promotion.PublicDescription = NullIfEmpty(request.PublicDescription);
        promotion.StartDate = request.StartDate;
        promotion.EndDate = request.EndDate;
        promotion.Weekdays = ToWeekdayMask(request.Weekdays);
        promotion.Type = request.Type;
        promotion.Percentage = request.Type is PromotionType.PercentageDiscount or PromotionType.LastMinute ? request.Percentage : null;
        promotion.Amount = request.Type == PromotionType.FixedAmountDiscount ? request.Amount : null;
        promotion.LastMinuteDays = request.Type == PromotionType.LastMinute ? request.LastMinuteDays : null;
        promotion.SortOrder = request.SortOrder;
        promotion.IsActive = request.IsActive;
    }

    private async Task<PromotionResponse> GetResponseAsync(int promotionId, int? ownerPropertyId, CancellationToken cancellationToken)
    {
        var promotion = await PromotionQuery().SingleAsync(item => item.Id == promotionId, cancellationToken);
        return (await MapAsync([promotion], ownerPropertyId, cancellationToken))[0];
    }

    private async Task<IReadOnlyList<PromotionResponse>> MapAsync(
        List<Promotion> promotions, int? libraryPropertyId, CancellationToken cancellationToken)
    {
        var userIds = promotions.Where(item => item.CreatedByUserId.HasValue)
            .Select(item => item.CreatedByUserId!.Value).Distinct().ToArray();
        var users = await dbContext.Users.AsNoTracking().Where(user => userIds.Contains(user.Id))
            .ToDictionaryAsync(user => user.Id, user => (user.FirstName + " " + user.LastName).Trim(), cancellationToken);

        List<PromotionRoomTypeResponse> libraryRooms = libraryPropertyId.HasValue
            ? await dbContext.RoomTypes.AsNoTracking()
                .Where(room => room.PropertyId == libraryPropertyId.Value && room.IsActive)
                .OrderBy(room => room.Name)
                .Select(room => new PromotionRoomTypeResponse
                {
                    Id = room.Id,
                    Name = room.Name,
                    BasePrice = room.BasePrice
                })
                .ToListAsync(cancellationToken)
            : [];

        return promotions.Select(promotion =>
        {
            var isTemplate = promotion.PropertyId is null && promotion.Source == PromotionSource.Admin;
            var rooms = isTemplate && libraryPropertyId.HasValue
                ? libraryRooms
                : promotion.PromotionRoomTypes.OrderBy(item => item.RoomType.Name)
                    .Select(item => new PromotionRoomTypeResponse
                    {
                        Id = item.RoomTypeId,
                        Name = item.RoomType.Name,
                        BasePrice = item.RoomType.BasePrice
                    }).ToList();

            return new PromotionResponse
            {
                Id = promotion.Id,
                PropertyId = promotion.PropertyId ?? libraryPropertyId,
                PropertyName = promotion.Property?.Name ?? "کتابخانه پروموشن‌ها",
                Title = promotion.Title,
                InternalDescription = promotion.InternalDescription,
                PublicDescription = promotion.PublicDescription,
                StartDate = promotion.StartDate,
                EndDate = promotion.EndDate,
                Weekdays = FromWeekdayMask(promotion.Weekdays),
                Type = promotion.Type,
                Percentage = promotion.Percentage,
                Amount = promotion.Amount,
                LastMinuteDays = promotion.LastMinuteDays,
                SortOrder = promotion.SortOrder,
                IsActive = !isTemplate && promotion.IsActive,
                IsPublished = promotion.IsPublished,
                Source = promotion.Source,
                SourcePromotionId = promotion.SourcePromotionId,
                IsLibraryTemplate = isTemplate,
                CanEdit = promotion.Source == PromotionSource.Owner || (promotion.Source == PromotionSource.Admin && promotion.PropertyId is null),
                CreatedByUserId = promotion.CreatedByUserId,
                CreatedBy = promotion.CreatedByUserId.HasValue && users.TryGetValue(promotion.CreatedByUserId.Value, out var name) ? name : "سیستم",
                CreatedAtUtc = promotion.CreatedAtUtc,
                RoomTypes = rooms
            };
        }).ToList();
    }

    private async Task<List<RoomType>> GetActiveRoomsAsync(int propertyId, CancellationToken cancellationToken) =>
        await dbContext.RoomTypes.AsNoTracking()
            .Where(room => room.PropertyId == propertyId && room.IsActive)
            .OrderBy(room => room.Name)
            .ToListAsync(cancellationToken);

    private static Promotion CopyPromotion(
        Promotion source, int? targetPropertyId, int userId, PromotionSource sourceKind, bool isActive) =>
        new()
        {
            PropertyId = targetPropertyId,
            Title = sourceKind == PromotionSource.Owner ? $"کپی {source.Title}" : source.Title,
            InternalDescription = source.InternalDescription,
            PublicDescription = source.PublicDescription,
            StartDate = source.StartDate,
            EndDate = source.EndDate,
            Weekdays = source.Weekdays,
            Type = source.Type,
            Percentage = source.Percentage,
            Amount = source.Amount,
            LastMinuteDays = source.LastMinuteDays,
            SortOrder = source.SortOrder + 1,
            IsActive = isActive,
            IsPublished = false,
            Source = sourceKind,
            CreatedByUserId = userId
        };

    private static void ValidateAmountAgainstRooms(Promotion promotion, IReadOnlyList<RoomType> rooms)
    {
        if (promotion.Type != PromotionType.FixedAmountDiscount || promotion.Amount is null) return;
        if (rooms.Any(room => room.BasePrice.HasValue && promotion.Amount > room.BasePrice.Value))
            throw new ArgumentException("مبلغ تخفیف نمی‌تواند از نرخ پایه اتاق بیشتر باشد.");
    }

    private static int? NormalizePropertyId(int? propertyId) => propertyId is null or <= 0 ? null : propertyId;

    internal static PromotionWeekday ToWeekdayMask(IEnumerable<DayOfWeek> weekdays) =>
        weekdays.Aggregate(PromotionWeekday.None, (mask, day) => mask | day switch
        {
            DayOfWeek.Saturday => PromotionWeekday.Saturday,
            DayOfWeek.Sunday => PromotionWeekday.Sunday,
            DayOfWeek.Monday => PromotionWeekday.Monday,
            DayOfWeek.Tuesday => PromotionWeekday.Tuesday,
            DayOfWeek.Wednesday => PromotionWeekday.Wednesday,
            DayOfWeek.Thursday => PromotionWeekday.Thursday,
            DayOfWeek.Friday => PromotionWeekday.Friday,
            _ => PromotionWeekday.None
        });

    internal static IReadOnlyList<DayOfWeek> FromWeekdayMask(PromotionWeekday mask) =>
        Enum.GetValues<DayOfWeek>().Where(day => (ToWeekdayMask([day]) & mask) != 0).ToList();

    private static string? NullIfEmpty(string? value) => string.IsNullOrWhiteSpace(value) ? null : value.Trim();
}
