using System.Linq.Expressions;
using Kooch.Api.Entities;
using Microsoft.EntityFrameworkCore;

namespace Kooch.Api.Data;

public class KoochDbContext(DbContextOptions<KoochDbContext> options) : DbContext(options)
{
    public DbSet<User> Users => Set<User>();
    public DbSet<Permission> Permissions => Set<Permission>();
    public DbSet<UserPermission> UserPermissions => Set<UserPermission>();
    public DbSet<PasswordSetupToken> PasswordSetupTokens => Set<PasswordSetupToken>();
    public DbSet<MobileOtpCode> MobileOtpCodes => Set<MobileOtpCode>();
    public DbSet<UserPropertyAccess> UserPropertyAccesses => Set<UserPropertyAccess>();
    public DbSet<NotificationSubscription> NotificationSubscriptions => Set<NotificationSubscription>();
    public DbSet<NotificationLog> NotificationLogs => Set<NotificationLog>();
    public DbSet<Property> Properties => Set<Property>();
    public DbSet<RoomType> RoomTypes => Set<RoomType>();
    public DbSet<Room> Rooms => Set<Room>();
    public DbSet<Availability> Availabilities => Set<Availability>();
    public DbSet<Guest> Guests => Set<Guest>();
    public DbSet<Reservation> Reservations => Set<Reservation>();
    public DbSet<ReservationPaymentLinkToken> ReservationPaymentLinkTokens => Set<ReservationPaymentLinkToken>();
    public DbSet<Payment> Payments => Set<Payment>();
    public DbSet<Review> Reviews => Set<Review>();
    public DbSet<Amenity> Amenities => Set<Amenity>();
    public DbSet<AmenityCategory> AmenityCategories => Set<AmenityCategory>();
    public DbSet<PropertyAmenity> PropertyAmenities => Set<PropertyAmenity>();
    public DbSet<RoomTypeAmenity> RoomTypeAmenities => Set<RoomTypeAmenity>();
    public DbSet<PropertyImage> PropertyImages => Set<PropertyImage>();
    public DbSet<RoomTypeImage> RoomTypeImages => Set<RoomTypeImage>();
    public DbSet<TravelPurpose> TravelPurposes => Set<TravelPurpose>();
    public DbSet<PropertyTravelPurpose> PropertyTravelPurposes => Set<PropertyTravelPurpose>();
    public DbSet<NearbyPlace> NearbyPlaces => Set<NearbyPlace>();
    public DbSet<DefaultNearbyPlace> DefaultNearbyPlaces => Set<DefaultNearbyPlace>();
    public DbSet<PropertyCommonArea> PropertyCommonAreas => Set<PropertyCommonArea>();
    public DbSet<PropertyView> PropertyViews => Set<PropertyView>();
    public DbSet<PropertyDescriptionSection> PropertyDescriptionSections => Set<PropertyDescriptionSection>();
    public DbSet<CancellationPolicy> CancellationPolicies => Set<CancellationPolicy>();
    public DbSet<StayRule> StayRules => Set<StayRule>();
    public DbSet<Promotion> Promotions => Set<Promotion>();
    public DbSet<PromotionRoomType> PromotionRoomTypes => Set<PromotionRoomType>();
    public DbSet<RatePlan> RatePlans => Set<RatePlan>();
    public DbSet<PropertyHighlight> PropertyHighlights => Set<PropertyHighlight>();
    public DbSet<PropertyWarning> PropertyWarnings => Set<PropertyWarning>();
    public DbSet<BedType> BedTypes => Set<BedType>();
    public DbSet<RoomTypeBed> RoomTypeBeds => Set<RoomTypeBed>();
    public DbSet<MealPlan> MealPlans => Set<MealPlan>();
    public DbSet<SeoMetadata> SeoMetadata => Set<SeoMetadata>();
    public DbSet<Destination> Destinations => Set<Destination>();
    public DbSet<SiteSetting> SiteSettings => Set<SiteSetting>();
    public DbSet<RoomDailyPrice> RoomDailyPrices => Set<RoomDailyPrice>();
    public DbSet<RoomDailyPriceHistory> RoomDailyPriceHistory => Set<RoomDailyPriceHistory>();
    public DbSet<AuditLog> AuditLogs => Set<AuditLog>();
    public DbSet<Coupon> Coupons => Set<Coupon>();
    public DbSet<CouponUsage> CouponUsages => Set<CouponUsage>();
    public DbSet<HolidayCalendarDay> HolidayCalendarDays => Set<HolidayCalendarDay>();
    public DbSet<HolidayCalendarOccasion> HolidayCalendarOccasions => Set<HolidayCalendarOccasion>();
    public DbSet<HolidayCalendarDayOverride> HolidayCalendarDayOverrides => Set<HolidayCalendarDayOverride>();
    public DbSet<HolidayCalendarSyncState> HolidayCalendarSyncStates => Set<HolidayCalendarSyncState>();

    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        ConfigureUsers(modelBuilder);
        ConfigurePasswordSetupTokens(modelBuilder);
        ConfigureMobileOtpCodes(modelBuilder);
        ConfigurePermissions(modelBuilder);
        ConfigureUserPropertyAccesses(modelBuilder);
        ConfigureNotifications(modelBuilder);
        ConfigureProperties(modelBuilder);
        ConfigurePropertyCommonAreas(modelBuilder);
        ConfigurePropertyViews(modelBuilder);
        ConfigurePropertyDescriptionSections(modelBuilder);
        ConfigureDestinationsAndSeo(modelBuilder);
        ConfigureRoomTypes(modelBuilder);
        ConfigureBeds(modelBuilder);
        ConfigureRooms(modelBuilder);
        ConfigureAvailability(modelBuilder);
        ConfigureRoomDailyPrices(modelBuilder);
        ConfigureAuditLogs(modelBuilder);
        ConfigureCoupons(modelBuilder);
        ConfigureHolidayCalendar(modelBuilder);
        ConfigureGuests(modelBuilder);
        ConfigureReservations(modelBuilder);
        ConfigureReservationPaymentLinkTokens(modelBuilder);
        ConfigurePayments(modelBuilder);
        ConfigureReviews(modelBuilder);
        ConfigureAmenities(modelBuilder);
        ConfigureImages(modelBuilder);
        ConfigureTravelPurposes(modelBuilder);
        ConfigurePoliciesAndPricing(modelBuilder);
        ConfigureSiteSettings(modelBuilder);
        ApplySoftDeleteFilters(modelBuilder);
    }

    public override async Task<int> SaveChangesAsync(CancellationToken cancellationToken = default)
    {
        var now = DateTime.UtcNow;

        foreach (var entry in ChangeTracker.Entries<BaseEntity>())
        {
            if (entry.State == EntityState.Added)
            {
                entry.Entity.CreatedAtUtc = now;
                entry.Entity.UpdatedAtUtc = now;
            }
            else if (entry.State == EntityState.Modified)
            {
                entry.Property(entity => entity.CreatedAtUtc).IsModified = false;
                entry.Entity.UpdatedAtUtc = now;
            }
        }

        foreach (var entry in ChangeTracker.Entries<User>()
                     .Where(entry => entry.State is EntityState.Added or EntityState.Modified))
        {
            if (entry.Entity.Role == UserRole.SuperAdmin)
            {
                entry.Entity.CanBeRestricted = false;
            }
        }

        return await base.SaveChangesAsync(cancellationToken);
    }

    private static void ConfigureUsers(ModelBuilder modelBuilder)
    {
        modelBuilder.Entity<User>(entity =>
        {
            entity.Property(user => user.FirstName).HasMaxLength(100).IsRequired();
            entity.Property(user => user.LastName).HasMaxLength(100).IsRequired();
            entity.Property(user => user.Email).HasMaxLength(320);
            entity.Property(user => user.Username).HasMaxLength(100);
            entity.Property(user => user.PasswordHash).HasMaxLength(500).IsRequired();
            entity.Property(user => user.PhoneNumber).HasMaxLength(30);
            entity.Property(user => user.PasswordSetupRequired).HasDefaultValue(false);
            entity.Property(user => user.SecurityStampVersion).HasDefaultValue(0);
            entity.Property(user => user.CanBeRestricted).HasDefaultValue(true);
            entity.HasIndex(user => user.Email)
                .IsUnique()
                .HasFilter("[Email] IS NOT NULL AND [Email] <> ''");
            entity.HasIndex(user => user.PhoneNumber)
                .IsUnique()
                .HasFilter("[PhoneNumber] IS NOT NULL AND [PhoneNumber] <> ''");
            entity.HasOne(user => user.ParentUser)
                .WithMany(user => user.Children)
                .HasForeignKey(user => user.ParentUserId)
                .OnDelete(DeleteBehavior.Restrict);
        });
    }

    private static void ConfigurePasswordSetupTokens(ModelBuilder modelBuilder)
    {
        modelBuilder.Entity<PasswordSetupToken>(entity =>
        {
            entity.Property(token => token.TokenHash).HasMaxLength(128).IsRequired();
            entity.HasIndex(token => token.TokenHash).IsUnique();
            entity.HasIndex(token => new { token.UserId, token.UsedAtUtc, token.ExpiresAtUtc });
            entity.HasOne(token => token.User)
                .WithMany(user => user.PasswordSetupTokens)
                .HasForeignKey(token => token.UserId)
                .OnDelete(DeleteBehavior.Cascade);
        });
    }

    private static void ConfigureMobileOtpCodes(ModelBuilder modelBuilder)
    {
        modelBuilder.Entity<MobileOtpCode>(entity =>
        {
            entity.Property(code => code.Mobile).HasMaxLength(30).IsRequired();
            entity.Property(code => code.CodeHash).HasMaxLength(128).IsRequired();
            entity.HasIndex(code => new { code.Mobile, code.CreatedAtUtc });
            entity.HasIndex(code => new { code.Mobile, code.UsedAtUtc, code.ExpiresAtUtc });
            entity.HasOne(code => code.User)
                .WithMany()
                .HasForeignKey(code => code.UserId)
                .OnDelete(DeleteBehavior.Cascade);
        });
    }

    private static void ConfigurePermissions(ModelBuilder modelBuilder)
    {
        modelBuilder.Entity<Permission>(entity =>
        {
            entity.Property(permission => permission.Name).HasMaxLength(150).IsRequired();
            entity.Property(permission => permission.Description).HasMaxLength(1000);
            entity.HasAlternateKey(permission => permission.Key);
        });

        modelBuilder.Entity<UserPermission>(entity =>
        {
            entity.HasIndex(permission => new
            {
                permission.UserId,
                permission.PermissionKey
            }).IsUnique().HasFilter(null);
            entity.HasOne(permission => permission.User)
                .WithMany(user => user.UserPermissions)
                .HasForeignKey(permission => permission.UserId)
                .OnDelete(DeleteBehavior.NoAction);
            entity.HasOne(permission => permission.Permission)
                .WithMany(permission => permission.UserPermissions)
                .HasForeignKey(permission => permission.PermissionKey)
                .HasPrincipalKey(permission => permission.Key)
                .OnDelete(DeleteBehavior.NoAction);
        });
    }

    private static void ConfigureNotifications(ModelBuilder modelBuilder)
    {
        modelBuilder.Entity<NotificationSubscription>(entity =>
        {
            entity.Property(subscription => subscription.IsEnabled).HasDefaultValue(true);
            entity.HasIndex(subscription => new
            {
                subscription.UserId,
                subscription.PropertyId,
                subscription.EventType,
                subscription.Channel
            }).IsUnique().HasFilter(null);
            entity.HasOne(subscription => subscription.User)
                .WithMany(user => user.NotificationSubscriptions)
                .HasForeignKey(subscription => subscription.UserId)
                .OnDelete(DeleteBehavior.NoAction);
            entity.HasOne(subscription => subscription.Property)
                .WithMany(property => property.NotificationSubscriptions)
                .HasForeignKey(subscription => subscription.PropertyId)
                .OnDelete(DeleteBehavior.NoAction);
        });

        modelBuilder.Entity<NotificationLog>(entity =>
        {
            entity.Property(log => log.Recipient).HasMaxLength(500).IsRequired();
            entity.Property(log => log.Mobile).HasMaxLength(30);
            entity.Property(log => log.Email).HasMaxLength(320);
            entity.Property(log => log.Subject).HasMaxLength(500);
            entity.Property(log => log.Message).HasMaxLength(4000).IsRequired();
            entity.Property(log => log.DataJson).HasMaxLength(4000);
            entity.Property(log => log.Error).HasMaxLength(4000);
            entity.HasIndex(log => log.Status);
            entity.HasIndex(log => log.SentAtUtc);
            entity.HasOne(log => log.RecipientUser)
                .WithMany(user => user.NotificationLogs)
                .HasForeignKey(log => log.RecipientUserId)
                .OnDelete(DeleteBehavior.NoAction);
            entity.HasOne(log => log.RecipientGuest)
                .WithMany(guest => guest.NotificationLogs)
                .HasForeignKey(log => log.RecipientGuestId)
                .OnDelete(DeleteBehavior.NoAction);
            entity.HasOne(log => log.Property)
                .WithMany(property => property.NotificationLogs)
                .HasForeignKey(log => log.PropertyId)
                .OnDelete(DeleteBehavior.NoAction);
            entity.HasOne(log => log.Reservation)
                .WithMany(reservation => reservation.NotificationLogs)
                .HasForeignKey(log => log.ReservationId)
                .OnDelete(DeleteBehavior.NoAction);
        });
    }

    private static void ConfigureUserPropertyAccesses(ModelBuilder modelBuilder)
    {
        modelBuilder.Entity<UserPropertyAccess>(entity =>
        {
            entity.Property(access => access.IsActive).HasDefaultValue(true);
            entity.Property(access => access.PermissionMatrixJson).HasDefaultValue("{}");
            entity.HasIndex(access => new { access.UserId, access.PropertyId }).IsUnique();
            entity.HasOne(access => access.User)
                .WithMany(user => user.UserPropertyAccesses)
                .HasForeignKey(access => access.UserId)
                .OnDelete(DeleteBehavior.NoAction);
            entity.HasOne(access => access.Property)
                .WithMany(property => property.UserPropertyAccesses)
                .HasForeignKey(access => access.PropertyId)
                .OnDelete(DeleteBehavior.NoAction);
        });
    }

    private static void ConfigureProperties(ModelBuilder modelBuilder)
    {
        modelBuilder.Entity<Property>(entity =>
        {
            entity.Property(property => property.Name).HasMaxLength(200).IsRequired();
            entity.Property(property => property.EnglishName).HasMaxLength(200);
            entity.Property(property => property.Slug).HasMaxLength(220).IsRequired();
            entity.Property(property => property.Description).HasMaxLength(4000);
            entity.Property(property => property.SeoTitle).HasMaxLength(200);
            entity.Property(property => property.SeoDescription).HasMaxLength(500);
            entity.Property(property => property.Address).HasMaxLength(500).IsRequired();
            entity.Property(property => property.City).HasMaxLength(100).IsRequired();
            entity.Property(property => property.Country).HasMaxLength(100).IsRequired();
            entity.Property(property => property.Latitude).HasPrecision(9, 6);
            entity.Property(property => property.Longitude).HasPrecision(9, 6);
            entity.Property(property => property.TotalAreaM2).HasPrecision(12, 2);
            entity.Property(property => property.LandAreaM2).HasPrecision(12, 2);
            entity.Property(property => property.BreakfastPrice).HasPrecision(18, 2);
            entity.Property(property => property.ChildPrice).HasPrecision(18, 2);
            entity.Property(property => property.ExtraGuestPrice).HasPrecision(18, 2);
            entity.HasIndex(property => property.Slug).IsUnique();
            entity.HasOne(property => property.Owner)
                .WithMany(user => user.OwnedProperties)
                .HasForeignKey(property => property.OwnerId)
                .OnDelete(DeleteBehavior.Restrict);
            entity.HasOne(property => property.Destination)
                .WithMany(destination => destination.Properties)
                .HasForeignKey(property => property.DestinationId)
                .OnDelete(DeleteBehavior.Restrict);
        });

        modelBuilder.Entity<PropertyHighlight>(entity =>
        {
            entity.Property(highlight => highlight.Slug).HasMaxLength(150).IsRequired();
            entity.Property(highlight => highlight.Title).HasMaxLength(200).IsRequired();
            entity.Property(highlight => highlight.Description).HasMaxLength(1000);
            entity.Property(highlight => highlight.Icon).HasMaxLength(100);
            entity.HasIndex(highlight => new { highlight.PropertyId, highlight.Slug }).IsUnique();
            entity.HasOne(highlight => highlight.Property)
                .WithMany(property => property.Highlights)
                .HasForeignKey(highlight => highlight.PropertyId)
                .OnDelete(DeleteBehavior.Cascade);
        });

        modelBuilder.Entity<PropertyWarning>(entity =>
        {
            entity.Property(warning => warning.Title).HasMaxLength(200).IsRequired();
            entity.Property(warning => warning.Description).HasMaxLength(1000);
            entity.HasOne(warning => warning.Property)
                .WithMany(property => property.Warnings)
                .HasForeignKey(warning => warning.PropertyId)
                .OnDelete(DeleteBehavior.Cascade);
        });

        modelBuilder.Entity<NearbyPlace>(entity =>
        {
            entity.Property(place => place.Title).HasMaxLength(200).IsRequired();
            entity.Property(place => place.Description).HasMaxLength(1000);
            entity.Property(place => place.Latitude).HasPrecision(9, 6);
            entity.Property(place => place.Longitude).HasPrecision(9, 6);
            entity.Property(place => place.IsActive).HasDefaultValue(true);
            entity.HasIndex(place => new { place.PropertyId, place.Category });
            entity.HasIndex(place => new { place.PropertyId, place.Title });
            entity.HasOne(place => place.Property)
                .WithMany(property => property.NearbyPlaces)
                .HasForeignKey(place => place.PropertyId)
                .OnDelete(DeleteBehavior.Cascade);
        });
    }

    private static void ConfigurePropertyCommonAreas(ModelBuilder modelBuilder)
    {
        modelBuilder.Entity<PropertyCommonArea>(entity =>
        {
            entity.Property(area => area.Name).HasMaxLength(200).IsRequired();
            entity.Property(area => area.Description).HasMaxLength(1000);
            entity.HasIndex(area => new { area.PropertyId, area.SortOrder });
            entity.HasOne(area => area.Property)
                .WithMany(property => property.CommonAreas)
                .HasForeignKey(area => area.PropertyId)
                .OnDelete(DeleteBehavior.Cascade);
        });
    }

    private static void ConfigurePropertyViews(ModelBuilder modelBuilder)
    {
        modelBuilder.Entity<PropertyView>(entity =>
        {
            entity.HasIndex(view => new { view.PropertyId, view.ViewType }).IsUnique();
            entity.HasOne(view => view.Property)
                .WithMany(property => property.Views)
                .HasForeignKey(view => view.PropertyId)
                .OnDelete(DeleteBehavior.Cascade);
        });
    }

    private static void ConfigurePropertyDescriptionSections(ModelBuilder modelBuilder)
    {
        modelBuilder.Entity<PropertyDescriptionSection>(entity =>
        {
            entity.Property(section => section.Title).HasMaxLength(200).IsRequired();
            entity.Property(section => section.Content).HasMaxLength(4000).IsRequired();
            entity.HasIndex(section => new { section.PropertyId, section.SectionType, section.SortOrder });
            entity.HasOne(section => section.Property)
                .WithMany(property => property.DescriptionSections)
                .HasForeignKey(section => section.PropertyId)
                .OnDelete(DeleteBehavior.Cascade);
        });
    }

    private static void ConfigureDestinationsAndSeo(ModelBuilder modelBuilder)
    {
        modelBuilder.Entity<Destination>(entity =>
        {
            entity.Property(destination => destination.Name).HasMaxLength(200).IsRequired();
            entity.Property(destination => destination.Slug).HasMaxLength(220).IsRequired();
            entity.Property(destination => destination.Country).HasMaxLength(100);
            entity.Property(destination => destination.Latitude).HasPrecision(9, 6);
            entity.Property(destination => destination.Longitude).HasPrecision(9, 6);
            entity.HasIndex(destination => destination.Slug).IsUnique();
            entity.HasOne(destination => destination.ParentDestination)
                .WithMany(destination => destination.Children)
                .HasForeignKey(destination => destination.ParentDestinationId)
                .OnDelete(DeleteBehavior.Restrict);
        });

        modelBuilder.Entity<DefaultNearbyPlace>(entity =>
        {
            entity.Property(place => place.Title).HasMaxLength(200).IsRequired();
            entity.Property(place => place.Description).HasMaxLength(1000);
            entity.Property(place => place.Latitude).HasPrecision(9, 6);
            entity.Property(place => place.Longitude).HasPrecision(9, 6);
            entity.Property(place => place.IsActive).HasDefaultValue(true);
            entity.HasIndex(place => new { place.DestinationId, place.Title }).IsUnique();
            entity.HasOne(place => place.Destination)
                .WithMany(destination => destination.DefaultNearbyPlaces)
                .HasForeignKey(place => place.DestinationId)
                .OnDelete(DeleteBehavior.Restrict);
        });

        modelBuilder.Entity<SeoMetadata>(entity =>
        {
            entity.Property(metadata => metadata.PageKey).HasMaxLength(200);
            entity.Property(metadata => metadata.Title).HasMaxLength(200).IsRequired();
            entity.Property(metadata => metadata.Description).HasMaxLength(500).IsRequired();
            entity.Property(metadata => metadata.Keywords).HasMaxLength(1000);
            entity.Property(metadata => metadata.CanonicalUrl).HasMaxLength(2000);
            entity.Property(metadata => metadata.OpenGraphImageUrl).HasMaxLength(2000);
            entity.HasIndex(metadata => metadata.PropertyId).IsUnique()
                .HasFilter("[PropertyId] IS NOT NULL");
            entity.HasIndex(metadata => metadata.DestinationId).IsUnique()
                .HasFilter("[DestinationId] IS NOT NULL");
            entity.HasIndex(metadata => metadata.PageKey).IsUnique()
                .HasFilter("[PageKey] IS NOT NULL");
            entity.ToTable(table => table.HasCheckConstraint(
                "CK_SeoMetadata_Target",
                "(CASE WHEN [PropertyId] IS NULL THEN 0 ELSE 1 END + CASE WHEN [DestinationId] IS NULL THEN 0 ELSE 1 END + CASE WHEN [PageKey] IS NULL THEN 0 ELSE 1 END) = 1"));
            entity.HasOne(metadata => metadata.Property)
                .WithOne(property => property.SeoMetadata)
                .HasForeignKey<SeoMetadata>(metadata => metadata.PropertyId)
                .OnDelete(DeleteBehavior.NoAction);
            entity.HasOne(metadata => metadata.Destination)
                .WithOne(destination => destination.SeoMetadata)
                .HasForeignKey<SeoMetadata>(metadata => metadata.DestinationId)
                .OnDelete(DeleteBehavior.NoAction);
        });
    }

    private static void ConfigureRoomTypes(ModelBuilder modelBuilder)
    {
        modelBuilder.Entity<RoomType>(entity =>
        {
            entity.Property(roomType => roomType.Name).HasMaxLength(150).IsRequired();
            entity.Property(roomType => roomType.EnglishName).HasMaxLength(150);
            entity.Property(roomType => roomType.Slug).HasMaxLength(170).IsRequired();
            entity.Property(roomType => roomType.Description).HasMaxLength(3000);
            entity.Property(roomType => roomType.SeoTitle).HasMaxLength(200);
            entity.Property(roomType => roomType.SeoDescription).HasMaxLength(500);
            entity.Property(roomType => roomType.Notes).HasMaxLength(2000);
            entity.Property(roomType => roomType.BasePrice).HasPrecision(18, 2);
            entity.HasIndex(roomType => new { roomType.PropertyId, roomType.Slug }).IsUnique();
            entity.HasOne(roomType => roomType.Property)
                .WithMany(property => property.RoomTypes)
                .HasForeignKey(roomType => roomType.PropertyId)
                .OnDelete(DeleteBehavior.Restrict);
        });
    }

    private static void ConfigureRooms(ModelBuilder modelBuilder)
    {
        modelBuilder.Entity<Room>(entity =>
        {
            entity.Property(room => room.Name).HasMaxLength(100).IsRequired();
            entity.Property(room => room.EnglishName).HasMaxLength(100);
            entity.Property(room => room.Description).HasMaxLength(3000);
            entity.Property(room => room.Notes).HasMaxLength(2000);
            entity.HasIndex(room => new { room.RoomTypeId, room.Name }).IsUnique();
            entity.HasOne(room => room.RoomType)
                .WithMany(roomType => roomType.Rooms)
                .HasForeignKey(room => room.RoomTypeId)
                .OnDelete(DeleteBehavior.Restrict);
        });
    }

    private static void ConfigureBeds(ModelBuilder modelBuilder)
    {
        modelBuilder.Entity<BedType>(entity =>
        {
            entity.Property(bedType => bedType.Name).HasMaxLength(150).IsRequired();
            entity.Property(bedType => bedType.Slug).HasMaxLength(170).IsRequired();
            entity.HasIndex(bedType => bedType.Slug).IsUnique();
        });

        modelBuilder.Entity<RoomTypeBed>(entity =>
        {
            entity.HasIndex(configuration => new { configuration.RoomTypeId, configuration.BedTypeId }).IsUnique();
            entity.HasOne(configuration => configuration.RoomType)
                .WithMany(roomType => roomType.BedConfigurations)
                .HasForeignKey(configuration => configuration.RoomTypeId)
                .OnDelete(DeleteBehavior.Cascade);
            entity.HasOne(configuration => configuration.BedType)
                .WithMany(bedType => bedType.RoomTypeBeds)
                .HasForeignKey(configuration => configuration.BedTypeId)
                .OnDelete(DeleteBehavior.Restrict);
        });
    }

    private static void ConfigureAvailability(ModelBuilder modelBuilder)
    {
        modelBuilder.Entity<Availability>(entity =>
        {
            entity.Property(availability => availability.Price).HasPrecision(18, 2);
            entity.Property(availability => availability.OriginalPrice).HasPrecision(18, 2);
            entity.Property(availability => availability.RowVersion).IsRowVersion();
            entity.HasIndex(availability => new { availability.RoomTypeId, availability.Date }).IsUnique();
            entity.HasIndex(availability => new
            {
                availability.RoomTypeId,
                availability.Date,
                availability.Status
            });
            entity.HasOne(availability => availability.RoomType)
                .WithMany(roomType => roomType.Availability)
                .HasForeignKey(availability => availability.RoomTypeId)
                .OnDelete(DeleteBehavior.Restrict);
        });
    }

    private static void ConfigureRoomDailyPrices(ModelBuilder modelBuilder)
    {
        modelBuilder.Entity<RoomDailyPrice>(entity =>
        {
            entity.Property(price => price.GuestType)
                .HasConversion<string>()
                .HasMaxLength(20)
                .HasDefaultValue(PricingGuestType.Iranian);
            entity.Property(price => price.BasePrice).HasPrecision(18, 2);
            entity.HasIndex(price => new { price.RoomTypeId, price.Date, price.GuestType }).IsUnique();
            entity.HasOne(price => price.RoomType)
                .WithMany(roomType => roomType.DailyPrices)
                .HasForeignKey(price => price.RoomTypeId)
                .OnDelete(DeleteBehavior.Restrict);
        });

        modelBuilder.Entity<RoomDailyPriceHistory>(entity =>
        {
            entity.Property(history => history.GuestType)
                .HasConversion<string>()
                .HasMaxLength(20)
                .HasDefaultValue(PricingGuestType.Iranian);
            entity.Property(history => history.OldBasePrice).HasPrecision(18, 2);
            entity.Property(history => history.NewBasePrice).HasPrecision(18, 2);
            entity.Property(history => history.OldChildPrice).HasPrecision(18, 2);
            entity.Property(history => history.NewChildPrice).HasPrecision(18, 2);
            entity.Property(history => history.OldExtraGuestPrice).HasPrecision(18, 2);
            entity.Property(history => history.NewExtraGuestPrice).HasPrecision(18, 2);
            entity.HasIndex(history => new { history.PropertyId, history.ChangedAtUtc });
            entity.HasIndex(history => new { history.RoomTypeId, history.GuestType, history.ChangedAtUtc });
            entity.HasOne(history => history.RoomType)
                .WithMany(roomType => roomType.DailyPriceHistory)
                .HasForeignKey(history => history.RoomTypeId)
                .OnDelete(DeleteBehavior.Restrict);
            entity.HasOne(history => history.User)
                .WithMany()
                .HasForeignKey(history => history.ChangedByUserId)
                .OnDelete(DeleteBehavior.NoAction);
        });
    }

    private static void ConfigureCoupons(ModelBuilder modelBuilder)
    {
        modelBuilder.Entity<Coupon>(entity =>
        {
            entity.Property(coupon => coupon.Code).HasMaxLength(64).IsRequired();
            entity.Property(coupon => coupon.Title).HasMaxLength(150).IsRequired();
            entity.Property(coupon => coupon.Description).HasMaxLength(1000);
            entity.Property(coupon => coupon.Percentage).HasPrecision(5, 2);
            entity.Property(coupon => coupon.Amount).HasPrecision(18, 2);
            entity.Property(coupon => coupon.MinimumOrderAmount).HasPrecision(18, 2);
            entity.HasIndex(coupon => coupon.Code).IsUnique();
            entity.HasIndex(coupon => new { coupon.IsActive, coupon.StartDate, coupon.EndDate });
        });

        modelBuilder.Entity<CouponUsage>(entity =>
        {
            entity.Property(usage => usage.DiscountAmount).HasPrecision(18, 2);
            entity.HasIndex(usage => new { usage.CouponId, usage.UserId });
            entity.HasIndex(usage => usage.ReservationId);
            entity.HasOne(usage => usage.Coupon).WithMany(coupon => coupon.Usages)
                .HasForeignKey(usage => usage.CouponId).OnDelete(DeleteBehavior.Restrict);
            entity.HasOne(usage => usage.User).WithMany()
                .HasForeignKey(usage => usage.UserId).OnDelete(DeleteBehavior.NoAction);
            entity.HasOne(usage => usage.Reservation).WithMany()
                .HasForeignKey(usage => usage.ReservationId).OnDelete(DeleteBehavior.NoAction);
        });
    }

    private static void ConfigureAuditLogs(ModelBuilder modelBuilder)
    {
        modelBuilder.Entity<AuditLog>(entity =>
        {
            entity.Property(log => log.Action)
                .HasConversion<string>()
                .HasMaxLength(60)
                .IsRequired();
            entity.Property(log => log.EntityType).HasMaxLength(100).IsRequired();
            entity.Property(log => log.EntityName).HasMaxLength(300);
            entity.Property(log => log.Description).HasMaxLength(1000);
            entity.HasIndex(log => new { log.PropertyId, log.OccurredAtUtc });
            entity.HasIndex(log => new { log.UserId, log.OccurredAtUtc });
            entity.HasIndex(log => new { log.EntityType, log.EntityId });
            entity.HasOne(log => log.User)
                .WithMany()
                .HasForeignKey(log => log.UserId)
                .OnDelete(DeleteBehavior.NoAction);
            entity.HasOne(log => log.Property)
                .WithMany()
                .HasForeignKey(log => log.PropertyId)
                .OnDelete(DeleteBehavior.NoAction);
        });
    }

    private static void ConfigureHolidayCalendar(ModelBuilder modelBuilder)
    {
        modelBuilder.Entity<HolidayCalendarDay>(entity =>
        {
            entity.ToTable(table =>
            {
                table.HasCheckConstraint(
                    "CK_HolidayCalendarDays_DayOfWeek",
                    "[DayOfWeek] BETWEEN 0 AND 6");
                table.HasCheckConstraint(
                    "CK_HolidayCalendarDays_HolidayClassification",
                    "([IsWeeklyHoliday] = 1 AND [IsOfficialHoliday] = 0 AND [DayOfWeek] = 5) OR " +
                    "([IsWeeklyHoliday] = 0 AND [IsOfficialHoliday] = 1 AND [DayOfWeek] <> 5)");
            });
            entity.Property(day => day.ProviderName).HasMaxLength(100).IsRequired();
            entity.HasIndex(day => day.GregorianDate).IsUnique();
            entity.HasIndex(day => new { day.SolarYear, day.SolarMonth, day.SolarDay }).IsUnique();
            entity.HasIndex(day => new { day.SolarYear, day.SolarMonth });
            entity.HasMany(day => day.Occasions)
                .WithOne(occasion => occasion.HolidayCalendarDay)
                .HasForeignKey(occasion => occasion.HolidayCalendarDayId)
                .OnDelete(DeleteBehavior.Cascade);
            entity.HasOne(day => day.Override)
                .WithOne(dayOverride => dayOverride.HolidayCalendarDay)
                .HasForeignKey<HolidayCalendarDayOverride>(dayOverride => dayOverride.HolidayCalendarDayId)
                .OnDelete(DeleteBehavior.Cascade);
        });

        modelBuilder.Entity<HolidayCalendarOccasion>(entity =>
        {
            entity.Property(occasion => occasion.Title).HasMaxLength(512).IsRequired();
            entity.Property(occasion => occasion.NormalizedTitle).HasMaxLength(512).IsRequired();
            entity.HasIndex(occasion => occasion.HolidayCalendarDayId);
            entity.HasIndex(occasion => new
            {
                occasion.HolidayCalendarDayId,
                occasion.Source,
                occasion.NormalizedTitle
            }).IsUnique();
        });

        modelBuilder.Entity<HolidayCalendarDayOverride>(entity =>
        {
            entity.Property(dayOverride => dayOverride.Note).HasMaxLength(1000);
            entity.HasIndex(dayOverride => dayOverride.HolidayCalendarDayId).IsUnique();
        });

        modelBuilder.Entity<HolidayCalendarSyncState>(entity =>
        {
            entity.Property(state => state.ProviderName).HasMaxLength(100).IsRequired();
            entity.Property(state => state.LastResponseHash).HasMaxLength(128);
            entity.Property(state => state.LastErrorSummary).HasMaxLength(1000);
            entity.Property(state => state.LeaseOwner).HasMaxLength(200);
            entity.Property(state => state.RowVersion).IsRowVersion();
            entity.HasIndex(state => state.ProviderName).IsUnique();
        });
    }

    private static void ConfigureReservations(ModelBuilder modelBuilder)
    {
        modelBuilder.Entity<Reservation>(entity =>
        {
            entity.Property(reservation => reservation.TotalPrice).HasPrecision(18, 2);
            entity.Property(reservation => reservation.BaseAmount).HasPrecision(18, 2);
            entity.Property(reservation => reservation.DiscountAmount).HasPrecision(18, 2);
            entity.Property(reservation => reservation.ExtraGuestAmount).HasPrecision(18, 2);
            entity.Property(reservation => reservation.ServiceFeeAmount).HasPrecision(18, 2);
            entity.Property(reservation => reservation.ManualAdjustment).HasPrecision(18, 2);
            entity.Property(reservation => reservation.FinalAmount).HasPrecision(18, 2);
            entity.Property(reservation => reservation.Currency).HasMaxLength(3).IsRequired();
            entity.Property(reservation => reservation.ReservationNumber).HasMaxLength(32);
            entity.Property(reservation => reservation.GuestNote).HasMaxLength(2000);
            entity.Property(reservation => reservation.CancellationNote).HasMaxLength(2000);
            entity.Property(reservation => reservation.RowVersion).IsRowVersion();
            entity.HasIndex(reservation => new
            {
                reservation.PropertyId,
                reservation.CheckInDate,
                reservation.CheckOutDate
            });
            entity.HasIndex(reservation => new
            {
                reservation.RoomTypeId,
                reservation.CheckInDate,
                reservation.CheckOutDate,
                reservation.Status
            });
            entity.HasIndex(reservation => reservation.ClientId);
            entity.HasIndex(reservation => reservation.GuestId);
            entity.HasIndex(reservation => reservation.ReservationNumber)
                .IsUnique()
                .HasFilter("[ReservationNumber] IS NOT NULL AND [ReservationNumber] <> ''");
            entity.HasIndex(reservation => reservation.Status);
            entity.HasIndex(reservation => new { reservation.Status, reservation.HoldUntilUtc });
            entity.HasIndex(reservation => new { reservation.Status, reservation.PaymentExpiresAtUtc });
            entity.HasOne(reservation => reservation.Client)
                .WithMany(user => user.Reservations)
                .HasForeignKey(reservation => reservation.ClientId)
                .OnDelete(DeleteBehavior.NoAction);
            entity.HasOne(reservation => reservation.ApprovedByUser)
                .WithMany()
                .HasForeignKey(reservation => reservation.ApprovedByUserId)
                .OnDelete(DeleteBehavior.NoAction);
            entity.HasOne(reservation => reservation.CancelledByUser)
                .WithMany()
                .HasForeignKey(reservation => reservation.CancelledByUserId)
                .OnDelete(DeleteBehavior.NoAction);
            entity.HasOne(reservation => reservation.Guest)
                .WithMany(guest => guest.Reservations)
                .HasForeignKey(reservation => reservation.GuestId)
                .OnDelete(DeleteBehavior.NoAction);
            entity.HasOne(reservation => reservation.Property)
                .WithMany(property => property.Reservations)
                .HasForeignKey(reservation => reservation.PropertyId)
                .OnDelete(DeleteBehavior.NoAction);
            entity.HasOne(reservation => reservation.RoomType)
                .WithMany(roomType => roomType.Reservations)
                .HasForeignKey(reservation => reservation.RoomTypeId)
                .OnDelete(DeleteBehavior.NoAction);
            entity.HasOne(reservation => reservation.Room)
                .WithMany(room => room.Reservations)
                .HasForeignKey(reservation => reservation.RoomId)
                .OnDelete(DeleteBehavior.NoAction);
            entity.HasOne(reservation => reservation.RatePlan)
                .WithMany(ratePlan => ratePlan.Reservations)
                .HasForeignKey(reservation => reservation.RatePlanId)
                .OnDelete(DeleteBehavior.NoAction);
        });
    }

    private static void ConfigureGuests(ModelBuilder modelBuilder)
    {
        modelBuilder.Entity<Guest>(entity =>
        {
            entity.Property(guest => guest.FirstName).HasMaxLength(100).IsRequired();
            entity.Property(guest => guest.LastName).HasMaxLength(100).IsRequired();
            entity.Property(guest => guest.Mobile).HasMaxLength(30);
            entity.Property(guest => guest.NormalizedMobile).HasMaxLength(30);
            entity.Property(guest => guest.Email).HasMaxLength(320);
            entity.Property(guest => guest.NormalizedEmail).HasMaxLength(320);
            entity.Property(guest => guest.NationalCode).HasMaxLength(20);
            entity.Property(guest => guest.PassportNumber).HasMaxLength(50);
            entity.Property(guest => guest.Nationality).HasMaxLength(100);
            entity.Property(guest => guest.Gender).HasMaxLength(50);
            entity.Property(guest => guest.Address).HasMaxLength(1000);
            entity.Property(guest => guest.Notes).HasMaxLength(2000);
            entity.HasIndex(guest => guest.UserId)
                .IsUnique()
                .HasFilter("[UserId] IS NOT NULL");
            entity.HasIndex(guest => guest.NormalizedMobile);
            entity.HasIndex(guest => guest.NormalizedEmail);
            entity.HasIndex(guest => guest.NationalCode);
            entity.HasIndex(guest => guest.PassportNumber);
            entity.HasOne(guest => guest.User)
                .WithOne(user => user.Guest)
                .HasForeignKey<Guest>(guest => guest.UserId)
                .OnDelete(DeleteBehavior.NoAction);
        });
    }

    private static void ConfigurePayments(ModelBuilder modelBuilder)
    {
        modelBuilder.Entity<Payment>(entity =>
        {
            entity.Property(payment => payment.Amount).HasPrecision(18, 2);
            entity.Property(payment => payment.Currency).HasMaxLength(3).IsRequired();
            entity.Property(payment => payment.Provider).HasMaxLength(100);
            entity.Property(payment => payment.TransactionReference).HasMaxLength(200);
            entity.HasOne(payment => payment.Reservation)
                .WithMany(reservation => reservation.Payments)
                .HasForeignKey(payment => payment.ReservationId)
                .OnDelete(DeleteBehavior.NoAction);
        });
    }

    private static void ConfigureReservationPaymentLinkTokens(ModelBuilder modelBuilder)
    {
        modelBuilder.Entity<ReservationPaymentLinkToken>(entity =>
        {
            entity.Property(token => token.TokenHash).HasMaxLength(128).IsRequired();
            entity.HasIndex(token => token.TokenHash).IsUnique();
            entity.HasIndex(token => new { token.ReservationId, token.UsedAtUtc, token.ExpiresAtUtc });
            entity.HasOne(token => token.Reservation)
                .WithMany(reservation => reservation.PaymentLinkTokens)
                .HasForeignKey(token => token.ReservationId)
                .OnDelete(DeleteBehavior.Cascade);
        });
    }

    private static void ConfigureReviews(ModelBuilder modelBuilder)
    {
        modelBuilder.Entity<Review>(entity =>
        {
            entity.Property(review => review.Title).HasMaxLength(200);
            entity.Property(review => review.Comment).HasMaxLength(4000).IsRequired();
            entity.ToTable(table => table.HasCheckConstraint(
                "CK_Review_DetailedRatings",
                "([CleanlinessRating] IS NULL OR [CleanlinessRating] BETWEEN 1 AND 5) AND ([LocationRating] IS NULL OR [LocationRating] BETWEEN 1 AND 5) AND ([StaffRating] IS NULL OR [StaffRating] BETWEEN 1 AND 5) AND ([ValueRating] IS NULL OR [ValueRating] BETWEEN 1 AND 5)"));
            entity.HasOne(review => review.Property)
                .WithMany(property => property.Reviews)
                .HasForeignKey(review => review.PropertyId)
                .OnDelete(DeleteBehavior.NoAction);
            entity.HasOne(review => review.Client)
                .WithMany(user => user.Reviews)
                .HasForeignKey(review => review.ClientId)
                .OnDelete(DeleteBehavior.NoAction);
            entity.HasOne(review => review.Reservation)
                .WithMany(reservation => reservation.Reviews)
                .HasForeignKey(review => review.ReservationId)
                .OnDelete(DeleteBehavior.NoAction);
        });
    }

    private static void ConfigureAmenities(ModelBuilder modelBuilder)
    {
        modelBuilder.Entity<AmenityCategory>(entity =>
        {
            entity.Property(category => category.Name).HasMaxLength(150).IsRequired();
            entity.Property(category => category.Slug).HasMaxLength(170).IsRequired();
            entity.Property(category => category.Icon).HasMaxLength(100);
            entity.Property(category => category.IsActive).HasDefaultValue(true);
            entity.HasIndex(category => category.Slug).IsUnique();
        });

        modelBuilder.Entity<Amenity>(entity =>
        {
            entity.Property(amenity => amenity.Name).HasMaxLength(150).IsRequired();
            entity.Property(amenity => amenity.Slug).HasMaxLength(170).IsRequired();
            entity.Property(amenity => amenity.Description).HasMaxLength(1000);
            entity.Property(amenity => amenity.Icon).HasMaxLength(100);
            entity.HasIndex(amenity => amenity.Slug).IsUnique();
            entity.HasIndex(amenity => new { amenity.AmenityCategoryId, amenity.SortOrder });
            entity.HasOne(amenity => amenity.AmenityCategory)
                .WithMany(category => category.Amenities)
                .HasForeignKey(amenity => amenity.AmenityCategoryId)
                .OnDelete(DeleteBehavior.Restrict);
        });

        modelBuilder.Entity<PropertyAmenity>(entity =>
        {
            entity.HasIndex(join => new { join.PropertyId, join.AmenityId }).IsUnique();
            entity.HasOne(join => join.Property).WithMany(property => property.PropertyAmenities)
                .HasForeignKey(join => join.PropertyId).OnDelete(DeleteBehavior.Cascade);
            entity.HasOne(join => join.Amenity).WithMany(amenity => amenity.PropertyAmenities)
                .HasForeignKey(join => join.AmenityId).OnDelete(DeleteBehavior.Restrict);
        });

        modelBuilder.Entity<RoomTypeAmenity>(entity =>
        {
            entity.HasIndex(join => new { join.RoomTypeId, join.AmenityId }).IsUnique();
            entity.HasOne(join => join.RoomType).WithMany(roomType => roomType.RoomTypeAmenities)
                .HasForeignKey(join => join.RoomTypeId).OnDelete(DeleteBehavior.Cascade);
            entity.HasOne(join => join.Amenity).WithMany(amenity => amenity.RoomTypeAmenities)
                .HasForeignKey(join => join.AmenityId).OnDelete(DeleteBehavior.Restrict);
        });
    }

    private static void ConfigureImages(ModelBuilder modelBuilder)
    {
        modelBuilder.Entity<PropertyImage>(entity =>
        {
            entity.Property(image => image.Url).HasMaxLength(2000).IsRequired();
            entity.Property(image => image.AltText).HasMaxLength(300);
            entity.Property(image => image.Caption).HasMaxLength(500);
            entity.Property(image => image.Tag).HasMaxLength(100);
            entity.Property(image => image.IsGallery).HasDefaultValue(true);
            entity.HasIndex(image => new { image.PropertyId, image.Tag });
            entity.HasIndex(image => image.RoomTypeId);
            entity.HasIndex(image => image.RoomId);
            entity.HasOne(image => image.Property).WithMany(property => property.Images)
                .HasForeignKey(image => image.PropertyId).OnDelete(DeleteBehavior.Cascade);
            entity.HasOne(image => image.RoomType).WithMany(roomType => roomType.PropertyImages)
                .HasForeignKey(image => image.RoomTypeId).OnDelete(DeleteBehavior.NoAction);
            entity.HasOne(image => image.Room).WithMany(room => room.PropertyImages)
                .HasForeignKey(image => image.RoomId).OnDelete(DeleteBehavior.NoAction);
        });

        modelBuilder.Entity<RoomTypeImage>(entity =>
        {
            entity.Property(image => image.Url).HasMaxLength(2000).IsRequired();
            entity.Property(image => image.AltText).HasMaxLength(300);
            entity.HasOne(image => image.RoomType).WithMany(roomType => roomType.Images)
                .HasForeignKey(image => image.RoomTypeId).OnDelete(DeleteBehavior.Cascade);
        });
    }

    private static void ConfigureTravelPurposes(ModelBuilder modelBuilder)
    {
        modelBuilder.Entity<TravelPurpose>(entity =>
        {
            entity.Property(purpose => purpose.Name).HasMaxLength(150).IsRequired();
            entity.Property(purpose => purpose.Slug).HasMaxLength(170).IsRequired();
            entity.Property(purpose => purpose.Description).HasMaxLength(1000);
            entity.HasIndex(purpose => purpose.Slug).IsUnique();
        });

        modelBuilder.Entity<PropertyTravelPurpose>(entity =>
        {
            entity.Property(join => join.Note).HasMaxLength(1000);
            entity.ToTable(table => table.HasCheckConstraint(
                "CK_PropertyTravelPurpose_Score", "[Score] IS NULL OR [Score] BETWEEN 0 AND 100"));
            entity.HasIndex(join => new { join.PropertyId, join.TravelPurposeId }).IsUnique();
            entity.HasOne(join => join.Property).WithMany(property => property.PropertyTravelPurposes)
                .HasForeignKey(join => join.PropertyId).OnDelete(DeleteBehavior.Cascade);
            entity.HasOne(join => join.TravelPurpose).WithMany(purpose => purpose.PropertyTravelPurposes)
                .HasForeignKey(join => join.TravelPurposeId).OnDelete(DeleteBehavior.Restrict);
        });
    }

    private static void ConfigurePoliciesAndPricing(ModelBuilder modelBuilder)
    {
        modelBuilder.Entity<CancellationPolicy>(entity =>
        {
            entity.Property(policy => policy.Name).HasMaxLength(150).IsRequired();
            entity.Property(policy => policy.Description).HasMaxLength(3000).IsRequired();
            entity.Property(policy => policy.PenaltyPercentage).HasPrecision(5, 2);
            entity.HasOne(policy => policy.Property).WithMany(property => property.CancellationPolicies)
                .HasForeignKey(policy => policy.PropertyId).OnDelete(DeleteBehavior.Cascade);
        });

        modelBuilder.Entity<StayRule>(entity =>
        {
            entity.ToTable(table => table.HasCheckConstraint(
                "CK_StayRule_Scope", "([PropertyId] IS NULL AND [RoomTypeId] IS NOT NULL) OR ([PropertyId] IS NOT NULL AND [RoomTypeId] IS NULL)"));
            entity.HasOne(rule => rule.Property).WithMany(property => property.StayRules)
                .HasForeignKey(rule => rule.PropertyId).OnDelete(DeleteBehavior.NoAction);
            entity.HasOne(rule => rule.RoomType).WithMany(roomType => roomType.StayRules)
                .HasForeignKey(rule => rule.RoomTypeId).OnDelete(DeleteBehavior.NoAction);
        });

        modelBuilder.Entity<Promotion>(entity =>
        {
            entity.Property(promotion => promotion.Title).HasMaxLength(150).IsRequired();
            entity.Property(promotion => promotion.InternalDescription).HasMaxLength(1000);
            entity.Property(promotion => promotion.PublicDescription).HasMaxLength(1000);
            entity.Property(promotion => promotion.OptionalIcon).HasMaxLength(20);
            entity.Property(promotion => promotion.BadgeColor).HasMaxLength(40);
            entity.Property(promotion => promotion.Percentage).HasPrecision(5, 2);
            entity.Property(promotion => promotion.Amount).HasPrecision(18, 2);
            entity.HasIndex(promotion => new { promotion.PropertyId, promotion.SortOrder });
            entity.HasIndex(promotion => new { promotion.SourcePromotionId, promotion.PropertyId });
            entity.HasOne(promotion => promotion.Property).WithMany(property => property.Promotions)
                .HasForeignKey(promotion => promotion.PropertyId).OnDelete(DeleteBehavior.NoAction);
            entity.HasOne(promotion => promotion.SourcePromotion).WithMany(promotion => promotion.OwnerActivations)
                .HasForeignKey(promotion => promotion.SourcePromotionId).OnDelete(DeleteBehavior.NoAction);
        });

        modelBuilder.Entity<PromotionRoomType>(entity =>
        {
            entity.HasKey(item => new { item.PromotionId, item.RoomTypeId });
            entity.HasQueryFilter(item => !item.Promotion.IsDeleted);
            entity.HasOne(item => item.Promotion).WithMany(promotion => promotion.PromotionRoomTypes)
                .HasForeignKey(item => item.PromotionId).OnDelete(DeleteBehavior.Cascade);
            entity.HasOne(item => item.RoomType).WithMany(roomType => roomType.PromotionRoomTypes)
                .HasForeignKey(item => item.RoomTypeId).OnDelete(DeleteBehavior.NoAction);
        });

        modelBuilder.Entity<RatePlan>(entity =>
        {
            entity.Property(plan => plan.Name).HasMaxLength(150).IsRequired();
            entity.Property(plan => plan.PriceModifierValue).HasPrecision(18, 2);
            entity.HasOne(plan => plan.RoomType).WithMany(roomType => roomType.RatePlans)
                .HasForeignKey(plan => plan.RoomTypeId).OnDelete(DeleteBehavior.Restrict);
            entity.HasOne(plan => plan.CancellationPolicy).WithMany(policy => policy.RatePlans)
                .HasForeignKey(plan => plan.CancellationPolicyId).OnDelete(DeleteBehavior.NoAction);
            entity.HasOne(plan => plan.MealPlan).WithMany(mealPlan => mealPlan.RatePlans)
                .HasForeignKey(plan => plan.MealPlanId).OnDelete(DeleteBehavior.Restrict);
        });

        modelBuilder.Entity<MealPlan>(entity =>
        {
            entity.Property(mealPlan => mealPlan.Name).HasMaxLength(150).IsRequired();
            entity.Property(mealPlan => mealPlan.Slug).HasMaxLength(170).IsRequired();
            entity.Property(mealPlan => mealPlan.Description).HasMaxLength(1000);
            entity.HasIndex(mealPlan => mealPlan.Slug).IsUnique();
        });
    }

    private static void ConfigureSiteSettings(ModelBuilder modelBuilder)
    {
        modelBuilder.Entity<SiteSetting>(entity =>
        {
            entity.Property(setting => setting.Key).HasMaxLength(200).IsRequired();
            entity.Property(setting => setting.Value).HasMaxLength(4000);
            entity.Property(setting => setting.Group).HasMaxLength(100).IsRequired();
            entity.Property(setting => setting.Label).HasMaxLength(200).IsRequired();
            entity.Property(setting => setting.Description).HasMaxLength(1000);
            entity.Property(setting => setting.IsActive).HasDefaultValue(true);
            entity.HasIndex(setting => setting.Key).IsUnique();
            entity.HasIndex(setting => new { setting.Group, setting.SortOrder });
        });
    }

    private static void ApplySoftDeleteFilters(ModelBuilder modelBuilder)
    {
        foreach (var entityType in modelBuilder.Model.GetEntityTypes()
                     .Where(type => typeof(BaseEntity).IsAssignableFrom(type.ClrType)))
        {
            var parameter = Expression.Parameter(entityType.ClrType, "entity");
            var isDeleted = Expression.Property(parameter, nameof(BaseEntity.IsDeleted));
            var filter = Expression.Lambda(Expression.Not(isDeleted), parameter);
            modelBuilder.Entity(entityType.ClrType).HasQueryFilter(filter);
        }
    }
}
