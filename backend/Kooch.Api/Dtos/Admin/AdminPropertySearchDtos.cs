using System.ComponentModel.DataAnnotations;

namespace Kooch.Api.Dtos.Admin;

public sealed class AdminPropertySearchQuery
{
    [MaxLength(200)]
    public string? Search { get; set; }

    [Range(1, int.MaxValue)]
    public int Page { get; set; } = 1;

    [Range(1, 25)]
    public int PageSize { get; set; } = 10;
}

public sealed class AdminPropertySearchItemResponse
{
    public int Id { get; set; }
    public string Name { get; set; } = string.Empty;
    public string? EnglishName { get; set; }
    public string City { get; set; } = string.Empty;
    public string OwnerName { get; set; } = string.Empty;
    public string OwnerEmail { get; set; } = string.Empty;
}
