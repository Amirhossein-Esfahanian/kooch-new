namespace Kooch.Api.Dtos.WelcomeGifts;

public sealed record WelcomeGiftCampaignUpsertRequest(
    string Title,
    decimal Amount,
    DateOnly StartDate,
    DateOnly EndDate,
    int MaxRecipients,
    int ValidityDays,
    bool IsActive);

public sealed record WelcomeGiftCampaignResponse(
    int Id,
    string Title,
    decimal Amount,
    DateOnly StartDate,
    DateOnly EndDate,
    int MaxRecipients,
    int GrantedCount,
    int ValidityDays,
    bool IsActive,
    DateTime CreatedAtUtc,
    DateTime? UpdatedAtUtc);
