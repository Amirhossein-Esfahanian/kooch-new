using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Design;

namespace Kooch.Api.Data;

public sealed class KoochDbContextFactory : IDesignTimeDbContextFactory<KoochDbContext>
{
    public KoochDbContext CreateDbContext(string[] args)
    {
        var options = new DbContextOptionsBuilder<KoochDbContext>()
            .UseSqlServer("Server=(localdb)\\mssqllocaldb;Database=KoochDb;Trusted_Connection=True;MultipleActiveResultSets=true")
            .Options;

        return new KoochDbContext(options);
    }
}
