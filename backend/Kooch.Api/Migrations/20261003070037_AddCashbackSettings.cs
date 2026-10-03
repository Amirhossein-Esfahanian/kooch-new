using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Kooch.Api.Migrations
{
    /// <inheritdoc />
    public partial class AddCashbackSettings : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "CashbackSettings",
                columns: table => new
                {
                    Id = table.Column<int>(type: "int", nullable: false)
                        .Annotation("SqlServer:Identity", "1, 1"),
                    PropertyId = table.Column<int>(type: "int", nullable: true),
                    Currency = table.Column<string>(type: "nvarchar(3)", maxLength: 3, nullable: false),
                    Enabled = table.Column<bool>(type: "bit", nullable: false),
                    CalculationMode = table.Column<int>(type: "int", nullable: true),
                    PercentageRate = table.Column<decimal>(type: "decimal(5,2)", precision: 5, scale: 2, nullable: true),
                    SpendUnitAmount = table.Column<decimal>(type: "decimal(18,2)", precision: 18, scale: 2, nullable: true),
                    RewardAmount = table.Column<decimal>(type: "decimal(18,2)", precision: 18, scale: 2, nullable: true),
                    MaxCashbackPerReservation = table.Column<decimal>(type: "decimal(18,2)", precision: 18, scale: 2, nullable: true),
                    ExpiryDays = table.Column<int>(type: "int", nullable: true),
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
                    table.PrimaryKey("PK_CashbackSettings", x => x.Id);
                    table.CheckConstraint("CK_CashbackSettings_Currency", "LEN([Currency]) = 3 AND [Currency] NOT LIKE '%[^A-Z]%'");
                    table.CheckConstraint("CK_CashbackSettings_Mode", "([Enabled] = 0 AND [CalculationMode] IS NULL AND [PercentageRate] IS NULL AND [SpendUnitAmount] IS NULL AND [RewardAmount] IS NULL AND [MaxCashbackPerReservation] IS NULL AND [ExpiryDays] IS NULL) OR ([Enabled] = 1 AND [CalculationMode] IS NOT NULL AND [MaxCashbackPerReservation] IS NOT NULL AND [MaxCashbackPerReservation] > 0 AND [ExpiryDays] IS NOT NULL AND [ExpiryDays] > 0 AND (([CalculationMode] = 0 AND [PercentageRate] IS NOT NULL AND [PercentageRate] > 0 AND [PercentageRate] <= 20 AND [SpendUnitAmount] IS NULL AND [RewardAmount] IS NULL) OR ([CalculationMode] = 1 AND [PercentageRate] IS NULL AND [SpendUnitAmount] IS NOT NULL AND [SpendUnitAmount] > 0 AND [RewardAmount] IS NOT NULL AND [RewardAmount] > 0)))");
                    table.ForeignKey(
                        name: "FK_CashbackSettings_Properties_PropertyId",
                        column: x => x.PropertyId,
                        principalTable: "Properties",
                        principalColumn: "Id");
                });

            migrationBuilder.CreateIndex(
                name: "IX_CashbackSettings_Currency",
                table: "CashbackSettings",
                column: "Currency",
                unique: true,
                filter: "[PropertyId] IS NULL AND [IsDeleted] = 0");

            migrationBuilder.CreateIndex(
                name: "IX_CashbackSettings_PropertyId_Currency",
                table: "CashbackSettings",
                columns: new[] { "PropertyId", "Currency" },
                unique: true,
                filter: "[PropertyId] IS NOT NULL AND [IsDeleted] = 0");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "CashbackSettings");
        }
    }
}
