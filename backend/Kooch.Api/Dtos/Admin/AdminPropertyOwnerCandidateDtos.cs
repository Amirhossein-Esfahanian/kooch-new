using System.ComponentModel.DataAnnotations;

namespace Kooch.Api.Dtos.Admin;

public sealed class AdminPropertyOwnerCandidateQuery
{
    [MaxLength(200)]
    public string? Search { get; set; }

    [Range(1, int.MaxValue)]
    public int Page { get; set; } = 1;

    [Range(1, 25)]
    public int PageSize { get; set; } = 10;

    [Range(1, int.MaxValue)]
    public int? ExcludeUserId { get; set; }
}

public sealed class AdminPropertyOwnerCandidateResponse
{
    public int Id { get; set; }
    public string FirstName { get; set; } = string.Empty;
    public string LastName { get; set; } = string.Empty;
    public string FullName { get; set; } = string.Empty;
    public string? PhoneNumber { get; set; }
    public string? Email { get; set; }
}

public sealed class AdminPropertyOwnerCandidatePageResponse
{
    public IReadOnlyList<AdminPropertyOwnerCandidateResponse> Items { get; set; } = [];
    public int TotalCount { get; set; }
    public int Page { get; set; }
    public int PageSize { get; set; }
    public int TotalPages { get; set; }
}
