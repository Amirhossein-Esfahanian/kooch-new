using System.Text.Json;
using Kooch.Api.Data;
using Kooch.Api.Dtos.Admin;
using Kooch.Api.Dtos.Properties;
using Kooch.Api.Dtos.Users;
using Kooch.Api.Dtos.PropertyUsers;
using Kooch.Api.Entities;
using Kooch.Api.Utilities;
using Kooch.Api.Exceptions;
using Microsoft.EntityFrameworkCore;

namespace Kooch.Api.Services;

public class PropertyService(
    KoochDbContext dbContext,
    IPropertyAccessService propertyAccessService,
    IPropertyAuthorizationService propertyAuthorizationService,
    IPermissionService permissionService,
    IPropertyCompletionService propertyCompletionService,
    IChildPricingRuleResolver childPricingRuleResolver) : IPropertyService
{
    private const InventoryMode CanonicalPublicInventoryMode = InventoryMode.TypeBasedInventory;

    public async Task<PropertyResponse> CreatePropertyAsync(
        int userId,
        UserRole role,
        CreatePropertyRequest request,
        CancellationToken cancellationToken = default)
    {
        var canCreateAsAdmin = role == UserRole.SuperAdmin ||
                               role == UserRole.AdminAssistant &&
                               await HasGlobalManagePermissionAsync(userId, cancellationToken);
        if (!canCreateAsAdmin)
        {
            throw new UnauthorizedAccessException("Property creation is admin-only.");
        }

        PropertyCoordinateValidator.EnsureValid(request.Latitude, request.Longitude);

        if (!request.OwnerId.HasValue)
        {
            throw new ArgumentException("The selected owner is required.");
        }

        var ownerId = request.OwnerId.Value;
        await EnsureCanonicalOwnerAccountAsync(ownerId, cancellationToken);

        await ValidateDestinationAsync(request.DestinationId, cancellationToken);
        var englishName = CleanOptional(request.EnglishName);
        var slug = EnglishSlugGenerator.Create(englishName, "property");
        await EnsureUniqueSlugAsync(slug, null, cancellationToken);

        var property = new Property
        {
            OwnerId = ownerId,
            DestinationId = request.DestinationId,
            Name = request.Name.Trim(),
            EnglishName = englishName,
            Slug = slug,
            Description = request.Description.Trim(),
            SeoTitle = CleanOptional(request.SeoTitle),
            SeoDescription = CleanOptional(request.SeoDescription),
            Address = request.Address.Trim(),
            City = request.City.Trim(),
            Country = request.Country.Trim(),
            Latitude = request.Latitude,
            Longitude = request.Longitude,
            Type = request.Type,
            InventoryMode = CanonicalPublicInventoryMode,
            CheckInTime = request.CheckInTime,
            CheckOutTime = request.CheckOutTime,
            BreakfastOption = request.BreakfastOption,
            BreakfastPrice = request.BreakfastOption == BreakfastOption.Paid ? request.BreakfastPrice : null,
            HasElevator = request.HasElevator,
            IsWheelchairAccessible = request.IsWheelchairAccessible,
            HasGroundFloorRoom = request.HasGroundFloorRoom,
            HasAccessibleBathroom = request.HasAccessibleBathroom,
            FreeChildAgeLimit = request.FreeChildAgeLimit,
            MaxFreeChildren = request.MaxFreeChildren,
            ChildPrice = request.ChildPrice,
            ExtraGuestPrice = request.ExtraGuestPrice,
            Status = request.Status == PropertyStatus.Approved
                ? PropertyStatus.Draft
                : request.Status ?? PropertyStatus.Draft
        };

        Microsoft.EntityFrameworkCore.Storage.IDbContextTransaction? transaction = null;
        if (dbContext.Database.IsRelational())
        {
            transaction = await dbContext.Database.BeginTransactionAsync(cancellationToken);
        }

        try
        {
            dbContext.Properties.Add(property);
            await dbContext.SaveChangesAsync(cancellationToken);
            await EnsureCanonicalOwnerMembershipAsync(property.Id, null, ownerId, cancellationToken);
            await dbContext.SaveChangesAsync(cancellationToken);
            if (string.IsNullOrWhiteSpace(englishName))
            {
                property.Slug = EnglishSlugGenerator.CreateWithEntityFallback(englishName, "property", property.Id);
                await EnsureUniqueSlugAsync(property.Slug, property.Id, cancellationToken);
                await dbContext.SaveChangesAsync(cancellationToken);
            }

            await EnsureExactlyOneActiveOwnerMembershipAsync(property.Id, ownerId, cancellationToken);

            if (transaction is not null)
            {
                await transaction.CommitAsync(cancellationToken);
            }
        }
        catch
        {
            if (transaction is not null)
            {
                await transaction.RollbackAsync(cancellationToken);
            }

            throw;
        }

        return await LoadResponseAsync(property.Id, cancellationToken);
    }

    public async Task<PropertyResponse> UpdatePropertyAsync(
        int userId,
        UserRole role,
        int propertyId,
        UpdatePropertyRequest request,
        CancellationToken cancellationToken = default)
    {
        var property = await GetEntityAsync(propertyId, cancellationToken);
        if (!await propertyAccessService.CanManagePropertyAsync(userId, role, propertyId, cancellationToken))
        {
            throw new UnauthorizedAccessException("You cannot manage this property.");
        }

        PropertyCoordinateValidator.EnsureValid(request.Latitude, request.Longitude);

        await ValidateDestinationAsync(request.DestinationId, cancellationToken);
        var englishName = request.EnglishName is null
            ? property.EnglishName
            : CleanOptional(request.EnglishName);
        var slug = EnglishSlugGenerator.CreateWithEntityFallback(englishName, "property", property.Id, property.Slug);
        await EnsureUniqueSlugAsync(slug, propertyId, cancellationToken);

        property.DestinationId = request.DestinationId;
        property.Name = request.Name.Trim();
        property.EnglishName = englishName;
        property.Slug = slug;
        property.Description = request.Description.Trim();
        property.SeoTitle = CleanOptional(request.SeoTitle);
        property.SeoDescription = CleanOptional(request.SeoDescription);
        property.Address = request.Address.Trim();
        property.City = request.City.Trim();
        property.Country = request.Country.Trim();
        property.Latitude = request.Latitude;
        property.Longitude = request.Longitude;
        property.Type = request.Type;
        property.InventoryMode = request.InventoryMode;
        property.CheckInTime = request.CheckInTime;
        property.CheckOutTime = request.CheckOutTime;
        property.BreakfastOption = request.BreakfastOption;
        property.BreakfastPrice = request.BreakfastOption == BreakfastOption.Paid ? request.BreakfastPrice : null;
        property.TotalAreaM2 = request.TotalAreaM2;
        property.LandAreaM2 = request.LandAreaM2;
        property.FloorsCount = request.FloorsCount;
        property.StairCount = request.StairCount;
        property.HasElevator = request.HasElevator;
        property.IsWheelchairAccessible = request.IsWheelchairAccessible;
        property.HasGroundFloorRoom = request.HasGroundFloorRoom;
        property.HasAccessibleBathroom = request.HasAccessibleBathroom;
        property.FreeChildAgeLimit = request.FreeChildAgeLimit;
        property.MaxFreeChildren = request.MaxFreeChildren;
        property.ChildPrice = request.ChildPrice;
        property.ExtraGuestPrice = request.ExtraGuestPrice;

        await dbContext.SaveChangesAsync(cancellationToken);
        return await LoadResponseAsync(property.Id, cancellationToken);
    }

    public async Task<PropertyResponse> UpdateBasicSectionAsync(
        int userId,
        UserRole role,
        int propertyId,
        UpdatePropertyBasicSectionRequest request,
        CancellationToken cancellationToken = default)
    {
        var property = await GetManageableEntityAsync(userId, role, propertyId, cancellationToken);
        var englishName = CleanOptional(request.EnglishName);
        var slug = EnglishSlugGenerator.CreateWithEntityFallback(englishName, "property", property.Id, property.Slug);
        await EnsureUniqueSlugAsync(slug, propertyId, cancellationToken);

        property.Name = request.Name.Trim();
        property.EnglishName = englishName;
        property.Slug = slug;
        property.Type = request.Type;
        property.InventoryMode = request.InventoryMode;
        await dbContext.SaveChangesAsync(cancellationToken);
        return await LoadResponseAsync(propertyId, cancellationToken);
    }

    public async Task<PropertyResponse> UpdateLocationSectionAsync(
        int userId,
        UserRole role,
        int propertyId,
        UpdatePropertyLocationSectionRequest request,
        CancellationToken cancellationToken = default)
    {
        var property = await GetManageableEntityAsync(userId, role, propertyId, cancellationToken);
        PropertyCoordinateValidator.EnsureValid(request.Latitude, request.Longitude);
        await ValidateDestinationAsync(request.DestinationId, cancellationToken);
        property.DestinationId = request.DestinationId;
        property.Address = request.Address.Trim();
        property.City = request.City.Trim();
        property.Country = request.Country.Trim();
        property.Latitude = request.Latitude;
        property.Longitude = request.Longitude;
        await dbContext.SaveChangesAsync(cancellationToken);
        return await LoadResponseAsync(propertyId, cancellationToken);
    }

    public async Task<PropertyResponse> UpdateBuildingSectionAsync(
        int userId,
        UserRole role,
        int propertyId,
        UpdatePropertyBuildingSectionRequest request,
        CancellationToken cancellationToken = default)
    {
        var property = await GetManageableEntityAsync(userId, role, propertyId, cancellationToken);
        property.TotalAreaM2 = request.TotalAreaM2;
        property.LandAreaM2 = request.LandAreaM2;
        property.FloorsCount = request.FloorsCount;
        property.HasElevator = request.HasElevator;
        property.IsWheelchairAccessible = request.IsWheelchairAccessible;
        property.HasGroundFloorRoom = request.HasGroundFloorRoom;
        property.HasAccessibleBathroom = request.HasAccessibleBathroom;
        await dbContext.SaveChangesAsync(cancellationToken);
        return await LoadResponseAsync(propertyId, cancellationToken);
    }

    public async Task<PropertyResponse> UpdateRulesSectionAsync(
        int userId,
        UserRole role,
        int propertyId,
        UpdatePropertyRulesSectionRequest request,
        CancellationToken cancellationToken = default)
    {
        var property = await GetManageableEntityAsync(userId, role, propertyId, cancellationToken);
        property.CheckInTime = request.CheckInTime;
        property.CheckOutTime = request.CheckOutTime;
        property.BreakfastOption = request.BreakfastOption;
        property.BreakfastPrice = request.BreakfastOption == BreakfastOption.Paid ? request.BreakfastPrice : null;
        await dbContext.SaveChangesAsync(cancellationToken);
        return await LoadResponseAsync(propertyId, cancellationToken);
    }

    public async Task<PropertyResponse> UpdateFinancialSectionAsync(
        int userId,
        UserRole role,
        int propertyId,
        UpdatePropertyFinancialSectionRequest request,
        CancellationToken cancellationToken = default)
    {
        var property = await GetManageableEntityAsync(userId, role, propertyId, cancellationToken);
        property.FreeChildAgeLimit = request.FreeChildAgeLimit;
        property.MaxFreeChildren = request.MaxFreeChildren;
        property.ChildPrice = request.ChildPrice;
        property.ExtraGuestPrice = request.ExtraGuestPrice;
        await dbContext.SaveChangesAsync(cancellationToken);
        return await LoadResponseAsync(propertyId, cancellationToken);
    }

    public async Task<PropertyResponse> UpdateDescriptionSectionAsync(
        int userId,
        UserRole role,
        int propertyId,
        UpdatePropertyDescriptionSectionRequest request,
        CancellationToken cancellationToken = default)
    {
        var property = await GetManageableEntityAsync(userId, role, propertyId, cancellationToken);
        property.Description = request.Description.Trim();
        await dbContext.SaveChangesAsync(cancellationToken);
        return await LoadResponseAsync(propertyId, cancellationToken);
    }

    public async Task<PropertyResponse> UpdateSeoSectionAsync(
        int userId,
        UserRole role,
        int propertyId,
        UpdatePropertySeoSectionRequest request,
        CancellationToken cancellationToken = default)
    {
        var property = await GetManageableEntityAsync(userId, role, propertyId, cancellationToken);
        property.SeoTitle = CleanOptional(request.SeoTitle);
        property.SeoDescription = CleanOptional(request.SeoDescription);
        await dbContext.SaveChangesAsync(cancellationToken);
        return await LoadResponseAsync(propertyId, cancellationToken);
    }

    public async Task<IReadOnlyList<PropertyResponse>> GetMyPropertiesAsync(
        int userId,
        UserRole role,
        CancellationToken cancellationToken = default)
    {
        var propertyIds = await propertyAuthorizationService.GetAccessiblePropertiesAsync(
            userId,
            cancellationToken);
        var query = dbContext.Properties.AsNoTracking()
            .Where(property => propertyIds.Contains(property.Id));

        return await Project(query.OrderBy(property => property.Name)).ToListAsync(cancellationToken);
    }

    public async Task<PropertyResponse> UpdatePropertyForAdminAsync(
        int userId,
        UserRole role,
        int propertyId,
        AdminUpdatePropertyRequest request,
        CancellationToken cancellationToken = default)
    {
        await EnsureCanAdminManagePropertyAsync(userId, role, propertyId, cancellationToken);
        PropertyCoordinateValidator.EnsureValid(request.Latitude, request.Longitude);

        var property = await GetEntityAsync(propertyId, cancellationToken);
        if (request.OwnerId != property.OwnerId)
        {
            throw new InvalidOperationException("Use the transfer ownership action to change a property owner.");
        }

        await ValidateDestinationAsync(request.DestinationId, cancellationToken);
        var englishName = CleanOptional(request.EnglishName);
        var slug = EnglishSlugGenerator.CreateWithEntityFallback(englishName, "property", property.Id, property.Slug);
        await EnsureUniqueSlugAsync(slug, propertyId, cancellationToken);

        property.DestinationId = request.DestinationId;
        property.Name = request.Name.Trim();
        property.EnglishName = englishName;
        property.Slug = slug;
        property.Description = request.Description.Trim();
        property.SeoTitle = CleanOptional(request.SeoTitle);
        property.SeoDescription = CleanOptional(request.SeoDescription);
        property.Address = request.Address.Trim();
        property.City = request.City.Trim();
        property.Country = request.Country.Trim();
        if (request.Status == PropertyStatus.Approved)
        {
            await EnsurePropertyCanActivateAsync(propertyId, cancellationToken);
        }

        property.Status = request.Status;
        property.Type = request.Type;
        property.InventoryMode = request.InventoryMode;
        property.CheckInTime = request.CheckInTime;
        property.CheckOutTime = request.CheckOutTime;
        property.BreakfastOption = request.BreakfastOption;
        property.BreakfastPrice = request.BreakfastOption == BreakfastOption.Paid ? request.BreakfastPrice : null;
        property.Latitude = request.Latitude;
        property.Longitude = request.Longitude;
        property.TotalAreaM2 = request.TotalAreaM2;
        property.LandAreaM2 = request.LandAreaM2;
        property.FloorsCount = request.FloorsCount;
        property.HasElevator = request.HasElevator;
        property.IsWheelchairAccessible = request.IsWheelchairAccessible;
        property.HasGroundFloorRoom = request.HasGroundFloorRoom;
        property.HasAccessibleBathroom = request.HasAccessibleBathroom;
        property.FreeChildAgeLimit = request.FreeChildAgeLimit;
        property.MaxFreeChildren = request.MaxFreeChildren;
        property.ChildPrice = request.ChildPrice;
        property.ExtraGuestPrice = request.ExtraGuestPrice;

        await dbContext.SaveChangesAsync(cancellationToken);
        return await LoadResponseAsync(propertyId, cancellationToken);
    }

    public async Task<PropertyResponse> TransferOwnershipAsync(
        int userId,
        UserRole role,
        int propertyId,
        AdminTransferPropertyOwnershipRequest request,
        CancellationToken cancellationToken = default)
    {
        await EnsureCanAdminManagePropertyAsync(userId, role, propertyId, cancellationToken);

        var hasExistingOwner = request.NewOwnerId.HasValue;
        var hasNewOwner = request.NewOwner is not null;
        if (hasExistingOwner == hasNewOwner)
        {
            throw new ArgumentException("دقیقاً یک مالک جدید را انتخاب کنید.");
        }

        ValidatePreviousOwnerSelection(request);

        Microsoft.EntityFrameworkCore.Storage.IDbContextTransaction? transaction = null;
        if (dbContext.Database.IsRelational())
        {
            transaction = await dbContext.Database.BeginTransactionAsync(cancellationToken);
        }

        try
        {
            var property = await dbContext.Properties
                .Include(item => item.Owner)
                .SingleOrDefaultAsync(item => item.Id == propertyId, cancellationToken)
                ?? throw new KeyNotFoundException("Property not found.");
            var previousOwnerId = property.OwnerId;
            var newOwner = hasExistingOwner
                ? await ResolveTransferOwnerAsync(request.NewOwnerId!.Value, cancellationToken)
                : await CreateTransferOwnerAsync(userId, request.NewOwner!, cancellationToken);

            if (newOwner.Id == previousOwnerId)
            {
                throw new InvalidOperationException("کاربر انتخاب‌شده هم‌اکنون مالک این اقامتگاه است.");
            }

            var conflictingOwners = await dbContext.UserPropertyAccesses.AsNoTracking()
                .Where(access =>
                    access.PropertyId == propertyId &&
                    access.PropertyRole == PropertyUserRole.PropertyOwner &&
                    access.Status == PropertyUserStatus.Active &&
                    access.IsActive &&
                    !access.IsDeleted &&
                    access.UserId != previousOwnerId &&
                    access.UserId != newOwner.Id)
                .Select(access => access.UserId)
                .ToListAsync(cancellationToken);
            if (conflictingOwners.Count > 0)
            {
                throw new InvalidOperationException("این اقامتگاه دارای عضویت مالک فعال دیگری است.");
            }

            var previousOwner = property.Owner;
            property.OwnerId = newOwner.Id;
            var newOwnerAccess = await EnsureOwnerAccessAsync(propertyId, newOwner.Id, cancellationToken);

            var previousOwnerAccess = await dbContext.UserPropertyAccesses
                .IgnoreQueryFilters()
                .SingleOrDefaultAsync(access =>
                    access.PropertyId == propertyId &&
                    access.UserId == previousOwnerId,
                    cancellationToken);
            if (request.PreviousOwnerAction == PreviousOwnerTransferAction.DeactivateMembership)
            {
                if (previousOwnerAccess is not null)
                {
                    previousOwnerAccess.Status = PropertyUserStatus.Inactive;
                    previousOwnerAccess.IsActive = false;
                }
            }
            else
            {
                if (previousOwnerAccess is null)
                {
                    previousOwnerAccess = new UserPropertyAccess
                    {
                        PropertyId = propertyId,
                        UserId = previousOwnerId
                    };
                    dbContext.UserPropertyAccesses.Add(previousOwnerAccess);
                }

                ApplyMembershipRole(
                    previousOwnerAccess,
                    request.PreviousOwnerRole!.Value,
                    PropertyUserStatus.Active,
                    true);
                RestoreMembership(previousOwnerAccess);
            }

            await dbContext.SaveChangesAsync(cancellationToken);
            await EnsureExactlyOneActiveOwnerMembershipAsync(propertyId, newOwner.Id, cancellationToken);

            dbContext.AuditLogs.Add(new AuditLog
            {
                UserId = userId,
                PropertyId = propertyId,
                Action = AuditAction.PropertyOwnershipTransferred,
                EntityType = nameof(Property),
                EntityId = propertyId,
                EntityName = property.Name,
                Description = $"Property ownership transferred from user {previousOwnerId} ({DescribeUser(previousOwner)}) to user {newOwner.Id} ({DescribeUser(newOwner)}). Previous owner action: {request.PreviousOwnerAction} {request.PreviousOwnerRole?.ToString() ?? string.Empty}".Trim(),
                OccurredAtUtc = DateTime.UtcNow
            });
            await dbContext.SaveChangesAsync(cancellationToken);

            if (transaction is not null)
            {
                await transaction.CommitAsync(cancellationToken);
            }

            return await LoadResponseAsync(propertyId, cancellationToken);
        }
        catch
        {
            if (transaction is not null)
            {
                await transaction.RollbackAsync(cancellationToken);
            }

            throw;
        }
        finally
        {
            transaction?.Dispose();
        }
    }

    public async Task<PropertyResponse> GetPropertyByIdAsync(
        int userId,
        UserRole role,
        int propertyId,
        CancellationToken cancellationToken = default)
    {
        if (!await dbContext.Properties.AsNoTracking().AnyAsync(property => property.Id == propertyId, cancellationToken))
        {
            throw new KeyNotFoundException("Property not found.");
        }

        if (!await propertyAccessService.CanViewAsync(userId, role, propertyId, cancellationToken))
        {
            throw new UnauthorizedAccessException("You cannot access this property.");
        }

        return await LoadResponseAsync(propertyId, cancellationToken);
    }

    public async Task<IReadOnlyList<PropertyResponse>> GetAllForAdminAsync(
        int userId,
        UserRole role,
        CancellationToken cancellationToken = default)
    {
        if (role == UserRole.SuperAdmin)
        {
            return await Project(dbContext.Properties.AsNoTracking().OrderBy(property => property.Name))
                .ToListAsync(cancellationToken);
        }

        if (role != UserRole.AdminAssistant ||
            !await HasGlobalManagePermissionAsync(userId, cancellationToken))
        {
            throw new UnauthorizedAccessException("ManageProperties permission is required.");
        }

        var propertyIds = await propertyAuthorizationService.GetAccessiblePropertiesAsync(
            userId,
            cancellationToken);
        return await Project(dbContext.Properties.AsNoTracking()
                .Where(property => propertyIds.Contains(property.Id))
                .OrderBy(property => property.Name))
            .ToListAsync(cancellationToken);
    }

    public async Task<IReadOnlyList<PublicPropertyResponse>> GetPublicPropertiesAsync(
        string? q = null,
        string? city = null,
        DateOnly? checkIn = null,
        DateOnly? checkOut = null,
        int? rooms = null,
        int? adults = null,
        int? children = null,
        string? childAges = null,
        string? settingSlugs = null,
        CancellationToken cancellationToken = default)
    {
        var minAdults = Math.Max(0, adults ?? 0);
        var requestedChildren = Math.Max(0, children ?? 0);
        var parsedChildAges = ParseChildAges(childAges, requestedChildren);
        var hasGuestFilter = minAdults > 0 || requestedChildren > 0 || rooms.HasValue;
        var requestedSettingSlugs = (settingSlugs ?? string.Empty)
            .Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)
            .Select(EnglishSlugGenerator.NormalizeLookup)
            .Where(slug => slug.Length > 0)
            .Distinct(StringComparer.Ordinal)
            .ToArray();

        var query = dbContext.Properties.AsNoTracking()
            .Where(property => property.Status == PropertyStatus.Approved);

        if (!string.IsNullOrWhiteSpace(city))
        {
            var normalizedCity = city.Trim();
            query = query.Where(property => property.City.Contains(normalizedCity));
        }

        if (!string.IsNullOrWhiteSpace(q))
        {
            var normalizedQuery = q.Trim();
            query = query.Where(property =>
                property.Name.Contains(normalizedQuery) ||
                (property.EnglishName != null && property.EnglishName.Contains(normalizedQuery)) ||
                property.Slug.Contains(normalizedQuery) ||
                property.Description.Contains(normalizedQuery) ||
                property.City.Contains(normalizedQuery));
        }

        if (requestedSettingSlugs.Length > 0)
        {
            query = query.Where(property => property.PropertySettingAssignments.Any(assignment =>
                !assignment.IsDeleted &&
                assignment.PropertySetting.IsActive &&
                !assignment.PropertySetting.IsDeleted &&
                requestedSettingSlugs.Contains(assignment.PropertySetting.Slug)));
        }

        if (hasGuestFilter)
        {
            query = query.Where(property => property.RoomTypes.Any(roomType =>
                roomType.IsActive &&
                roomType.TotalInventory > 0 &&
                roomType.MaxAdults >= minAdults &&
                roomType.MaxChildren >= 0));
        }

        var properties = await ProjectPublic(query.OrderBy(property => property.Name), minAdults, 0)
            .ToListAsync(cancellationToken);
        var globalChildRules = await childPricingRuleResolver.GetGlobalDefaultsAsync(cancellationToken);

        foreach (var property in properties)
        {
            var childRules = childPricingRuleResolver.Resolve(
                property.FreeChildAgeLimit,
                property.MaxFreeChildren,
                null,
                globalChildRules);
            var occupancy = childPricingRuleResolver.ResolveOccupancy(parsedChildAges, requestedChildren, childRules);
            var effectiveAdults = minAdults + occupancy.AdultEquivalentGuests;
            var effectiveChildren = occupancy.ChargeableChildren;
            var matchingRoomTypes = property.RoomTypes
                .Where(roomType =>
                    roomType.TotalInventory > 0 &&
                    (roomType.MaxAdults + (roomType.AllowExtraGuest ? roomType.MaxExtraGuests : 0)) >= effectiveAdults &&
                    roomType.MaxChildren >= effectiveChildren)
                .Select(roomType => new PublicRoomTypeSummaryResponse
                {
                    Id = roomType.Id,
                    Name = roomType.Name,
                    RoomKind = roomType.RoomKind,
                    MaxAdults = roomType.MaxAdults,
                    MaxChildren = roomType.MaxChildren,
                    AllowExtraGuest = roomType.AllowExtraGuest,
                    MaxExtraGuests = roomType.MaxExtraGuests,
                    TotalInventory = roomType.TotalInventory,
                    DisplayPrice = roomType.DisplayPrice
                })
                .ToList();

            property.MatchingRoomTypes = matchingRoomTypes;
            property.MatchingRoomTypesCount = matchingRoomTypes.Count;
            property.GuestFitStatus = matchingRoomTypes.Count > 0 ? "مناسب ظرفیت" : property.RoomTypes.Count == 0 ? "ظرفیت نامشخص" : "نامناسب";
            property.AvailabilitySummary = "فعلاً همه موجود فرض شده‌اند";
            property.AvailabilityStatusSummary = matchingRoomTypes.Count > 0 ? "Available" : "Unknown";
        }

        return hasGuestFilter
            ? properties.Where(property => property.MatchingRoomTypesCount > 0).ToList()
            : properties;
    }

    public async Task<IReadOnlyList<PublicPropertySuggestionResponse>> GetPublicPropertySuggestionsAsync(
        string? q = null,
        string? city = null,
        CancellationToken cancellationToken = default)
    {
        var query = dbContext.Properties.AsNoTracking()
            .Where(property => property.Status == PropertyStatus.Approved);

        if (!string.IsNullOrWhiteSpace(city))
        {
            var normalizedCity = city.Trim();
            query = query.Where(property => property.City.Contains(normalizedCity));
        }

        if (!string.IsNullOrWhiteSpace(q))
        {
            var normalizedQuery = q.Trim();
            query = query.Where(property =>
                property.Name.Contains(normalizedQuery) ||
                (property.EnglishName != null && property.EnglishName.Contains(normalizedQuery)) ||
                property.Slug.Contains(normalizedQuery) ||
                property.Description.Contains(normalizedQuery) ||
                property.City.Contains(normalizedQuery));
        }

        return await query
            .OrderBy(property => property.Name)
            .Take(8)
            .Select(property => new PublicPropertySuggestionResponse
            {
                Id = property.Id,
                Name = property.Name,
                EnglishName = property.EnglishName,
                Slug = property.Slug,
                City = property.City
            })
            .ToListAsync(cancellationToken);
    }

    public async Task<PublicPropertyResponse?> GetPublicPropertyBySlugAsync(
        string slug,
        CancellationToken cancellationToken = default)
    {
        var normalizedSlug = EnglishSlugGenerator.NormalizeLookup(slug);
        return await ProjectPublic(dbContext.Properties.AsNoTracking()
                .Where(property => property.Status == PropertyStatus.Approved && property.Slug == normalizedSlug))
            .SingleOrDefaultAsync(cancellationToken);
    }

    public Task<PropertyResponse> ApprovePropertyAsync(
        int userId,
        UserRole role,
        int propertyId,
        CancellationToken cancellationToken = default) =>
        SetStatusAsync(userId, role, propertyId, PropertyStatus.Approved, cancellationToken);

    public Task<PropertyResponse> RejectPropertyAsync(
        int userId,
        UserRole role,
        int propertyId,
        CancellationToken cancellationToken = default) =>
        SetStatusAsync(userId, role, propertyId, PropertyStatus.Rejected, cancellationToken);

    public Task<PropertyResponse> SuspendPropertyAsync(
        int userId,
        UserRole role,
        int propertyId,
        CancellationToken cancellationToken = default) =>
        SetStatusAsync(userId, role, propertyId, PropertyStatus.Suspended, cancellationToken);

    public Task<PropertyResponse> SetPropertyStatusAsync(
        int userId,
        UserRole role,
        int propertyId,
        PropertyStatus status,
        CancellationToken cancellationToken = default) =>
        SetStatusAsync(userId, role, propertyId, status, cancellationToken);

    private async Task<PropertyResponse> SetStatusAsync(
        int userId,
        UserRole role,
        int propertyId,
        PropertyStatus status,
        CancellationToken cancellationToken)
    {
        await EnsureCanAdminManagePropertyAsync(userId, role, propertyId, cancellationToken);

        var property = await GetEntityAsync(propertyId, cancellationToken);
        if (status == PropertyStatus.Approved)
        {
            await EnsurePropertyCanActivateAsync(propertyId, cancellationToken);
        }

        property.Status = status;
        await dbContext.SaveChangesAsync(cancellationToken);
        return await LoadResponseAsync(propertyId, cancellationToken);
    }

    private async Task EnsurePropertyCanActivateAsync(
        int propertyId,
        CancellationToken cancellationToken)
    {
        var completion = await propertyCompletionService.CalculateAsync(propertyId, cancellationToken);
        if (!completion.CanActivate)
        {
            throw new PropertyActivationException(completion);
        }
    }

    private async Task<Property> GetManageableEntityAsync(
        int userId,
        UserRole role,
        int propertyId,
        CancellationToken cancellationToken)
    {
        var property = await GetEntityAsync(propertyId, cancellationToken);
        if (!await propertyAccessService.CanManagePropertyAsync(userId, role, propertyId, cancellationToken))
        {
            throw new UnauthorizedAccessException("You cannot manage this property.");
        }

        return property;
    }

    private async Task<Property> GetEntityAsync(int propertyId, CancellationToken cancellationToken) =>
        await dbContext.Properties.SingleOrDefaultAsync(property => property.Id == propertyId, cancellationToken)
        ?? throw new KeyNotFoundException("Property not found.");

    private async Task EnsureCanAdminManagePropertyAsync(
        int userId,
        UserRole role,
        int propertyId,
        CancellationToken cancellationToken)
    {
        var allowed = await permissionService.HasPermissionAsync(
            userId,
            PermissionKey.ManageProperties,
            propertyId,
            cancellationToken);
        if (!allowed)
        {
            throw new UnauthorizedAccessException("ManageProperties permission is required.");
        }
    }

    private async Task<PropertyResponse> LoadResponseAsync(int propertyId, CancellationToken cancellationToken) =>
        await Project(dbContext.Properties.AsNoTracking().Where(property => property.Id == propertyId))
            .SingleAsync(cancellationToken);

    private async Task<bool> HasGlobalManagePermissionAsync(int userId, CancellationToken cancellationToken) =>
        await permissionService.HasPermissionAsync(userId, PermissionKey.ManageProperties, null, cancellationToken);

    private async Task EnsureCanonicalOwnerAccountAsync(int ownerId, CancellationToken cancellationToken)
    {
        var owner = await dbContext.Users.IgnoreQueryFilters().AsNoTracking()
            .SingleOrDefaultAsync(user => user.Id == ownerId, cancellationToken);
        if (owner is null || owner.Role != UserRole.Client)
        {
            throw new ArgumentException("The selected owner must be a normal user account.");
        }

        if (owner.IsDeleted)
        {
            throw new InvalidOperationException("Deleted users cannot own properties.");
        }

        if (!owner.IsActive)
        {
            throw new InvalidOperationException("Inactive users cannot own properties.");
        }
    }

    private async Task<User> ResolveTransferOwnerAsync(int ownerId, CancellationToken cancellationToken)
    {
        var user = await dbContext.Users.IgnoreQueryFilters()
            .SingleOrDefaultAsync(item => item.Id == ownerId, cancellationToken)
            ?? throw new ArgumentException("The selected owner account was not found.");
        if (user.IsDeleted)
        {
            throw new InvalidOperationException("کاربر حذف‌شده نمی‌تواند مالک اقامتگاه شود.");
        }

        if (!user.IsActive)
        {
            throw new InvalidOperationException("کاربر غیرفعال باید پیش از دریافت مالکیت فعال شود.");
        }

        return user;
    }

    private async Task<User> CreateTransferOwnerAsync(
        int currentUserId,
        AdminPropertyOwnerAccountRequest request,
        CancellationToken cancellationToken)
    {
        if (string.IsNullOrWhiteSpace(request.Password))
        {
            throw new ArgumentException("An initial password is required when creating a new owner during transfer.");
        }

        PasswordPolicy.Validate(request.Password);
        var identity = CreateUserIdentity(request.FirstName, request.LastName, request.PhoneNumber, request.Email);
        var email = identity.Email;
        var mobile = identity.PhoneNumber;
        await EnsureUniqueIdentityAsync(email, mobile, cancellationToken);
        var user = new User
        {
            FirstName = identity.FirstName,
            LastName = identity.LastName,
            Email = email,
            PhoneNumber = mobile,
            PasswordHash = BCrypt.Net.BCrypt.HashPassword(request.Password),
            Role = UserRole.Client,
            ParentUserId = currentUserId,
            IsActive = true,
            PasswordSetupRequired = false
        };
        dbContext.Users.Add(user);
        return user;
    }

    private async Task<UserPropertyAccess> EnsureOwnerAccessAsync(
        int propertyId,
        int ownerId,
        CancellationToken cancellationToken)
    {
        var ownerAccess = await dbContext.UserPropertyAccesses
            .IgnoreQueryFilters()
            .SingleOrDefaultAsync(access =>
                access.PropertyId == propertyId && access.UserId == ownerId,
                cancellationToken);
        if (ownerAccess is null)
        {
            ownerAccess = new UserPropertyAccess
            {
                PropertyId = propertyId,
                UserId = ownerId,
                PropertyRole = PropertyUserRole.PropertyOwner,
                Status = PropertyUserStatus.Active
            };
            dbContext.UserPropertyAccesses.Add(ownerAccess);
        }

        ApplyMembershipRole(ownerAccess, PropertyUserRole.PropertyOwner, PropertyUserStatus.Active, true);
        RestoreMembership(ownerAccess);
        return ownerAccess;
    }

    private async Task EnsureExactlyOneActiveOwnerMembershipAsync(
        int propertyId,
        int ownerId,
        CancellationToken cancellationToken)
    {
        var ownerUserIds = await dbContext.UserPropertyAccesses.AsNoTracking()
            .Where(access =>
                access.PropertyId == propertyId &&
                access.PropertyRole == PropertyUserRole.PropertyOwner &&
                access.Status == PropertyUserStatus.Active &&
                access.IsActive &&
                !access.IsDeleted)
            .Select(access => access.UserId)
            .ToListAsync(cancellationToken);
        if (ownerUserIds.Count != 1 || ownerUserIds[0] != ownerId)
        {
            throw new InvalidOperationException("A property must have exactly one active property owner membership matching Property.OwnerId.");
        }
    }

    private async Task EnsureUniqueIdentityAsync(
        string? email,
        string mobile,
        CancellationToken cancellationToken)
    {
        if (email is not null && await dbContext.Users.IgnoreQueryFilters()
                .AnyAsync(user => user.Email == email, cancellationToken))
        {
            throw new ArgumentException(UserIdentityNormalization.DuplicateEmailMessage);
        }

        var mobileVariants = UserIdentityNormalization.BuildPhoneNumberVariants(mobile);
        if (await dbContext.Users.IgnoreQueryFilters()
            .AnyAsync(user => user.PhoneNumber != null && mobileVariants.Contains(user.PhoneNumber), cancellationToken))
        {
            throw new ArgumentException(UserIdentityNormalization.DuplicatePhoneNumberMessage);
        }

        if (await dbContext.Guests.AsNoTracking()
            .AnyAsync(guest =>
                    (email != null && guest.NormalizedEmail == email) ||
                    guest.NormalizedMobile == mobile,
                cancellationToken))
        {
            throw new ArgumentException("Guest with this mobile or email already exists.");
        }
    }

    private static void ApplyMembershipRole(
        UserPropertyAccess access,
        PropertyUserRole role,
        PropertyUserStatus status,
        bool isActive)
    {
        access.PropertyRole = role;
        access.Status = status;
        access.IsActive = isActive && status == PropertyUserStatus.Active;
        var permissions = PropertyPermissionMatrixDefaults.CreateForRole(role);
        access.PermissionMatrixJson = JsonSerializer.Serialize(permissions);
    }

    private static void RestoreMembership(UserPropertyAccess access)
    {
        access.IsDeleted = false;
        access.DeletedAtUtc = null;
        access.DeletedByUserId = null;
    }

    private static void ValidatePreviousOwnerSelection(
        AdminTransferPropertyOwnershipRequest request)
    {
        if (!Enum.IsDefined(request.PreviousOwnerAction))
        {
            throw new ArgumentException("نحوه دسترسی مالک قبلی معتبر نیست.");
        }

        if (request.PreviousOwnerAction == PreviousOwnerTransferAction.DeactivateMembership)
        {
            if (request.PreviousOwnerRole.HasValue)
            {
                throw new ArgumentException("برای حذف دسترسی مالک قبلی نباید نقشی انتخاب شود.");
            }

            return;
        }

        if (!request.PreviousOwnerRole.HasValue ||
            !Enum.IsDefined(request.PreviousOwnerRole.Value) ||
            request.PreviousOwnerRole == PropertyUserRole.PropertyOwner)
        {
            throw new ArgumentException("یک نقش معتبر و غیرمالک برای مالک قبلی انتخاب کنید.");
        }
    }


    private async Task EnsureCanonicalOwnerMembershipAsync(
        int propertyId,
        int? previousOwnerId,
        int ownerId,
        CancellationToken cancellationToken)
    {
        if (previousOwnerId.HasValue && previousOwnerId.Value != ownerId)
        {
            var previousOwnerAccess = await dbContext.UserPropertyAccesses
                .SingleOrDefaultAsync(access =>
                    access.PropertyId == propertyId &&
                    access.UserId == previousOwnerId.Value &&
                    access.PropertyRole == PropertyUserRole.PropertyOwner,
                    cancellationToken);
            if (previousOwnerAccess is not null)
            {
                previousOwnerAccess.Status = PropertyUserStatus.Inactive;
                previousOwnerAccess.IsActive = false;
            }
        }

        var ownerAccess = await dbContext.UserPropertyAccesses
            .IgnoreQueryFilters()
            .SingleOrDefaultAsync(access =>
                access.PropertyId == propertyId && access.UserId == ownerId,
                cancellationToken);
        if (ownerAccess is null)
        {
            ownerAccess = new UserPropertyAccess
            {
                PropertyId = propertyId,
                UserId = ownerId,
                PropertyRole = PropertyUserRole.PropertyOwner,
                Status = PropertyUserStatus.Active
            };
            dbContext.UserPropertyAccesses.Add(ownerAccess);
        }

        ApplyMembershipRole(ownerAccess, PropertyUserRole.PropertyOwner, PropertyUserStatus.Active, true);
        ownerAccess.IsDeleted = false;
        ownerAccess.DeletedAtUtc = null;
        ownerAccess.DeletedByUserId = null;
    }

    private async Task ValidateDestinationAsync(int destinationId, CancellationToken cancellationToken)
    {
        if (!await dbContext.Destinations.AsNoTracking()
                .AnyAsync(destination => destination.Id == destinationId, cancellationToken))
        {
            throw new ArgumentException("Destination not found.");
        }
    }

    private async Task EnsureUniqueSlugAsync(string slug, int? propertyId, CancellationToken cancellationToken)
    {
        if (await dbContext.Properties.IgnoreQueryFilters().AsNoTracking()
                .AnyAsync(property => property.Slug == slug && property.Id != propertyId, cancellationToken))
        {
            throw new InvalidOperationException("A property with this slug already exists.");
        }
    }

    private static IQueryable<PropertyResponse> Project(IQueryable<Property> query) =>
        query.Select(property => new PropertyResponse
        {
            Id = property.Id,
            OwnerId = property.OwnerId,
            OwnerName = (property.Owner.FirstName + " " + property.Owner.LastName).Trim(),
            OwnerEmail = property.Owner.Email ?? string.Empty,
            CreatedAtUtc = property.CreatedAtUtc,
            DestinationId = property.DestinationId,
            DestinationName = property.Destination.Name,
            Name = property.Name,
            EnglishName = property.EnglishName,
            Slug = property.Slug,
            Description = property.Description,
            SeoTitle = property.SeoTitle,
            SeoDescription = property.SeoDescription,
            Address = property.Address,
            City = property.City,
            Country = property.Country,
            Latitude = property.Latitude,
            Longitude = property.Longitude,
            Status = property.Status,
            Type = property.Type,
            InventoryMode = property.InventoryMode,
            CheckInTime = property.CheckInTime,
            CheckOutTime = property.CheckOutTime,
            BreakfastOption = property.BreakfastOption,
            BreakfastPrice = property.BreakfastPrice,
            TotalAreaM2 = property.TotalAreaM2,
            LandAreaM2 = property.LandAreaM2,
            FloorsCount = property.FloorsCount,
            StairCount = property.StairCount,
            HasElevator = property.HasElevator,
            IsWheelchairAccessible = property.IsWheelchairAccessible,
            HasGroundFloorRoom = property.HasGroundFloorRoom,
            HasAccessibleBathroom = property.HasAccessibleBathroom,
            FreeChildAgeLimit = property.FreeChildAgeLimit,
            MaxFreeChildren = property.MaxFreeChildren,
            ChildPrice = property.ChildPrice,
            ExtraGuestPrice = property.ExtraGuestPrice,
        });

    private static IQueryable<PublicPropertyResponse> ProjectPublic(
        IQueryable<Property> query,
        int minAdults = 0,
        int minChildren = 0,
        bool hasDates = false,
        DateOnly? rangeStartValue = null,
        DateOnly? rangeEndExclusiveValue = null,
        int nights = 1)
    {
        var today = DateOnly.FromDateTime(DateTime.UtcNow);
        var rangeStart = rangeStartValue ?? today;
        var rangeEndExclusive = rangeEndExclusiveValue ?? today.AddDays(1);
        return query.Select(property => new PublicPropertyResponse
        {
            Id = property.Id,
            Name = property.Name,
            EnglishName = property.EnglishName,
            Slug = property.Slug,
            SeoTitle = property.SeoTitle,
            SeoDescription = property.SeoDescription,
            City = property.City,
            Country = property.Country,
            Address = property.Address,
            Description = property.Description,
            ShortDescription = property.Description.Length > 180
                ? property.Description.Substring(0, 180) + "..."
                : property.Description,
            Status = property.Status,
            PropertyType = property.Type,
            InventoryMode = property.InventoryMode,
            CheckInTime = property.CheckInTime,
            CheckOutTime = property.CheckOutTime,
            BreakfastOption = property.BreakfastOption,
            BreakfastPrice = property.BreakfastPrice,
            Latitude = property.Latitude,
            Longitude = property.Longitude,
            HasElevator = property.HasElevator,
            IsWheelchairAccessible = property.IsWheelchairAccessible,
            HasGroundFloorRoom = property.HasGroundFloorRoom,
            HasAccessibleBathroom = property.HasAccessibleBathroom,
            FreeChildAgeLimit = property.FreeChildAgeLimit,
            MaxFreeChildren = property.MaxFreeChildren,
            Promotions = property.Promotions
                .Where(promotion => promotion.IsActive)
                .OrderBy(promotion => promotion.SortOrder)
                .ThenByDescending(promotion => promotion.CreatedAtUtc)
                .Select(promotion => new PublicPromotionResponse
                {
                    Id = promotion.Id,
                    Title = promotion.Title,
                    PublicDescription = promotion.PublicDescription,
                    OptionalIcon = promotion.OptionalIcon,
                    BadgeColor = promotion.BadgeColor,
                    MinimumStayNights = promotion.MinimumStayNights,
                    MinimumGuests = promotion.MinimumGuests,
                    Type = promotion.Type,
                    SortOrder = promotion.SortOrder,
                    IsActive = promotion.IsActive
                })
                .ToList(),
            IsInstantBooking = property.RoomTypes.Any(roomType => roomType.Availability.Any(
                availability => availability.Date >= today &&
                                availability.Status == AvailabilityStatus.Available &&
                                availability.AvailableCount > 0)),
            MatchingRoomTypesCount = property.RoomTypes.Count(roomType =>
                roomType.IsActive &&
                roomType.MaxAdults >= minAdults &&
                roomType.MaxChildren >= minChildren &&
                (!hasDates ||
                 !roomType.Availability.Any(availability =>
                     availability.Date >= rangeStart &&
                     availability.Date < rangeEndExclusive) ||
                 roomType.Availability.Count(availability =>
                     availability.Date >= rangeStart &&
                     availability.Date < rangeEndExclusive &&
                     availability.Status == AvailabilityStatus.Available &&
                     availability.AvailableCount > 0) == nights)),
            AvailabilityStatusSummary = hasDates
                ? property.RoomTypes.Any(roomType =>
                    roomType.IsActive &&
                    roomType.MaxAdults >= minAdults &&
                    roomType.MaxChildren >= minChildren &&
                    roomType.Availability.Count(availability =>
                        availability.Date >= rangeStart &&
                        availability.Date < rangeEndExclusive &&
                        availability.Status == AvailabilityStatus.Available &&
                        availability.AvailableCount > 0) == nights)
                    ? "Available"
                    : property.RoomTypes.Any(roomType =>
                        roomType.IsActive &&
                        roomType.MaxAdults >= minAdults &&
                        roomType.MaxChildren >= minChildren &&
                        roomType.Availability.Any(availability =>
                            availability.Date >= rangeStart &&
                            availability.Date < rangeEndExclusive &&
                            availability.Status == AvailabilityStatus.OnRequest))
                        ? "OnRequest"
                        : "Unknown"
                : property.RoomTypes.Any(roomType => roomType.IsActive && roomType.Availability.Any(availability =>
                    availability.Date >= today &&
                    availability.Status == AvailabilityStatus.Available &&
                    availability.AvailableCount > 0))
                    ? "Available"
                    : property.RoomTypes.Any(roomType => roomType.IsActive && roomType.Availability.Any(availability =>
                        availability.Date >= today &&
                        availability.Status == AvailabilityStatus.OnRequest))
                        ? "OnRequest"
                        : "Unknown",
            CoverImageUrl = property.Images
                .Where(image => image.RoomTypeId == null && image.RoomId == null)
                .OrderByDescending(image => image.IsCover)
                .ThenBy(image => image.SortOrder)
                .Select(image => image.Url)
                .FirstOrDefault(),
            StartingPrice = property.RoomTypes
                .Where(roomType => roomType.IsActive)
                .SelectMany(roomType => roomType.DailyPrices)
                .Where(price => price.Date >= today &&
                                price.GuestType == PricingGuestType.Iranian &&
                                price.BasePrice > 0)
                .Select(price => (decimal?)price.BasePrice)
                .Min(),
            Images = property.Images
                .Where(image => image.RoomTypeId == null &&
                                image.RoomId == null &&
                                (image.IsGallery || image.IsCover))
                .OrderByDescending(image => image.IsCover)
                .ThenBy(image => image.SortOrder)
                .Select(image => new PublicImageResponse
                {
                    Id = image.Id,
                    Url = image.Url,
                    AltText = image.AltText,
                    Caption = image.Caption,
                    Tag = image.Tag,
                    IsCover = image.IsCover
                })
                .ToList(),
            DescriptionSections = property.DescriptionSections
                .OrderBy(section => section.SortOrder)
                .Select(section => new PublicDescriptionSectionResponse
                {
                    SectionType = section.SectionType,
                    Title = section.Title,
                    Content = section.Content,
                    SortOrder = section.SortOrder
                })
                .ToList(),
            CommonAreas = property.CommonAreas
                .OrderBy(area => area.SortOrder)
                .ThenBy(area => area.Name)
                .Select(area => new PublicCommonAreaResponse
                {
                    Id = area.Id,
                    Name = area.Name,
                    Description = area.Description,
                    SortOrder = area.SortOrder
                })
                .ToList(),
            Settings = property.PropertySettingAssignments
                .Where(assignment =>
                    !assignment.IsDeleted &&
                    assignment.PropertySetting.IsActive &&
                    !assignment.PropertySetting.IsDeleted)
                .OrderBy(assignment => assignment.PropertySetting.SortOrder)
                .ThenBy(assignment => assignment.PropertySetting.Name)
                .Select(assignment => new PublicPropertySettingResponse
                {
                    Id = assignment.PropertySettingId,
                    Name = assignment.PropertySetting.Name,
                    Slug = assignment.PropertySetting.Slug
                })
                .ToList(),
            Amenities = property.PropertyAmenities
                .OrderBy(join => join.Amenity.AmenityCategory.SortOrder)
                .ThenBy(join => join.Amenity.SortOrder)
                .Select(join => new PublicAmenityResponse
                {
                    Id = join.AmenityId,
                    Name = join.Amenity.Name,
                    Category = join.Amenity.AmenityCategory.Name
                })
                .ToList(),
            NearbyPlaces = property.NearbyPlaces
                .Where(place => place.IsActive)
                .OrderBy(place => place.Category)
                .ThenBy(place => place.Title)
                .Select(place => new PublicNearbyPlaceResponse
                {
                    Id = place.Id,
                    Title = place.Title,
                    Category = place.Category,
                    DistanceInMeters = place.DistanceInMeters,
                    WalkingMinutes = place.WalkingMinutes,
                    DrivingMinutes = place.DrivingMinutes,
                    Description = place.Description
                })
                .ToList(),
            Views = property.Views
                .OrderBy(view => view.ViewType)
                .Select(view => view.ViewType)
                .ToList(),
            RoomTypes = property.RoomTypes
                .Where(roomType => roomType.IsActive)
                .OrderBy(roomType => roomType.Name)
                .Select(roomType => new PublicRoomTypeResponse
                {
                    Id = roomType.Id,
                    Name = roomType.Name,
                    RoomKind = roomType.RoomKind,
                    EnglishName = roomType.EnglishName,
                    Description = roomType.Description,
                    BasePrice = roomType.BasePrice,
                    AvailabilityPrice = roomType.DailyPrices
                        .Where(price => price.Date >= today &&
                                        price.GuestType == PricingGuestType.Iranian &&
                                        price.BasePrice > 0)
                        .Select(price => (decimal?)price.BasePrice)
                        .Min(),
                    DisplayPrice = roomType.DailyPrices
                        .Where(price => price.Date >= today &&
                                        price.GuestType == PricingGuestType.Iranian &&
                                        price.BasePrice > 0)
                        .Select(price => (decimal?)price.BasePrice)
                        .Min(),
                    AvailabilityStatus = roomType.Availability
                        .Where(availability => availability.Date >= today)
                        .OrderBy(availability => availability.Date)
                        .Select(availability => (AvailabilityStatus?)availability.Status)
                        .FirstOrDefault(),
                    InventoryMode = roomType.InventoryMode,
                    TotalInventory = roomType.TotalInventory,
                    ActiveRoomCount = roomType.Rooms.Count(room => room.IsActive),
                    MaxAdults = roomType.MaxAdults,
                    MaxChildren = roomType.MaxChildren,
                    AllowExtraGuest = roomType.AllowExtraGuest,
                    MaxExtraGuests = roomType.MaxExtraGuests,
                    Notes = roomType.Notes,
                    FloorNumber = roomType.FloorNumber,
                    StairCount = roomType.StairCount,
                    HasWindow = roomType.HasWindow,
                    HasPrivateBathroom = roomType.HasPrivateBathroom,
                    BedInformation = roomType.BedConfigurations
                        .OrderBy(configuration => configuration.BedType.Name)
                        .Select(configuration => configuration.Quantity + " x " + configuration.BedType.Name)
                        .ToList(),
                    Images = roomType.PropertyImages
                        .OrderByDescending(image => image.IsCover)
                        .ThenBy(image => image.SortOrder)
                        .Select(image => new PublicImageResponse
                        {
                            Id = image.Id,
                            Url = image.Url,
                            AltText = image.AltText,
                            Caption = image.Caption,
                            Tag = image.Tag,
                            IsCover = image.IsCover
                        })
                        .ToList(),
                    Amenities = roomType.RoomTypeAmenities
                        .OrderBy(join => join.Amenity.SortOrder)
                        .Select(join => new PublicAmenityResponse
                        {
                            Id = join.AmenityId,
                            Name = join.Amenity.Name,
                            Category = join.Amenity.AmenityCategory.Name
                        })
                        .ToList(),
                })
                .ToList()
        });
    }

    private static IReadOnlyList<int> ParseChildAges(string? childAges, int requestedChildren)
    {
        var ages = string.IsNullOrWhiteSpace(childAges)
            ? new List<int>()
            : childAges.Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)
                .Select(value => int.TryParse(value, out var age) ? Math.Clamp(age, 0, 17) : (int?)null)
                .Where(age => age.HasValue)
                .Select(age => age!.Value)
                .ToList();

        while (ages.Count < requestedChildren)
        {
            ages.Add(17);
        }

        return ages.Take(requestedChildren).ToList();
    }

    private static int CountCapacityChildren(
        IReadOnlyList<int> childAges,
        int requestedChildren,
        int? freeChildAgeLimit,
        int? maxFreeChildren)
    {
        if (requestedChildren <= 0)
        {
            return 0;
        }

        if (!freeChildAgeLimit.HasValue || !maxFreeChildren.HasValue || maxFreeChildren.Value <= 0)
        {
            return requestedChildren;
        }

        var freeChildren = childAges
            .Take(requestedChildren)
            .Count(age => age <= freeChildAgeLimit.Value);

        return Math.Max(0, requestedChildren - Math.Min(freeChildren, maxFreeChildren.Value));
    }

    private static UserIdentityInput CreateUserIdentity(
        string firstName,
        string lastName,
        string phoneNumber,
        string? email)
    {
        var normalizedPhone = UserIdentityNormalization.NormalizePhoneNumber(phoneNumber)
            ?? throw new ArgumentException("Mobile number is required.");
        return new UserIdentityInput(
            UserIdentityNormalization.NormalizeName(firstName),
            UserIdentityNormalization.NormalizeName(lastName),
            normalizedPhone,
            UserIdentityNormalization.NormalizeEmail(email));
    }



    private static string DescribeUser(User user) =>
        string.IsNullOrWhiteSpace((user.FirstName + " " + user.LastName).Trim())
            ? user.Email ?? string.Empty
            : (user.FirstName + " " + user.LastName).Trim();

    private static string? CleanOptional(string? value) => string.IsNullOrWhiteSpace(value) ? null : value.Trim();
}
