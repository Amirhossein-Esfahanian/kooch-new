using System.ComponentModel.DataAnnotations;

namespace Kooch.Api.Dtos.PropertySettings;

public sealed class PropertySettingResponse
{
    public int Id { get; set; }
    public string Name { get; set; } = string.Empty;
    public string Slug { get; set; } = string.Empty;
    public int SortOrder { get; set; }
    public bool IsActive { get; set; }
}

public sealed class PropertySettingAssignmentResponse
{
    public int Id { get; set; }
    public string Name { get; set; } = string.Empty;
    public string Slug { get; set; } = string.Empty;
    public bool IsActive { get; set; }
}

public sealed class CreatePropertySettingRequest
{
    [Required(ErrorMessage = "نام بافت و موقعیت الزامی است.")]
    [MaxLength(150, ErrorMessage = "نام بافت و موقعیت نمی‌تواند بیشتر از ۱۵۰ نویسه باشد.")]
    public string Name { get; set; } = string.Empty;

    [Required(ErrorMessage = "نامک بافت و موقعیت الزامی است.")]
    [MaxLength(170, ErrorMessage = "نامک بافت و موقعیت نمی‌تواند بیشتر از ۱۷۰ نویسه باشد.")]
    public string Slug { get; set; } = string.Empty;

    public int SortOrder { get; set; }
    public bool IsActive { get; set; } = true;
}

public sealed class UpdatePropertySettingRequest
{
    [Required(ErrorMessage = "نام بافت و موقعیت الزامی است.")]
    [MaxLength(150, ErrorMessage = "نام بافت و موقعیت نمی‌تواند بیشتر از ۱۵۰ نویسه باشد.")]
    public string Name { get; set; } = string.Empty;

    public int SortOrder { get; set; }
    public bool IsActive { get; set; } = true;
}

public sealed class SetPropertySettingsRequest
{
    [Required]
    public IReadOnlyCollection<int> PropertySettingIds { get; set; } = [];
}
