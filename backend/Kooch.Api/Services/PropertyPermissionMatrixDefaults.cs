using Kooch.Api.Dtos.PropertyUsers;

namespace Kooch.Api.Services;

internal static class PropertyPermissionMatrixDefaults
{
    public static readonly string[] Groups =
    [
        "Dashboard",
        "Properties",
        "Rooms",
        "Pricing",
        "Inventory",
        "Bookings",
        "Reviews",
        "Users",
        "Financial",
        "Reports",
        "Settings"
    ];

    public static PermissionMatrixDto CreateOwner()
    {
        var matrix = new PermissionMatrixDto();
        foreach (var group in Groups)
        {
            matrix[group] = new PermissionActionsDto
            {
                View = true,
                Create = true,
                Edit = true,
                Delete = true,
                Export = true
            };
        }

        return matrix;
    }

    public static PermissionMatrixDto CreateEmpty()
    {
        var matrix = new PermissionMatrixDto();
        foreach (var group in Groups)
        {
            matrix[group] = new PermissionActionsDto();
        }

        return matrix;
    }
}
