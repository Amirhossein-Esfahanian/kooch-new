using System.Data.Common;
using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore.Diagnostics;

namespace Kooch.Api.Tests;

internal static class SqliteTestFunctions
{
    public static DbConnectionInterceptor LenInterceptor { get; } = new LenFunctionInterceptor();

    public static void RegisterLen(SqliteConnection connection) =>
        connection.CreateFunction<string?, int?>("LEN", value => value?.TrimEnd(' ').Length);

    private sealed class LenFunctionInterceptor : DbConnectionInterceptor
    {
        public override void ConnectionOpened(DbConnection connection, ConnectionEndEventData eventData)
        {
            if (connection is SqliteConnection sqliteConnection) RegisterLen(sqliteConnection);
        }

        public override Task ConnectionOpenedAsync(DbConnection connection, ConnectionEndEventData eventData,
            CancellationToken cancellationToken = default)
        {
            if (connection is SqliteConnection sqliteConnection) RegisterLen(sqliteConnection);
            return Task.CompletedTask;
        }
    }
}
