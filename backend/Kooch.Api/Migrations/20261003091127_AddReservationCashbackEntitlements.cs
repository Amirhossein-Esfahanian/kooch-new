using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Kooch.Api.Migrations
{
    /// <inheritdoc />
    public partial class AddReservationCashbackEntitlements : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "ReservationCashbackEntitlements",
                columns: table => new
                {
                    Id = table.Column<int>(type: "int", nullable: false)
                        .Annotation("SqlServer:Identity", "1, 1"),
                    ReservationId = table.Column<int>(type: "int", nullable: false),
                    UserId = table.Column<int>(type: "int", nullable: false),
                    PropertyId = table.Column<int>(type: "int", nullable: false),
                    Currency = table.Column<string>(type: "nvarchar(3)", maxLength: 3, nullable: false),
                    Status = table.Column<int>(type: "int", nullable: false, defaultValue: 0),
                    GuestPayableSnapshot = table.Column<decimal>(type: "decimal(18,2)", precision: 18, scale: 2, nullable: false),
                    NonWithdrawableWalletFundingSnapshot = table.Column<decimal>(type: "decimal(18,2)", precision: 18, scale: 2, nullable: false),
                    EligibleBaseSnapshot = table.Column<decimal>(type: "decimal(18,2)", precision: 18, scale: 2, nullable: false),
                    CashbackAmount = table.Column<decimal>(type: "decimal(18,2)", precision: 18, scale: 2, nullable: false),
                    PolicySource = table.Column<int>(type: "int", nullable: false),
                    CalculationMode = table.Column<int>(type: "int", nullable: false),
                    PercentageRateSnapshot = table.Column<decimal>(type: "decimal(5,2)", precision: 5, scale: 2, nullable: true),
                    SpendUnitAmountSnapshot = table.Column<decimal>(type: "decimal(18,2)", precision: 18, scale: 2, nullable: true),
                    RewardAmountSnapshot = table.Column<decimal>(type: "decimal(18,2)", precision: 18, scale: 2, nullable: true),
                    MaxCashbackPerReservationSnapshot = table.Column<decimal>(type: "decimal(18,2)", precision: 18, scale: 2, nullable: false),
                    ExpiryDaysSnapshot = table.Column<int>(type: "int", nullable: false),
                    EligibleAtUtc = table.Column<DateTime>(type: "datetime2", nullable: false),
                    GrantedWalletLotId = table.Column<int>(type: "int", nullable: true),
                    GrantedWalletEntryId = table.Column<int>(type: "int", nullable: true),
                    GrantedAtUtc = table.Column<DateTime>(type: "datetime2", nullable: true),
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
                    table.PrimaryKey("PK_ReservationCashbackEntitlements", x => x.Id);
                    table.CheckConstraint("CK_ReservationCashbackEntitlements_Amounts", "[GuestPayableSnapshot] >= 0 AND [NonWithdrawableWalletFundingSnapshot] >= 0 AND [NonWithdrawableWalletFundingSnapshot] <= [GuestPayableSnapshot] AND [EligibleBaseSnapshot] = [GuestPayableSnapshot] - [NonWithdrawableWalletFundingSnapshot] AND [CashbackAmount] > 0 AND [MaxCashbackPerReservationSnapshot] > 0 AND [CashbackAmount] <= [MaxCashbackPerReservationSnapshot] AND [ExpiryDaysSnapshot] > 0");
                    table.CheckConstraint("CK_ReservationCashbackEntitlements_Currency", "[Currency] LIKE '___' AND [Currency] NOT LIKE '%[^A-Z]%'");
                    table.CheckConstraint("CK_ReservationCashbackEntitlements_GrantLink", "([Status] IN (0, 2) AND [GrantedWalletLotId] IS NULL AND [GrantedWalletEntryId] IS NULL AND [GrantedAtUtc] IS NULL) OR ([Status] = 1 AND [GrantedWalletLotId] IS NOT NULL AND [GrantedWalletEntryId] IS NOT NULL AND [GrantedAtUtc] IS NOT NULL)");
                    table.CheckConstraint("CK_ReservationCashbackEntitlements_NotDeleted", "[IsDeleted] = 0 AND [DeletedAtUtc] IS NULL");
                    table.CheckConstraint("CK_ReservationCashbackEntitlements_Policy", "[PolicySource] IN (0, 1) AND (([CalculationMode] = 0 AND [PercentageRateSnapshot] IS NOT NULL AND [PercentageRateSnapshot] > 0 AND [PercentageRateSnapshot] <= 20 AND [SpendUnitAmountSnapshot] IS NULL AND [RewardAmountSnapshot] IS NULL) OR ([CalculationMode] = 1 AND [PercentageRateSnapshot] IS NULL AND [SpendUnitAmountSnapshot] IS NOT NULL AND [SpendUnitAmountSnapshot] > 0 AND [RewardAmountSnapshot] IS NOT NULL AND [RewardAmountSnapshot] > 0))");
                    table.ForeignKey(
                        name: "FK_ReservationCashbackEntitlements_Properties_PropertyId",
                        column: x => x.PropertyId,
                        principalTable: "Properties",
                        principalColumn: "Id");
                    table.ForeignKey(
                        name: "FK_ReservationCashbackEntitlements_Reservations_ReservationId",
                        column: x => x.ReservationId,
                        principalTable: "Reservations",
                        principalColumn: "Id");
                    table.ForeignKey(
                        name: "FK_ReservationCashbackEntitlements_Users_UserId",
                        column: x => x.UserId,
                        principalTable: "Users",
                        principalColumn: "Id");
                    table.ForeignKey(
                        name: "FK_ReservationCashbackEntitlements_WalletEntries_GrantedWalletEntryId",
                        column: x => x.GrantedWalletEntryId,
                        principalTable: "WalletEntries",
                        principalColumn: "Id");
                    table.ForeignKey(
                        name: "FK_ReservationCashbackEntitlements_WalletLots_GrantedWalletLotId",
                        column: x => x.GrantedWalletLotId,
                        principalTable: "WalletLots",
                        principalColumn: "Id");
                });

            migrationBuilder.CreateIndex(
                name: "IX_ReservationCashbackEntitlements_GrantedWalletEntryId",
                table: "ReservationCashbackEntitlements",
                column: "GrantedWalletEntryId",
                unique: true,
                filter: "[GrantedWalletEntryId] IS NOT NULL");

            migrationBuilder.CreateIndex(
                name: "IX_ReservationCashbackEntitlements_GrantedWalletLotId",
                table: "ReservationCashbackEntitlements",
                column: "GrantedWalletLotId",
                unique: true,
                filter: "[GrantedWalletLotId] IS NOT NULL");

            migrationBuilder.CreateIndex(
                name: "IX_ReservationCashbackEntitlements_PropertyId",
                table: "ReservationCashbackEntitlements",
                column: "PropertyId");

            migrationBuilder.CreateIndex(
                name: "IX_ReservationCashbackEntitlements_ReservationId",
                table: "ReservationCashbackEntitlements",
                column: "ReservationId",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_ReservationCashbackEntitlements_UserId",
                table: "ReservationCashbackEntitlements",
                column: "UserId");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "ReservationCashbackEntitlements");
        }
    }
}
