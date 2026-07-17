using Kooch.Api.Dtos.PropertyUsers;
using Kooch.Api.Entities;

namespace Kooch.Api.Services;

internal static class PropertyPermissionMatrixDefaults
{
    public static readonly PropertyPermissionGroupDefinition[] GroupDefinitions =
    [
        new("Dashboard", "داشبورد"),
        new("Properties", "اطلاعات اقامتگاه"),
        new("Rooms", "اتاق‌ها"),
        new("Pricing", "قیمت‌گذاری"),
        new("Inventory", "ظرفیت"),
        new("Bookings", "رزروها"),
        new("Reviews", "نظرات"),
        new("Users", "کاربران اقامتگاه"),
        new("Financial", "مالی"),
        new("Reports", "گزارش‌ها"),
        new("Settings", "تنظیمات اقامتگاه")
    ];

    public static readonly PropertyPermissionActionDefinition[] ActionDefinitions =
    [
        new("view", "مشاهده"),
        new("create", "ایجاد"),
        new("edit", "ویرایش"),
        new("delete", "حذف"),
        new("export", "خروجی")
    ];

    public static readonly string[] Groups = GroupDefinitions
        .Select(group => group.Key)
        .ToArray();

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

    public static PermissionMatrixDto CreateForRole(PropertyUserRole role)
    {
        if (role == PropertyUserRole.PropertyOwner)
        {
            return CreateOwner();
        }

        var matrix = CreateEmpty();

        void Allow(string group, bool create = false, bool edit = false, bool delete = false, bool export = false)
        {
            matrix[group] = new PermissionActionsDto
            {
                View = true,
                Create = create,
                Edit = edit,
                Delete = delete,
                Export = export
            };
        }

        switch (role)
        {
            case PropertyUserRole.Manager:
                Allow("Dashboard");
                Allow("Properties", create: true, edit: true);
                Allow("Rooms", create: true, edit: true, delete: true);
                Allow("Pricing", create: true, edit: true);
                Allow("Inventory", create: true, edit: true);
                Allow("Bookings", create: true, edit: true, delete: true, export: true);
                Allow("Reviews", edit: true, delete: true);
                Allow("Users", create: true, edit: true);
                Allow("Financial", export: true);
                Allow("Reports", export: true);
                Allow("Settings", edit: true);
                break;
            case PropertyUserRole.Reception:
                Allow("Dashboard");
                Allow("Rooms");
                Allow("Inventory");
                Allow("Bookings", create: true, edit: true, export: true);
                Allow("Reviews", edit: true);
                break;
            case PropertyUserRole.Accounting:
                Allow("Dashboard");
                Allow("Pricing");
                Allow("Financial", create: true, edit: true, export: true);
                Allow("Reports", export: true);
                break;
            case PropertyUserRole.Housekeeping:
                Allow("Dashboard");
                Allow("Rooms", edit: true);
                Allow("Inventory", edit: true);
                break;
            case PropertyUserRole.Custom:
            default:
                break;
        }

        return matrix;
    }
}

internal sealed record PropertyPermissionGroupDefinition(string Key, string Label);

internal sealed record PropertyPermissionActionDefinition(string Key, string Label);
