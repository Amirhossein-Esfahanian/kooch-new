using Kooch.Api.Data;
using Kooch.Api.Entities;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Storage;

namespace Kooch.Api.Services;

internal sealed class PropertyApprovalWriteScope(
    KoochDbContext context,
    Property property,
    IDbContextTransaction? transaction,
    bool ownsTransaction) : IAsyncDisposable
{
    public Property Property { get; } = property;
    public bool WasApproved { get; } = property.Status == PropertyStatus.Approved;

    private static readonly string[] RequiredPropertyFields =
    [nameof(Property.Name), nameof(Property.Description), nameof(Property.Country), nameof(Property.City),
        nameof(Property.Address), nameof(Property.CheckInTime), nameof(Property.CheckOutTime)];

    internal static async Task<Property> LockApprovedForNewBookingAsync(
        KoochDbContext context, int propertyId, CancellationToken cancellationToken)
    {
        if (context.Database.IsRelational() && context.Database.CurrentTransaction is null)
            throw new InvalidOperationException("New booking approval validation requires a transaction.");

        await using var scope = await BeginAsync(context, propertyId, cancellationToken);
        if (scope.Property.Status != PropertyStatus.Approved)
            throw new InvalidOperationException("Only Approved Properties can accept new bookings.");
        return scope.Property;
    }

    public static async Task<PropertyApprovalWriteScope> BeginAsync(
        KoochDbContext context, int propertyId, CancellationToken cancellationToken)
    {
        var ownsTransaction = context.Database.IsRelational() && context.Database.CurrentTransaction is null;
        var transaction = ownsTransaction
            ? await context.Database.BeginTransactionAsync(cancellationToken)
            : context.Database.CurrentTransaction;
        try
        {
            // All approval decisions and required-information writes take the parent lock first.
            var property = context.Database.IsSqlServer()
                ? await context.Properties.FromSqlInterpolated(
                        $"SELECT * FROM [Properties] WITH (UPDLOCK, HOLDLOCK) WHERE [Id] = {propertyId}")
                    .AsNoTracking().SingleOrDefaultAsync(cancellationToken)
                : await context.Properties.AsNoTracking().SingleOrDefaultAsync(item => item.Id == propertyId, cancellationToken);
            if (property is null) throw new KeyNotFoundException("Property not found.");

            var tracked = context.Properties.Local.SingleOrDefault(item => item.Id == propertyId);
            if (tracked is not null)
            {
                if (context.Entry(tracked).State != EntityState.Unchanged)
                    throw new InvalidOperationException("The approval lock must precede Property changes.");
                context.Entry(tracked).CurrentValues.SetValues(property);
                context.Entry(tracked).OriginalValues.SetValues(property);
                context.Entry(tracked).State = EntityState.Unchanged;
                property = tracked;
            }
            else context.Attach(property);
            return new(context, property, transaction, ownsTransaction);
        }
        catch
        {
            if (ownsTransaction && transaction is not null) await transaction.DisposeAsync();
            throw;
        }
    }

    public async Task SaveAsync(int actorUserId, IPropertyCompletionService completionService,
        CancellationToken cancellationToken, bool revalidateApproval = true)
    {
        context.ChangeTracker.DetectChanges();
        var checkApproval = revalidateApproval && WasApproved && Property.Status == PropertyStatus.Approved &&
            HasRequiredInformationChanges();
        try
        {
            // Persist image changes before querying completeness, but keep both saves in this transaction.
            await context.SaveChangesAsync(cancellationToken);
            if (checkApproval && !(await completionService.CalculateAsync(Property.Id, cancellationToken)).CanActivate)
            {
                Property.Status = PropertyStatus.Draft;
                AuditLogService.CaptureApprovedChange(context, actorUserId, Property);
                await context.SaveChangesAsync(cancellationToken);
            }
            if (ownsTransaction && transaction is not null) await transaction.CommitAsync(cancellationToken);
        }
        catch
        {
            if (transaction is not null) await transaction.RollbackAsync(CancellationToken.None);
            throw;
        }
    }

    private bool HasRequiredInformationChanges()
    {
        if (RequiredPropertyFields.Any(field => context.Entry(Property).Property(field).IsModified)) return true;
        return context.ChangeTracker.Entries<PropertyImage>().Any(entry =>
            entry.Entity.PropertyId == Property.Id &&
            entry.State is EntityState.Modified or EntityState.Deleted &&
            entry.OriginalValues.GetValue<int?>(nameof(PropertyImage.RoomTypeId)) is null &&
            entry.OriginalValues.GetValue<int?>(nameof(PropertyImage.RoomId)) is null &&
            (entry.State == EntityState.Deleted || new[] { nameof(PropertyImage.Url), nameof(PropertyImage.IsDeleted),
                nameof(PropertyImage.RoomTypeId), nameof(PropertyImage.RoomId) }.Any(field => entry.Property(field).IsModified)));
    }

    public async ValueTask DisposeAsync()
    {
        if (ownsTransaction && transaction is not null) await transaction.DisposeAsync();
    }
}
