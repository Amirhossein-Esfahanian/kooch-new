using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Kooch.Api.Migrations
{
    /// <inheritdoc />
    public partial class AddSettlementFoundation : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<DateOnly>(
                name: "PayableDueDate",
                table: "FinancialEntries",
                type: "date",
                nullable: true);

            // Data transition is part of the EF migration transaction, never an application rewrite.
            migrationBuilder.Sql("""
                IF EXISTS (
                    SELECT 1 FROM FinancialEntries e
                    LEFT JOIN Reservations r ON r.Id = e.ReservationId
                    WHERE e.EntryType = 0 AND (r.Id IS NULL OR r.PropertyId <> e.PropertyId))
                    THROW 51000, 'Cannot backfill payable due date: reservation linkage is missing or inconsistent.', 1;

                UPDATE e SET PayableDueDate = r.CheckOutDate
                FROM FinancialEntries e INNER JOIN Reservations r ON r.Id = e.ReservationId
                WHERE e.EntryType = 0;

                IF NOT EXISTS (SELECT 1 FROM SiteSettings WHERE [Key] = 'settlement.baseDate')
                    INSERT INTO SiteSettings ([Key], Value, Type, [Group], Label, Description, SortOrder, IsActive, CreatedAtUtc, IsDeleted)
                    VALUES ('settlement.baseDate', 'CheckOut', 0, 'Settlement', N'مبنای زمان تسویه',
                        N'سررسید تعهدات جدید بر اساس روز ورود یا خروج ثبت می‌شود.', 10, 1, SYSUTCDATETIME(), 0);
                IF NOT EXISTS (SELECT 1 FROM SiteSettings WHERE [Key] = 'settlement.offsetDays')
                    INSERT INTO SiteSettings ([Key], Value, Type, [Group], Label, Description, SortOrder, IsActive, CreatedAtUtc, IsDeleted)
                    VALUES ('settlement.offsetDays', '0', 5, 'Settlement', N'تعداد روز نسبت به تاریخ مبنا',
                        N'-2 = دو روز قبل، 0 = همان روز، +3 = سه روز بعد. تغییر سیاست فقط روی تعهدات جدید اثر دارد.', 20, 1, SYSUTCDATETIME(), 0);
                """);

            migrationBuilder.CreateTable(
                name: "Settlements",
                columns: table => new
                {
                    Id = table.Column<int>(type: "int", nullable: false)
                        .Annotation("SqlServer:Identity", "1, 1"),
                    PropertyId = table.Column<int>(type: "int", nullable: false),
                    TotalAmount = table.Column<decimal>(type: "decimal(18,2)", precision: 18, scale: 2, nullable: false),
                    Currency = table.Column<string>(type: "nvarchar(3)", maxLength: 3, nullable: false),
                    IsEarlySettlement = table.Column<bool>(type: "bit", nullable: false),
                    PaidAtUtc = table.Column<DateTime>(type: "datetime2", nullable: true),
                    CreatedAtUtc = table.Column<DateTime>(type: "datetime2", nullable: false),
                    CreatedByUserId = table.Column<int>(type: "int", nullable: true),
                    UpdatedAtUtc = table.Column<DateTime>(type: "datetime2", nullable: true),
                    UpdatedByUserId = table.Column<int>(type: "int", nullable: true),
                    DeletedAtUtc = table.Column<DateTime>(type: "datetime2", nullable: true),
                    DeletedByUserId = table.Column<int>(type: "int", nullable: true),
                    IsDeleted = table.Column<bool>(type: "bit", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_Settlements", x => x.Id);
                    table.ForeignKey(
                        name: "FK_Settlements_Properties_PropertyId",
                        column: x => x.PropertyId,
                        principalTable: "Properties",
                        principalColumn: "Id");
                });

            migrationBuilder.CreateTable(
                name: "SettlementItems",
                columns: table => new
                {
                    Id = table.Column<int>(type: "int", nullable: false)
                        .Annotation("SqlServer:Identity", "1, 1"),
                    SettlementId = table.Column<int>(type: "int", nullable: false),
                    FinancialEntryId = table.Column<int>(type: "int", nullable: false),
                    CreatedAtUtc = table.Column<DateTime>(type: "datetime2", nullable: false),
                    CreatedByUserId = table.Column<int>(type: "int", nullable: true),
                    UpdatedAtUtc = table.Column<DateTime>(type: "datetime2", nullable: true),
                    UpdatedByUserId = table.Column<int>(type: "int", nullable: true),
                    DeletedAtUtc = table.Column<DateTime>(type: "datetime2", nullable: true),
                    DeletedByUserId = table.Column<int>(type: "int", nullable: true),
                    IsDeleted = table.Column<bool>(type: "bit", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_SettlementItems", x => x.Id);
                    table.ForeignKey(
                        name: "FK_SettlementItems_FinancialEntries_FinancialEntryId",
                        column: x => x.FinancialEntryId,
                        principalTable: "FinancialEntries",
                        principalColumn: "Id");
                    table.ForeignKey(
                        name: "FK_SettlementItems_Settlements_SettlementId",
                        column: x => x.SettlementId,
                        principalTable: "Settlements",
                        principalColumn: "Id");
                });

            migrationBuilder.CreateIndex(
                name: "IX_SettlementItems_FinancialEntryId",
                table: "SettlementItems",
                column: "FinancialEntryId",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_SettlementItems_SettlementId",
                table: "SettlementItems",
                column: "SettlementId");

            migrationBuilder.CreateIndex(
                name: "IX_Settlements_PropertyId",
                table: "Settlements",
                column: "PropertyId");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DeleteData(table: "SiteSettings", keyColumn: "Key", keyValue: "settlement.baseDate");
            migrationBuilder.DeleteData(table: "SiteSettings", keyColumn: "Key", keyValue: "settlement.offsetDays");
            migrationBuilder.DropTable(
                name: "SettlementItems");

            migrationBuilder.DropTable(
                name: "Settlements");

            migrationBuilder.DropColumn(
                name: "PayableDueDate",
                table: "FinancialEntries");
        }
    }
}
