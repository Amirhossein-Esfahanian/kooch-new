using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Kooch.Api.Migrations
{
    /// <inheritdoc />
    public partial class AddSettlementPublicReference : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "SettlementNumber",
                table: "Settlements",
                type: "nvarchar(8)",
                maxLength: 8,
                nullable: true);

            migrationBuilder.CreateIndex(
                name: "IX_Settlements_SettlementNumber",
                table: "Settlements",
                column: "SettlementNumber",
                unique: true,
                filter: "[SettlementNumber] IS NOT NULL");

            migrationBuilder.Sql("""
                DECLARE @lockResult int;
                EXEC @lockResult = sys.sp_getapplock
                    @Resource = N'Kooch:SettlementNumber',
                    @LockMode = 'Exclusive', @LockOwner = 'Transaction', @LockTimeout = 10000;
                IF @lockResult < 0
                    THROW 51000, 'Could not acquire the settlement number allocation lock.', 1;

                DECLARE @rowCount bigint;
                SELECT @rowCount = COUNT_BIG(*) FROM dbo.Settlements WITH (TABLOCKX, HOLDLOCK);
                IF @rowCount > 900000
                    THROW 51001, 'Settlement reference namespace is exhausted.', 1;

                DECLARE @id int;
                DECLARE settlement_cursor CURSOR LOCAL FAST_FORWARD FOR
                    SELECT Id FROM dbo.Settlements WHERE SettlementNumber IS NULL ORDER BY Id;
                OPEN settlement_cursor;
                FETCH NEXT FROM settlement_cursor INTO @id;
                WHILE @@FETCH_STATUS = 0
                BEGIN
                    DECLARE @start int = 100000 + ((CONVERT(int, CRYPT_GEN_RANDOM(4)) & 2147483647) % 900000);
                    DECLARE @probe int = 0;
                    WHILE @probe < 900000
                    BEGIN
                        -- Seven is coprime to 900000, so every candidate is visited at most once.
                        DECLARE @candidate varchar(8) = 'S-' + CONVERT(varchar(6), 100000 + ((@start - 100000 + @probe * 7) % 900000));
                        IF NOT EXISTS (SELECT 1 FROM dbo.Settlements WHERE SettlementNumber = @candidate)
                        BEGIN
                            UPDATE dbo.Settlements SET SettlementNumber = @candidate
                                WHERE Id = @id AND SettlementNumber IS NULL;
                            IF @@ROWCOUNT <> 1
                                THROW 51002, 'Settlement reference backfill changed concurrently.', 1;
                            BREAK;
                        END
                        SET @probe += 1;
                    END
                    IF @probe = 900000
                        THROW 51003, 'Unable to allocate a unique settlement reference.', 1;
                    FETCH NEXT FROM settlement_cursor INTO @id;
                END
                CLOSE settlement_cursor;
                DEALLOCATE settlement_cursor;

                IF EXISTS (SELECT 1 FROM dbo.Settlements WHERE SettlementNumber IS NULL
                    OR SettlementNumber COLLATE Latin1_General_100_BIN2 NOT LIKE N'S-[1-9][0-9][0-9][0-9][0-9][0-9]')
                    THROW 51004, 'Settlement reference backfill produced invalid values.', 1;
                IF EXISTS (SELECT 1 FROM dbo.Settlements GROUP BY SettlementNumber HAVING COUNT_BIG(*) > 1)
                    THROW 51005, 'Settlement reference backfill produced duplicate values.', 1;
                """);

            migrationBuilder.DropIndex(
                name: "IX_Settlements_SettlementNumber",
                table: "Settlements");

            migrationBuilder.AlterColumn<string>(
                name: "SettlementNumber",
                table: "Settlements",
                type: "nvarchar(8)",
                maxLength: 8,
                nullable: false,
                oldClrType: typeof(string),
                oldType: "nvarchar(8)",
                oldMaxLength: 8,
                oldNullable: true);

            migrationBuilder.CreateIndex(
                name: "IX_Settlements_SettlementNumber",
                table: "Settlements",
                column: "SettlementNumber",
                unique: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropIndex(
                name: "IX_Settlements_SettlementNumber",
                table: "Settlements");

            migrationBuilder.DropColumn(
                name: "SettlementNumber",
                table: "Settlements");
        }
    }
}
