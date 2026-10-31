using System.Data.Common;
using System.Text.Json;
using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore.Diagnostics;

namespace Kooch.Api.Tests;

internal static class SqliteTestFunctions
{
    public static DbConnectionInterceptor LenInterceptor { get; } = new LenFunctionInterceptor();

    public static void RegisterLen(SqliteConnection connection)
    {
        connection.CreateFunction<string?, int?>("LEN", value => value?.TrimEnd(' ').Length);
        connection.CreateFunction<string?, int>("ISJSON", value =>
        {
            if (value is null) return 0;
            try
            {
                using var document = JsonDocument.Parse(value);
                return document.RootElement.ValueKind is JsonValueKind.Object or JsonValueKind.Array ? 1 : 0;
            }
            catch (JsonException) { return 0; }
        });
    }

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
