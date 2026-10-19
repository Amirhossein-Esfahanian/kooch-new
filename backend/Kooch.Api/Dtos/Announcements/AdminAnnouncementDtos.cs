using System.ComponentModel.DataAnnotations;
using Kooch.Api.Entities;

namespace Kooch.Api.Dtos.Announcements;

public sealed record SendAdminAnnouncementRequest(
    [property: Required, MaxLength(200)] string IdempotencyKey,
    [property: Required, MaxLength(200)] string Title,
    [property: Required, MaxLength(4000)] string Body,
    AdminAnnouncementTarget Target,
    IReadOnlyList<int>? RecipientUserIds);

public sealed record AdminAnnouncementResponse(
    int Id, string Title, string Body, AdminAnnouncementTarget Target,
    int SenderUserId, DateTime SentAtUtc, int RecipientCount,
    IReadOnlyList<int> RecipientUserIds);

public sealed class AdminAnnouncementRecipientSearchQuery
{
    [EnumDataType(typeof(AdminAnnouncementTarget))]
    public AdminAnnouncementTarget Target { get; set; }

    [MaxLength(200)]
    public string? Search { get; set; }

    [Range(1, int.MaxValue)]
    public int Page { get; set; } = 1;

    [Range(1, 100)]
    public int PageSize { get; set; } = 20;
}

public sealed record AdminAnnouncementRecipientOption(int Id, string DisplayName);
