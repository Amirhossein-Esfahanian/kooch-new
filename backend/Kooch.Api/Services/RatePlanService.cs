using Kooch.Api.Data;
using Kooch.Api.Dtos.Properties;
using Kooch.Api.Entities;
using Microsoft.EntityFrameworkCore;

namespace Kooch.Api.Services;

public sealed class RatePlanService(KoochDbContext dbContext, IPropertyAccessService propertyAccessService) : IRatePlanService
{
    public async Task<IReadOnlyList<RatePlanResponse>> ListAsync(
        int userId, UserRole role, int propertyId, int roomTypeId, CancellationToken cancellationToken = default)
    {
        await EnsureRoomTypeAccessAsync(userId, role, propertyId, roomTypeId, cancellationToken);
        var plans = await dbContext.RatePlans.AsNoTracking()
            .Include(plan => plan.MealPlan)
            .Where(plan => plan.RoomTypeId == roomTypeId)
            .OrderBy(plan => plan.Name)
            .ThenBy(plan => plan.Id)
            .ToListAsync(cancellationToken);
        return plans.Select(Map).ToArray();
    }

    public async Task<RatePlanResponse> GetAsync(
        int userId, UserRole role, int propertyId, int roomTypeId, int ratePlanId, CancellationToken cancellationToken = default)
    {
        await EnsureRoomTypeAccessAsync(userId, role, propertyId, roomTypeId, cancellationToken);
        return await LoadResponseAsync(roomTypeId, ratePlanId, cancellationToken);
    }

    public async Task<RatePlanResponse> CreateAsync(
        int userId, UserRole role, int propertyId, int roomTypeId, CreateRatePlanRequest request, CancellationToken cancellationToken = default)
    {
        var roomType = await EnsureRoomTypeAccessAsync(userId, role, propertyId, roomTypeId, cancellationToken);
        await ValidateAsync(roomType, request, cancellationToken);
        var plan = new RatePlan { RoomTypeId = roomTypeId };
        Apply(plan, request);
        dbContext.RatePlans.Add(plan);
        await dbContext.SaveChangesAsync(cancellationToken);
        return await LoadResponseAsync(roomTypeId, plan.Id, cancellationToken);
    }

    public async Task<RatePlanResponse> UpdateAsync(
        int userId, UserRole role, int propertyId, int roomTypeId, int ratePlanId, UpdateRatePlanRequest request, CancellationToken cancellationToken = default)
    {
        var roomType = await EnsureRoomTypeAccessAsync(userId, role, propertyId, roomTypeId, cancellationToken);
        var plan = await LoadPlanAsync(roomTypeId, ratePlanId, cancellationToken);
        await ValidateAsync(roomType, request, cancellationToken);
        Apply(plan, request);
        await dbContext.SaveChangesAsync(cancellationToken);
        return await LoadResponseAsync(roomTypeId, ratePlanId, cancellationToken);
    }

    public async Task DeleteAsync(
        int userId, UserRole role, int propertyId, int roomTypeId, int ratePlanId, CancellationToken cancellationToken = default)
    {
        await EnsureRoomTypeAccessAsync(userId, role, propertyId, roomTypeId, cancellationToken);
        var plan = await LoadPlanAsync(roomTypeId, ratePlanId, cancellationToken);
        plan.IsActive = false;
        plan.IsDeleted = true;
        plan.DeletedAtUtc = DateTime.UtcNow;
        plan.DeletedByUserId = userId;
        await dbContext.SaveChangesAsync(cancellationToken);
    }

    public async Task<IReadOnlyList<MealPlanOptionResponse>> ListMealPlansAsync(
        int userId, UserRole role, int propertyId, CancellationToken cancellationToken = default)
    {
        if (!await dbContext.Properties.AsNoTracking().AnyAsync(item => item.Id == propertyId, cancellationToken))
            throw new KeyNotFoundException("Property not found.");
        await EnsureCanManageAsync(userId, role, propertyId, cancellationToken);
        return await dbContext.MealPlans.AsNoTracking()
            .OrderBy(plan => plan.Name)
            .Select(plan => new MealPlanOptionResponse { Id = plan.Id, Name = plan.Name, Slug = plan.Slug })
            .ToArrayAsync(cancellationToken);
    }

    private async Task<RoomType> EnsureRoomTypeAccessAsync(
        int userId, UserRole role, int propertyId, int roomTypeId, CancellationToken cancellationToken)
    {
        var roomType = await dbContext.RoomTypes.AsNoTracking()
            .SingleOrDefaultAsync(item => item.Id == roomTypeId && item.PropertyId == propertyId, cancellationToken)
            ?? throw new KeyNotFoundException("Room type not found.");
        await EnsureCanManageAsync(userId, role, propertyId, cancellationToken);
        return roomType;
    }

    private async Task EnsureCanManageAsync(int userId, UserRole role, int propertyId, CancellationToken cancellationToken)
    {
        if (!await propertyAccessService.CanManageRoomsAsync(userId, role, propertyId, cancellationToken))
            throw new UnauthorizedAccessException("Room management access is required.");
    }

    private async Task ValidateAsync(RoomType roomType, RatePlanWriteRequest request, CancellationToken cancellationToken)
    {
        if (string.IsNullOrWhiteSpace(request.Name) || request.Name.Trim().Length > 150)
            throw new ArgumentException("Rate plan name is required and must be at most 150 characters.");
        if (request.PriceModifierType != PriceModifierType.FixedAmount)
            throw new ArgumentException("Only fixed-amount rate plan modifiers are supported.");
        if (request.PriceModifierValue != decimal.Round(request.PriceModifierValue, 2) ||
            request.PriceModifierValue is < -9999999999999999.99m or > 9999999999999999.99m)
            throw new ArgumentException("Rate plan modifier must fit a two-decimal monetary amount.");
        if (request.MinimumNights is <= 0)
            throw new ArgumentException("Minimum nights must be positive.");
        if (request.MealPlanId.HasValue &&
            !await dbContext.MealPlans.AsNoTracking().AnyAsync(item => item.Id == request.MealPlanId.Value, cancellationToken))
            throw new ArgumentException("Meal plan not found.");
        if (request.CancellationPolicyId.HasValue &&
            !await dbContext.CancellationPolicies.AsNoTracking().AnyAsync(item =>
                item.Id == request.CancellationPolicyId.Value && item.PropertyId == roomType.PropertyId, cancellationToken))
            throw new ArgumentException("Cancellation policy does not belong to this property.");

        if (request.PriceModifierValue < 0)
        {
            // Current base and today's configured prices are known checks; future booking nights must be checked by pricing.
            if (roomType.BasePrice is > 0 && roomType.BasePrice.Value + request.PriceModifierValue <= 0)
                throw new ArgumentException("Rate plan modifier makes the room type base price non-positive.");
            var today = DateOnly.FromDateTime(DateTime.UtcNow);
            if (await dbContext.RoomDailyPrices.AsNoTracking().AnyAsync(item =>
                item.RoomTypeId == roomType.Id && item.Date == today && item.BasePrice > 0 &&
                item.BasePrice + request.PriceModifierValue <= 0, cancellationToken))
                throw new ArgumentException("Rate plan modifier makes a current daily price non-positive.");
        }
    }

    private static void Apply(RatePlan plan, RatePlanWriteRequest request)
    {
        plan.Name = request.Name.Trim();
        plan.MealPlanId = request.MealPlanId;
        plan.CancellationPolicyId = request.CancellationPolicyId;
        plan.PriceModifierType = request.PriceModifierType;
        plan.PriceModifierValue = request.PriceModifierValue;
        plan.MinimumNights = request.MinimumNights;
        plan.IsActive = request.IsActive;
    }

    private async Task<RatePlan> LoadPlanAsync(int roomTypeId, int ratePlanId, CancellationToken cancellationToken) =>
        await dbContext.RatePlans.SingleOrDefaultAsync(item =>
            item.Id == ratePlanId && item.RoomTypeId == roomTypeId, cancellationToken)
        ?? throw new KeyNotFoundException("Rate plan not found.");

    private async Task<RatePlanResponse> LoadResponseAsync(int roomTypeId, int ratePlanId, CancellationToken cancellationToken)
    {
        var plan = await dbContext.RatePlans.AsNoTracking()
            .Include(item => item.MealPlan)
            .SingleOrDefaultAsync(item => item.Id == ratePlanId && item.RoomTypeId == roomTypeId, cancellationToken)
            ?? throw new KeyNotFoundException("Rate plan not found.");
        return Map(plan);
    }

    private static RatePlanResponse Map(RatePlan plan) => new()
    {
        Id = plan.Id,
        RoomTypeId = plan.RoomTypeId,
        Name = plan.Name,
        MealPlanId = plan.MealPlanId,
        MealPlanName = plan.MealPlan?.Name,
        MealPlanSlug = plan.MealPlan?.Slug,
        CancellationPolicyId = plan.CancellationPolicyId,
        PriceModifierType = plan.PriceModifierType,
        PriceModifierValue = plan.PriceModifierValue,
        MinimumNights = plan.MinimumNights,
        IsActive = plan.IsActive
    };
}
