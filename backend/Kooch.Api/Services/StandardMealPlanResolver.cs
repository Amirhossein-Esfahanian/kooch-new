using Kooch.Api.Entities;

namespace Kooch.Api.Services;

internal static class StandardMealPlanResolver
{
    public static MealPlan? Resolve(RoomType roomType, Property property)
    {
        if (roomType.DefaultMealPlan is { IsDeleted: false } roomTypeMealPlan)
            return roomTypeMealPlan;

        return property.DefaultMealPlan is { IsDeleted: false } propertyMealPlan
            ? propertyMealPlan
            : null;
    }
}
