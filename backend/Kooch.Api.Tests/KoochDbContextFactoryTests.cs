using Kooch.Api.Data;
using Microsoft.EntityFrameworkCore;
using Xunit;

namespace Kooch.Api.Tests;

public sealed class KoochDbContextFactoryTests
{
    [Fact]
    public void CreateDbContext_UsesTheConfiguredRuntimeConnection()
    {
        using var dbContext = new KoochDbContextFactory().CreateDbContext([]);
        var connection = dbContext.Database.GetDbConnection();

        Assert.Equal(".", connection.DataSource);
        Assert.Equal("KoochDb", connection.Database);
    }
}
