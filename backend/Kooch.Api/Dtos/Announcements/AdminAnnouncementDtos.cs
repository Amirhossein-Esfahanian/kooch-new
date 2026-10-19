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
