using System.ComponentModel.DataAnnotations;
using Kooch.Api.Entities;

namespace Kooch.Api.Dtos.Admin;

public sealed class AdminPropertyMemberDirectoryQuery
{
    [MaxLength(200)]
    public string? Search { get; set; }

    [Range(1, int.MaxValue)]
    public int? PropertyId { get; set; }

    [EnumDataType(typeof(PropertyUserRole))]
    public PropertyUserRole? Role { get; set; }

    [EnumDataType(typeof(PropertyUserStatus))]
    public PropertyUserStatus? Status { get; set; }

    [Range(1, int.MaxValue)]
    public int Page { get; set; } = 1;

    [Range(1, 100)]
    public int PageSize { get; set; } = 20;
}

public sealed class AdminPropertyMemberDirectoryResponse
{
    public int Id { get; set; }
    public string FirstName { get; set; } = string.Empty;
    public string LastName { get; set; } = string.Empty;
    public string? PhoneNumber { get; set; }
    public string? Email { get; set; }
    public bool IsActive { get; set; }
    public IReadOnlyList<AdminPropertyMembershipResponse> Memberships { get; set; } = [];
}

public sealed class AdminPropertyMembershipResponse
{
    public int PropertyId { get; set; }
    public string PropertyName { get; set; } = string.Empty;
    public PropertyUserRole Role { get; set; }
    public PropertyUserStatus Status { get; set; }
    public bool IsActive { get; set; }
    public bool IsOwner { get; set; }
}
