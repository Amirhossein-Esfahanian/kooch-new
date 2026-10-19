namespace Kooch.Api.Entities;

public enum AdminAnnouncementTarget
{
    SelectedAdmins = 0,
    SelectedPropertyOwners = 1,
    AllAdmins = 2,
    AllPropertyOwners = 3
}

public sealed class AdminAnnouncement : BaseEntity
{
    public int SenderUserId { get; set; }
    public string Title { get; set; } = string.Empty;
    public string Body { get; set; } = string.Empty;
    public AdminAnnouncementTarget Target { get; set; }
    public DateTime SentAtUtc { get; set; }
    public string IdempotencyKey { get; set; } = string.Empty;
    public string RequestFingerprint { get; set; } = string.Empty;
    public User SenderUser { get; set; } = null!;
    public ICollection<AdminAnnouncementRecipient> Recipients { get; set; } = [];
}

public sealed class AdminAnnouncementRecipient : BaseEntity
{
    public int AnnouncementId { get; set; }
    public int UserId { get; set; }
    public AdminAnnouncement Announcement { get; set; } = null!;
    public User User { get; set; } = null!;
}
