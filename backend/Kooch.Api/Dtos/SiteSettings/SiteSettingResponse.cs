using Kooch.Api.Entities;

namespace Kooch.Api.Dtos.SiteSettings;

public sealed record SiteSettingResponse(
    int Id,
    string Key,
    string Value,
    SiteSettingType Type,
    string Group,
    string Label,
    string? Description,
    int SortOrder,
    bool IsActive,
    DateTime CreatedAtUtc,
    DateTime? UpdatedAtUtc);
