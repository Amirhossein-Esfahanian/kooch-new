using System.Data;
using Kooch.Api.Data;
using Kooch.Api.Dtos.WelcomeGifts;
using Kooch.Api.Entities;
using Microsoft.EntityFrameworkCore;

namespace Kooch.Api.Services;

public interface IWelcomeGiftCampaignService
{
    Task<IReadOnlyList<WelcomeGiftCampaignResponse>> ListAsync(CancellationToken cancellationToken = default);
    Task<WelcomeGiftCampaignResponse> GetAsync(int id, CancellationToken cancellationToken = default);
    Task<WelcomeGiftCampaignResponse> CreateAsync(int actorUserId, WelcomeGiftCampaignUpsertRequest request, CancellationToken cancellationToken = default);
    Task<WelcomeGiftCampaignResponse> UpdateAsync(int actorUserId, int id, WelcomeGiftCampaignUpsertRequest request, CancellationToken cancellationToken = default);
    Task DeleteAsync(int actorUserId, int id, CancellationToken cancellationToken = default);
}

public sealed class WelcomeGiftCampaignService(KoochDbContext dbContext) : IWelcomeGiftCampaignService
{
    public async Task<IReadOnlyList<WelcomeGiftCampaignResponse>> ListAsync(CancellationToken cancellationToken = default) =>
        await dbContext.WelcomeGiftCampaigns.AsNoTracking()
            .OrderByDescending(campaign => campaign.StartDate)
            .ThenByDescending(campaign => campaign.Id)
            .Select(campaign => Map(campaign))
            .ToListAsync(cancellationToken);

    public async Task<WelcomeGiftCampaignResponse> GetAsync(int id, CancellationToken cancellationToken = default) =>
        Map(await dbContext.WelcomeGiftCampaigns.AsNoTracking()
            .SingleOrDefaultAsync(campaign => campaign.Id == id, cancellationToken)
            ?? throw new KeyNotFoundException("Welcome Gift campaign was not found."));

    public async Task<WelcomeGiftCampaignResponse> CreateAsync(
        int actorUserId, WelcomeGiftCampaignUpsertRequest request, CancellationToken cancellationToken = default)
    {
        Validate(request);
        await using var transaction = dbContext.Database.IsRelational()
            ? await dbContext.Database.BeginTransactionAsync(IsolationLevel.Serializable, cancellationToken)
            : null;

        await EnsureNoActiveOverlapAsync(request, null, cancellationToken);
        var campaign = new WelcomeGiftCampaign { CreatedByUserId = actorUserId };
        Apply(campaign, request);
        dbContext.WelcomeGiftCampaigns.Add(campaign);
        await dbContext.SaveChangesAsync(cancellationToken);
        if (transaction is not null) await transaction.CommitAsync(cancellationToken);
        return Map(campaign);
    }

    public async Task<WelcomeGiftCampaignResponse> UpdateAsync(
        int actorUserId, int id, WelcomeGiftCampaignUpsertRequest request, CancellationToken cancellationToken = default)
    {
        Validate(request);
        await using var transaction = dbContext.Database.IsRelational()
            ? await dbContext.Database.BeginTransactionAsync(IsolationLevel.Serializable, cancellationToken)
            : null;

        var campaign = await dbContext.WelcomeGiftCampaigns
            .SingleOrDefaultAsync(item => item.Id == id, cancellationToken)
            ?? throw new KeyNotFoundException("Welcome Gift campaign was not found.");
        if (request.MaxRecipients < campaign.GrantedCount)
            throw new ArgumentException("MaxRecipients cannot be lower than the already granted count.");
        await EnsureNoActiveOverlapAsync(request, id, cancellationToken);

        Apply(campaign, request);
        campaign.UpdatedByUserId = actorUserId;
        await dbContext.SaveChangesAsync(cancellationToken);
        if (transaction is not null) await transaction.CommitAsync(cancellationToken);
        return Map(campaign);
    }

    public async Task DeleteAsync(int actorUserId, int id, CancellationToken cancellationToken = default)
    {
        var campaign = await dbContext.WelcomeGiftCampaigns
            .SingleOrDefaultAsync(item => item.Id == id, cancellationToken)
            ?? throw new KeyNotFoundException("Welcome Gift campaign was not found.");
        campaign.IsActive = false;
        campaign.IsDeleted = true;
        campaign.DeletedAtUtc = DateTime.UtcNow;
        campaign.DeletedByUserId = actorUserId;
        await dbContext.SaveChangesAsync(cancellationToken);
    }

    private async Task EnsureNoActiveOverlapAsync(
        WelcomeGiftCampaignUpsertRequest request, int? currentId, CancellationToken cancellationToken)
    {
        if (!request.IsActive) return;
        if (await dbContext.WelcomeGiftCampaigns.AsNoTracking().AnyAsync(
                campaign => campaign.IsActive &&
                            (!currentId.HasValue || campaign.Id != currentId.Value) &&
                            campaign.StartDate <= request.EndDate && request.StartDate <= campaign.EndDate,
                cancellationToken))
        {
            throw new ArgumentException("Active Welcome Gift campaign date ranges cannot overlap.");
        }
    }

    private static void Validate(WelcomeGiftCampaignUpsertRequest request)
    {
        if (string.IsNullOrWhiteSpace(request.Title) || request.Title.Trim().Length > 150)
            throw new ArgumentException("Title is required and must be at most 150 characters.");
        if (request.Amount <= 0 || decimal.Round(request.Amount, 2) != request.Amount)
            throw new ArgumentException("Amount must be positive and have at most two decimal places.");
        if (request.MaxRecipients <= 0)
            throw new ArgumentException("MaxRecipients must be positive.");
        if (request.ValidityDays < 1)
            throw new ArgumentException("ValidityDays must be at least one.");
        if (request.StartDate > request.EndDate)
            throw new ArgumentException("StartDate must be on or before EndDate.");
    }

    private static void Apply(WelcomeGiftCampaign campaign, WelcomeGiftCampaignUpsertRequest request)
    {
        campaign.Title = request.Title.Trim();
        campaign.Amount = request.Amount;
        campaign.StartDate = request.StartDate;
        campaign.EndDate = request.EndDate;
        campaign.MaxRecipients = request.MaxRecipients;
        campaign.ValidityDays = request.ValidityDays;
        campaign.IsActive = request.IsActive;
    }

    private static WelcomeGiftCampaignResponse Map(WelcomeGiftCampaign campaign) => new(
        campaign.Id, campaign.Title, campaign.Amount, campaign.StartDate, campaign.EndDate,
        campaign.MaxRecipients, campaign.GrantedCount, campaign.ValidityDays, campaign.IsActive,
        campaign.CreatedAtUtc, campaign.UpdatedAtUtc);
}
