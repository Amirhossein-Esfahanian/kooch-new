using System.Text.Json;
using Kooch.Api.Data;
using Kooch.Api.Dtos.PropertyUsers;
using Kooch.Api.Entities;
using Kooch.Api.Services;
using Microsoft.EntityFrameworkCore;
using Xunit;

namespace Kooch.Api.Tests;

public sealed class PromotionDuplicationTests
{
    [Theory]
    [InlineData(PromotionSource.Owner, 2)]
    [InlineData(PromotionSource.Owner, 3)]
    [InlineData(PromotionSource.Admin, 2)]
    [InlineData(PromotionSource.Admin, 3)]
    public async Task OwnerCanCopyDestinationPromotionRegardlessOfSourceOrCreator(
        PromotionSource sourceKind, int creatorId)
    {
        await using var harness = await CreateHarnessAsync();
        var db = harness.DbContext;
        var source = await AddSourceAsync(db, 10, sourceKind, creatorId: creatorId);

        var result = await Service(db).DuplicateAsync(2, UserRole.Client, 10, source.Id);

        await AssertCopyAsync(db, source, result.Id, 2, 10, PromotionSource.Owner);
        Assert.Equal(new[] { 20 }, result.RoomTypes.Select(room => room.Id));
    }

    [Theory]
    [InlineData(true, false, false)]
    [InlineData(false, false, false)]
    [InlineData(false, true, false)]
    [InlineData(false, false, true)]
    public async Task OwnerCanCopyPublishedGlobalAdminTemplateWithoutActiveDateOrActivationRestrictions(
        bool isActive, bool futureDates, bool alreadyActivated)
    {
        await using var harness = await CreateHarnessAsync();
        var db = harness.DbContext;
        var source = await AddSourceAsync(db, null, PromotionSource.Admin,
            published: true, isActive: isActive, futureDates: futureDates);
        if (alreadyActivated)
        {
            db.Promotions.Add(new Promotion
            {
                PropertyId = 10, SourcePromotionId = source.Id, Source = PromotionSource.Admin,
                Title = "Existing activation", StartDate = source.StartDate, EndDate = source.EndDate
            });
            await db.SaveChangesAsync();
            db.ChangeTracker.Clear();
        }

        var result = await Service(db).DuplicateAsync(2, UserRole.Client, 10, source.Id);

        await AssertCopyAsync(db, source, result.Id, 2, 10, PromotionSource.Owner);
        Assert.Equal(new[] { 20, 21 }, result.RoomTypes.Select(room => room.Id).Order());
    }

    [Theory]
    [InlineData(false)]
    [InlineData(true)]
    public async Task OwnerCannotCopyAnotherPropertyEvenWithPricingPermissionOnBoth(bool canManageSource)
    {
        await using var harness = await CreateHarnessAsync(canManageSource: canManageSource);
        var db = harness.DbContext;
        var source = await AddSourceAsync(db, 11, PromotionSource.Owner, creatorId: 2);
        var access = new PropertyAccessService(db);
        Assert.True(await access.CanManagePricingAsync(2, UserRole.Client, 10));
        Assert.Equal(canManageSource, await access.CanManagePricingAsync(2, UserRole.Client, 11));

        await AssertDeniedWithoutCopyAsync(db, source.Id);
    }

    [Theory]
    [InlineData(PromotionSource.Admin, false)]
    [InlineData(PromotionSource.Owner, true)]
    [InlineData(PromotionSource.Owner, false)]
    public async Task OwnerCannotCopyOtherGlobalSources(PromotionSource sourceKind, bool published)
    {
        await using var harness = await CreateHarnessAsync();
        var db = harness.DbContext;
        var source = await AddSourceAsync(db, null, sourceKind, published: published);

        await AssertDeniedWithoutCopyAsync(db, source.Id);
    }

    [Theory]
    [InlineData(false)]
    [InlineData(true)]
    public async Task AllowedSourceStillRequiresDestinationPricingEdit(bool globalTemplate)
    {
        await using var harness = await CreateHarnessAsync(canManageDestination: false);
        var db = harness.DbContext;
        var source = await AddSourceAsync(db, globalTemplate ? null : 10,
            globalTemplate ? PromotionSource.Admin : PromotionSource.Owner, published: true);
        var access = new PropertyAccessService(db);
        Assert.True(await access.CanViewAsync(2, UserRole.Client, 10));
        Assert.False(await access.CanManagePricingAsync(2, UserRole.Client, 10));

        await AssertDeniedWithoutCopyAsync(db, source.Id);
    }

    [Theory]
    [InlineData(false)]
    [InlineData(true)]
    public async Task MissingOrDeletedSourceRemainsNotFound(bool deleted)
    {
        await using var harness = await CreateHarnessAsync();
        var db = harness.DbContext;
        var source = await AddSourceAsync(db, 10, PromotionSource.Owner);
        source.IsDeleted = deleted;
        if (deleted)
        {
            db.Promotions.Update(source);
            await db.SaveChangesAsync();
            db.ChangeTracker.Clear();
        }
        var count = await db.Promotions.IgnoreQueryFilters().CountAsync();

        await Assert.ThrowsAsync<KeyNotFoundException>(() => Service(db).DuplicateAsync(
            2, UserRole.Client, 10, deleted ? source.Id : int.MaxValue));

        Assert.Equal(count, await db.Promotions.IgnoreQueryFilters().CountAsync());
    }

    [Theory]
    [InlineData(null, PromotionSource.Admin)]
    [InlineData(null, PromotionSource.Owner)]
    [InlineData(11, PromotionSource.Owner)]
    public async Task AdminDuplicationKeepsExistingScopeAndDefaults(int? propertyId, PromotionSource sourceKind)
    {
        await using var harness = await CreateHarnessAsync();
        var db = harness.DbContext;
        var source = await AddSourceAsync(db, propertyId, sourceKind);

        var result = await Service(db).DuplicateAsync(1, UserRole.SuperAdmin, null, source.Id);

        await AssertCopyAsync(db, source, result.Id, 1, propertyId, sourceKind);
    }

    private static PromotionService Service(KoochDbContext db)
    {
        var access = new PropertyAccessService(db);
        return new PromotionService(db, access, new PermissionService(db, access));
    }

    private static async Task<ReservationTestHarness> CreateHarnessAsync(
        bool canManageDestination = true, bool canManageSource = false)
    {
        var harness = await ReservationTestHarness.CreateAsync();
        var db = harness.DbContext;
        db.Properties.Add(new Property
        {
            Id = 11, OwnerId = 3, DestinationId = 1, Name = "Other property", Slug = "other-property"
        });
        db.RoomTypes.Add(new RoomType
        {
            Id = 22, PropertyId = 11, Name = "Other room", Slug = "other-room", IsActive = true
        });
        db.UserPropertyAccesses.Add(Membership(10, PropertyUserRole.PropertyOwner, canManageDestination));
        if (canManageSource)
            db.UserPropertyAccesses.Add(Membership(11, PropertyUserRole.Manager, true));
        await db.SaveChangesAsync();
        db.ChangeTracker.Clear();
        return harness;
    }

    private static UserPropertyAccess Membership(int propertyId, PropertyUserRole role, bool canManage) => new()
    {
        UserId = 2, PropertyId = propertyId, PropertyRole = role,
        Status = PropertyUserStatus.Active, IsActive = true,
        PermissionMatrixJson = JsonSerializer.Serialize(new PermissionMatrixDto
        {
            ["Pricing"] = new PermissionActionsDto { View = true, Edit = canManage }
        })
    };

    private static async Task<Promotion> AddSourceAsync(KoochDbContext db, int? propertyId,
        PromotionSource sourceKind, bool published = false, bool isActive = true,
        bool futureDates = false, int creatorId = 3)
    {
        var source = new Promotion
        {
            PropertyId = propertyId, Source = sourceKind, CreatedByUserId = creatorId,
            Title = "Source promotion", InternalDescription = "Internal details", PublicDescription = "Public details",
            Type = PromotionType.PercentageDiscount, Percentage = 10, SortOrder = 7,
            StartDate = new DateOnly(futureDates ? 2090 : 2000, 1, 1),
            EndDate = new DateOnly(futureDates ? 2090 : 2000, 1, 31),
            IsPublished = published, IsActive = isActive,
            PromotionRoomTypes = propertyId.HasValue
                ? [new PromotionRoomType { RoomTypeId = propertyId == 10 ? 20 : 22 }]
                : []
        };
        db.Promotions.Add(source);
        await db.SaveChangesAsync();
        db.ChangeTracker.Clear();
        return source;
    }

    private static async Task AssertDeniedWithoutCopyAsync(KoochDbContext db, int sourceId)
    {
        var count = await db.Promotions.IgnoreQueryFilters().CountAsync();
        await Assert.ThrowsAsync<UnauthorizedAccessException>(() =>
            Service(db).DuplicateAsync(2, UserRole.Client, 10, sourceId));
        Assert.Equal(count, await db.Promotions.IgnoreQueryFilters().CountAsync());
        Assert.DoesNotContain(db.ChangeTracker.Entries<Promotion>(), entry => entry.State == EntityState.Added);
    }

    private static async Task AssertCopyAsync(KoochDbContext db, Promotion source, int copyId,
        int actorId, int? propertyId, PromotionSource sourceKind)
    {
        var copy = await db.Promotions.AsNoTracking().SingleAsync(item => item.Id == copyId);
        Assert.NotEqual(source.Id, copy.Id);
        Assert.Equal(propertyId, copy.PropertyId);
        Assert.Equal(sourceKind, copy.Source);
        Assert.Equal(actorId, copy.CreatedByUserId);
        Assert.False(copy.IsActive);
        Assert.False(copy.IsPublished);
        Assert.Null(copy.SourcePromotionId);
        Assert.Equal(sourceKind == PromotionSource.Owner ? $"کپی {source.Title}" : source.Title, copy.Title);
        Assert.Equal(source.SortOrder + 1, copy.SortOrder);
        Assert.Equal(source.InternalDescription, copy.InternalDescription);
        Assert.Equal(source.PublicDescription, copy.PublicDescription);
        Assert.Equal(source.Type, copy.Type);
        Assert.Equal(source.Percentage, copy.Percentage);
        Assert.Equal(source.StartDate, copy.StartDate);
        Assert.Equal(source.EndDate, copy.EndDate);
        var unchanged = await db.Promotions.AsNoTracking().SingleAsync(item => item.Id == source.Id);
        Assert.Equal(source.IsActive, unchanged.IsActive);
        Assert.Equal(source.IsPublished, unchanged.IsPublished);
    }
}
