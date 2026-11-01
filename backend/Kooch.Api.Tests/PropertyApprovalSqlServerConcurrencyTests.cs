using Kooch.Api.Data;
using Kooch.Api.Entities;
using Kooch.Api.Exceptions;
using Microsoft.EntityFrameworkCore;
using Xunit;

namespace Kooch.Api.Tests;

// Reuse the existing opt-in fixture, which always creates a uniquely named disposable database.
public sealed class PropertyApprovalSqlServerConcurrencyTests(SqlServerWalletDatabase database)
    : IClassFixture<SqlServerWalletDatabase>
{
    [SqlServerWalletFact]
    public async Task ApprovalFirst_ImageDeleteAndReassignmentWaitThenInvalidate()
    {
        foreach (var reassign in new[] { false, true })
        {
            PropertyApprovalTestData.Ids ids;
            await using (var setup = database.NewContext())
                ids = await PropertyApprovalTestData.SeedAsync(setup, PropertyStatus.Draft);
            await using var approval = database.NewContext();
            await using var transaction = await approval.Database.BeginTransactionAsync();
            await PropertyApprovalTestData.Service(approval).ApprovePropertyAsync(ids.AdminId, UserRole.SuperAdmin, ids.PropertyId);

            await using var mutation = database.NewContext();
            var write = ChangeImageAsync(mutation, ids, reassign);
            await Task.Delay(200);
            Assert.False(write.IsCompleted);
            await transaction.CommitAsync();
            await write.WaitAsync(TimeSpan.FromSeconds(30));

            await using var verify = database.NewContext();
            Assert.Equal(PropertyStatus.Draft, (await verify.Properties.SingleAsync(row => row.Id == ids.PropertyId)).Status);
            await PropertyApprovalTestData.AssertInvalidationAuditAsync(verify, ids, ids.AdminId);
        }
    }

    [SqlServerWalletFact]
    public async Task ImageMutationFirst_ApprovalWaitsThenRejectsIncompleteState()
    {
        foreach (var reassign in new[] { false, true })
        {
            PropertyApprovalTestData.Ids ids;
            await using (var setup = database.NewContext()) ids = await PropertyApprovalTestData.SeedAsync(setup);
            await using var approval = database.NewContext();
            // Exercise refresh of an already tracked Property after the transaction lock is obtained.
            await approval.Properties.SingleAsync(row => row.Id == ids.PropertyId);
            await using var mutation = database.NewContext();
            await using var transaction = await mutation.Database.BeginTransactionAsync();
            await ChangeImageAsync(mutation, ids, reassign);

            var approve = PropertyApprovalTestData.Service(approval).ApprovePropertyAsync(ids.AdminId, UserRole.SuperAdmin, ids.PropertyId);
            await Task.Delay(200);
            Assert.False(approve.IsCompleted);
            await transaction.CommitAsync();
            await Assert.ThrowsAsync<PropertyActivationException>(() => approve.WaitAsync(TimeSpan.FromSeconds(30)));

            await using var verify = database.NewContext();
            Assert.Equal(PropertyStatus.Draft, (await verify.Properties.SingleAsync(row => row.Id == ids.PropertyId)).Status);
            await PropertyApprovalTestData.AssertInvalidationAuditAsync(verify, ids, ids.AdminId);
        }
    }

    [SqlServerWalletFact]
    public async Task ConcurrentDeletionOfLastTwoImages_ProducesOneInvalidation()
    {
        PropertyApprovalTestData.Ids ids;
        int secondImageId;
        await using (var setup = database.NewContext())
        {
            ids = await PropertyApprovalTestData.SeedAsync(setup);
            var second = new PropertyImage { PropertyId = ids.PropertyId, Url = "/second.jpg" };
            setup.PropertyImages.Add(second);
            await setup.SaveChangesAsync();
            secondImageId = second.Id;
        }
        await using var first = database.NewContext();
        await using var secondContext = database.NewContext();
        await Task.WhenAll(
            PropertyApprovalTestData.Images(first).DeleteAsync(ids.AdminId, UserRole.SuperAdmin, ids.ImageId),
            PropertyApprovalTestData.Images(secondContext).DeleteAsync(ids.AdminId, UserRole.SuperAdmin, secondImageId))
            .WaitAsync(TimeSpan.FromSeconds(30));
        await using var verify = database.NewContext();
        Assert.Equal(PropertyStatus.Draft, (await verify.Properties.SingleAsync(row => row.Id == ids.PropertyId)).Status);
        Assert.Empty(await verify.PropertyImages.Where(row => row.PropertyId == ids.PropertyId).ToListAsync());
        await PropertyApprovalTestData.AssertInvalidationAuditAsync(verify, ids, ids.AdminId);
    }

    private static async Task ChangeImageAsync(KoochDbContext context, PropertyApprovalTestData.Ids ids, bool reassign)
    {
        if (reassign)
            await PropertyApprovalTestData.Images(context).UpdateAsync(ids.AdminId, UserRole.SuperAdmin, ids.ImageId,
                new() { Url = "/property.jpg", RoomTypeId = ids.RoomTypeId });
        else
            await PropertyApprovalTestData.Images(context).DeleteAsync(ids.AdminId, UserRole.SuperAdmin, ids.ImageId);
    }
}
