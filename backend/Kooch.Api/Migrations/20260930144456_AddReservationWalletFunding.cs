using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Kooch.Api.Migrations
{
    /// <inheritdoc />
    public partial class AddReservationWalletFunding : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropIndex(
                name: "IX_ReservationFinancialSnapshots_PaymentId_ReservationId",
                table: "ReservationFinancialSnapshots");

            migrationBuilder.DropIndex(
                name: "IX_ReservationFinancialSnapshots_ReservationId",
                table: "ReservationFinancialSnapshots");

            migrationBuilder.AlterColumn<int>(
                name: "PaymentId",
                table: "ReservationFinancialSnapshots",
                type: "int",
                nullable: true,
                oldClrType: typeof(int),
                oldType: "int");

            migrationBuilder.AddColumn<int>(
                name: "BookingFundingAttemptId",
                table: "ReservationFinancialSnapshots",
                type: "int",
                nullable: true);

            migrationBuilder.AddColumn<decimal>(
                name: "WalletFundingAmount",
                table: "ReservationFinancialSnapshots",
                type: "decimal(18,2)",
                precision: 18,
                scale: 2,
                nullable: false,
                defaultValue: 0m);

            migrationBuilder.AddColumn<decimal>(
                name: "ExternalPaymentAmount",
                table: "ReservationFinancialSnapshots",
                type: "decimal(18,2)",
                precision: 18,
                scale: 2,
                nullable: false,
                computedColumnSql: "CAST([GrossAmount] - [WalletFundingAmount] AS decimal(18,2))",
                stored: true);

            migrationBuilder.AddUniqueConstraint(
                name: "AK_WalletHoldAllocations_Id_WalletLotId_WalletAccountId",
                table: "WalletHoldAllocations",
                columns: new[] { "Id", "WalletLotId", "WalletAccountId" });

            migrationBuilder.CreateTable(
                name: "BookingFundingAttempts",
                columns: table => new
                {
                    Id = table.Column<int>(type: "int", nullable: false)
                        .Annotation("SqlServer:Identity", "1, 1"),
                    BookingSessionId = table.Column<int>(type: "int", nullable: false),
                    WalletHoldId = table.Column<int>(type: "int", nullable: false),
                    PaymentId = table.Column<int>(type: "int", nullable: true),
                    IdempotencyKey = table.Column<string>(type: "nvarchar(200)", maxLength: 200, nullable: false),
                    RequestHash = table.Column<string>(type: "nvarchar(64)", maxLength: 64, nullable: false),
                    Currency = table.Column<string>(type: "nvarchar(3)", maxLength: 3, nullable: false),
                    AppliedAtUtc = table.Column<DateTime>(type: "datetime2", nullable: true),
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
                    table.PrimaryKey("PK_BookingFundingAttempts", x => x.Id);
                    table.CheckConstraint("CK_BookingFundingAttempts_NotDeleted", "[IsDeleted] = 0 AND [DeletedAtUtc] IS NULL");
                    table.ForeignKey(
                        name: "FK_BookingFundingAttempts_BookingSessions_BookingSessionId",
                        column: x => x.BookingSessionId,
                        principalTable: "BookingSessions",
                        principalColumn: "Id");
                    table.ForeignKey(
                        name: "FK_BookingFundingAttempts_Payments_PaymentId",
                        column: x => x.PaymentId,
                        principalTable: "Payments",
                        principalColumn: "Id");
                    table.ForeignKey(
                        name: "FK_BookingFundingAttempts_WalletHolds_WalletHoldId",
                        column: x => x.WalletHoldId,
                        principalTable: "WalletHolds",
                        principalColumn: "Id");
                });

            migrationBuilder.CreateTable(
                name: "ReservationWalletFundingAllocations",
                columns: table => new
                {
                    Id = table.Column<int>(type: "int", nullable: false)
                        .Annotation("SqlServer:Identity", "1, 1"),
                    ReservationFinancialSnapshotId = table.Column<int>(type: "int", nullable: false),
                    WalletHoldAllocationId = table.Column<int>(type: "int", nullable: false),
                    WalletLotId = table.Column<int>(type: "int", nullable: false),
                    WalletAccountId = table.Column<int>(type: "int", nullable: false),
                    Amount = table.Column<decimal>(type: "decimal(18,2)", precision: 18, scale: 2, nullable: false),
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
                    table.PrimaryKey("PK_ReservationWalletFundingAllocations", x => x.Id);
                    table.CheckConstraint("CK_ReservationWalletFundingAllocations_Amount", "CAST([Amount] AS decimal(18,2)) > 0");
                    table.CheckConstraint("CK_ReservationWalletFundingAllocations_NotDeleted", "[IsDeleted] = 0 AND [DeletedAtUtc] IS NULL");
                    table.ForeignKey(
                        name: "FK_ReservationWalletFundingAllocations_ReservationFinancialSnapshots_ReservationFinancialSnapshotId",
                        column: x => x.ReservationFinancialSnapshotId,
                        principalTable: "ReservationFinancialSnapshots",
                        principalColumn: "Id");
                    table.ForeignKey(
                        name: "FK_ReservationWalletFundingAllocations_WalletHoldAllocations_WalletHoldAllocationId_WalletLotId_WalletAccountId",
                        columns: x => new { x.WalletHoldAllocationId, x.WalletLotId, x.WalletAccountId },
                        principalTable: "WalletHoldAllocations",
                        principalColumns: new[] { "Id", "WalletLotId", "WalletAccountId" });
                });

            migrationBuilder.CreateTable(
                name: "BookingFundingItems",
                columns: table => new
                {
                    Id = table.Column<int>(type: "int", nullable: false)
                        .Annotation("SqlServer:Identity", "1, 1"),
                    BookingFundingAttemptId = table.Column<int>(type: "int", nullable: false),
                    ReservationId = table.Column<int>(type: "int", nullable: false),
                    GuestPayable = table.Column<decimal>(type: "decimal(18,2)", precision: 18, scale: 2, nullable: false),
                    WalletAmount = table.Column<decimal>(type: "decimal(18,2)", precision: 18, scale: 2, nullable: false),
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
                    table.PrimaryKey("PK_BookingFundingItems", x => x.Id);
                    table.CheckConstraint("CK_BookingFundingItems_Amounts", "CAST([GuestPayable] AS decimal(18,2)) > 0 AND CAST([WalletAmount] AS decimal(18,2)) >= 0 AND CAST([WalletAmount] AS decimal(18,2)) <= CAST([GuestPayable] AS decimal(18,2))");
                    table.CheckConstraint("CK_BookingFundingItems_NotDeleted", "[IsDeleted] = 0 AND [DeletedAtUtc] IS NULL");
                    table.ForeignKey(
                        name: "FK_BookingFundingItems_BookingFundingAttempts_BookingFundingAttemptId",
                        column: x => x.BookingFundingAttemptId,
                        principalTable: "BookingFundingAttempts",
                        principalColumn: "Id");
                    table.ForeignKey(
                        name: "FK_BookingFundingItems_Reservations_ReservationId",
                        column: x => x.ReservationId,
                        principalTable: "Reservations",
                        principalColumn: "Id");
                });

            migrationBuilder.CreateIndex(
                name: "IX_ReservationFinancialSnapshots_BookingFundingAttemptId",
                table: "ReservationFinancialSnapshots",
                column: "BookingFundingAttemptId");

            migrationBuilder.CreateIndex(
                name: "IX_ReservationFinancialSnapshots_PaymentId_ReservationId",
                table: "ReservationFinancialSnapshots",
                columns: new[] { "PaymentId", "ReservationId" },
                unique: true,
                filter: "[PaymentId] IS NOT NULL");

            migrationBuilder.CreateIndex(
                name: "IX_ReservationFinancialSnapshots_ReservationId",
                table: "ReservationFinancialSnapshots",
                column: "ReservationId",
                unique: true,
                filter: "[PaymentId] IS NULL");

            migrationBuilder.AddCheckConstraint(
                name: "CK_ReservationFinancialSnapshots_Funding",
                table: "ReservationFinancialSnapshots",
                sql: "CAST([WalletFundingAmount] AS decimal(18,2)) >= 0 AND CAST([GrossAmount] AS decimal(18,2)) >= CAST([WalletFundingAmount] AS decimal(18,2)) AND (CAST([WalletFundingAmount] AS decimal(18,2)) = 0 OR [BookingFundingAttemptId] IS NOT NULL) AND ([PaymentId] IS NOT NULL OR (CAST([WalletFundingAmount] AS decimal(18,2)) = CAST([GrossAmount] AS decimal(18,2)) AND CAST([WalletFundingAmount] AS decimal(18,2)) > 0 AND [PaymentItemId] IS NULL))");

            migrationBuilder.CreateIndex(
                name: "IX_BookingFundingAttempts_BookingSessionId_IdempotencyKey",
                table: "BookingFundingAttempts",
                columns: new[] { "BookingSessionId", "IdempotencyKey" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_BookingFundingAttempts_PaymentId",
                table: "BookingFundingAttempts",
                column: "PaymentId",
                unique: true,
                filter: "[PaymentId] IS NOT NULL");

            migrationBuilder.CreateIndex(
                name: "IX_BookingFundingAttempts_WalletHoldId",
                table: "BookingFundingAttempts",
                column: "WalletHoldId",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_BookingFundingItems_BookingFundingAttemptId_ReservationId",
                table: "BookingFundingItems",
                columns: new[] { "BookingFundingAttemptId", "ReservationId" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_BookingFundingItems_ReservationId",
                table: "BookingFundingItems",
                column: "ReservationId");

            migrationBuilder.CreateIndex(
                name: "IX_ReservationWalletFundingAllocations_ReservationFinancialSnapshotId_WalletHoldAllocationId",
                table: "ReservationWalletFundingAllocations",
                columns: new[] { "ReservationFinancialSnapshotId", "WalletHoldAllocationId" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_ReservationWalletFundingAllocations_WalletHoldAllocationId_WalletLotId_WalletAccountId",
                table: "ReservationWalletFundingAllocations",
                columns: new[] { "WalletHoldAllocationId", "WalletLotId", "WalletAccountId" });

            migrationBuilder.AddForeignKey(
                name: "FK_ReservationFinancialSnapshots_BookingFundingAttempts_BookingFundingAttemptId",
                table: "ReservationFinancialSnapshots",
                column: "BookingFundingAttemptId",
                principalTable: "BookingFundingAttempts",
                principalColumn: "Id");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropForeignKey(
                name: "FK_ReservationFinancialSnapshots_BookingFundingAttempts_BookingFundingAttemptId",
                table: "ReservationFinancialSnapshots");

            migrationBuilder.DropTable(
                name: "BookingFundingItems");

            migrationBuilder.DropTable(
                name: "ReservationWalletFundingAllocations");

            migrationBuilder.DropTable(
                name: "BookingFundingAttempts");

            migrationBuilder.DropUniqueConstraint(
                name: "AK_WalletHoldAllocations_Id_WalletLotId_WalletAccountId",
                table: "WalletHoldAllocations");

            migrationBuilder.DropIndex(
                name: "IX_ReservationFinancialSnapshots_BookingFundingAttemptId",
                table: "ReservationFinancialSnapshots");

            migrationBuilder.DropIndex(
                name: "IX_ReservationFinancialSnapshots_PaymentId_ReservationId",
                table: "ReservationFinancialSnapshots");

            migrationBuilder.DropIndex(
                name: "IX_ReservationFinancialSnapshots_ReservationId",
                table: "ReservationFinancialSnapshots");

            migrationBuilder.DropCheckConstraint(
                name: "CK_ReservationFinancialSnapshots_Funding",
                table: "ReservationFinancialSnapshots");

            migrationBuilder.DropColumn(
                name: "ExternalPaymentAmount",
                table: "ReservationFinancialSnapshots");

            migrationBuilder.DropColumn(
                name: "BookingFundingAttemptId",
                table: "ReservationFinancialSnapshots");

            migrationBuilder.DropColumn(
                name: "WalletFundingAmount",
                table: "ReservationFinancialSnapshots");

            migrationBuilder.AlterColumn<int>(
                name: "PaymentId",
                table: "ReservationFinancialSnapshots",
                type: "int",
                nullable: false,
                defaultValue: 0,
                oldClrType: typeof(int),
                oldType: "int",
                oldNullable: true);

            migrationBuilder.CreateIndex(
                name: "IX_ReservationFinancialSnapshots_PaymentId_ReservationId",
                table: "ReservationFinancialSnapshots",
                columns: new[] { "PaymentId", "ReservationId" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_ReservationFinancialSnapshots_ReservationId",
                table: "ReservationFinancialSnapshots",
                column: "ReservationId");
        }
    }
}
