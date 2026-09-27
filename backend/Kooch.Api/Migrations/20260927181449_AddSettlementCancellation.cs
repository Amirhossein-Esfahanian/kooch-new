using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Kooch.Api.Migrations
{
    /// <inheritdoc />
    public partial class AddSettlementCancellation : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropIndex(
                name: "IX_SettlementItems_FinancialEntryId",
                table: "SettlementItems");

            migrationBuilder.AddColumn<string>(
                name: "CancellationReason",
                table: "Settlements",
                type: "nvarchar(2000)",
                maxLength: 2000,
                nullable: true);

            migrationBuilder.AddColumn<DateTime>(
                name: "CancelledAtUtc",
                table: "Settlements",
                type: "datetime2",
                nullable: true);

            migrationBuilder.AddColumn<int>(
                name: "CancelledByUserId",
                table: "Settlements",
                type: "int",
                nullable: true);

            migrationBuilder.AddColumn<DateTime>(
                name: "ReleasedAtUtc",
                table: "SettlementItems",
                type: "datetime2",
                nullable: true);

            migrationBuilder.CreateIndex(
                name: "IX_SettlementItems_FinancialEntryId",
                table: "SettlementItems",
                column: "FinancialEntryId",
                unique: true,
                filter: "[ReleasedAtUtc] IS NULL");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropIndex(
                name: "IX_SettlementItems_FinancialEntryId",
                table: "SettlementItems");

            migrationBuilder.DropColumn(
                name: "CancellationReason",
                table: "Settlements");

            migrationBuilder.DropColumn(
                name: "CancelledAtUtc",
                table: "Settlements");

            migrationBuilder.DropColumn(
                name: "CancelledByUserId",
                table: "Settlements");

            migrationBuilder.DropColumn(
                name: "ReleasedAtUtc",
                table: "SettlementItems");

            migrationBuilder.CreateIndex(
                name: "IX_SettlementItems_FinancialEntryId",
                table: "SettlementItems",
                column: "FinancialEntryId",
                unique: true);
        }
    }
}
