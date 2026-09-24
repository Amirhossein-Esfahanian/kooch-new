using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Kooch.Api.Migrations
{
    /// <inheritdoc />
    public partial class AddFinancialSnapshotAndLedgerFoundation : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "FinancialEntries",
                columns: table => new
                {
                    Id = table.Column<int>(type: "int", nullable: false)
                        .Annotation("SqlServer:Identity", "1, 1"),
                    PropertyId = table.Column<int>(type: "int", nullable: false),
                    ReservationId = table.Column<int>(type: "int", nullable: true),
                    PaymentId = table.Column<int>(type: "int", nullable: true),
                    PaymentItemId = table.Column<int>(type: "int", nullable: true),
                    EntryType = table.Column<int>(type: "int", nullable: false),
                    Amount = table.Column<decimal>(type: "decimal(18,2)", precision: 18, scale: 2, nullable: false),
                    Currency = table.Column<string>(type: "nvarchar(3)", maxLength: 3, nullable: false),
                    EffectiveAtUtc = table.Column<DateTime>(type: "datetime2", nullable: false),
                    CorrelationKey = table.Column<string>(type: "nvarchar(200)", maxLength: 200, nullable: false),
                    ReversesEntryId = table.Column<int>(type: "int", nullable: true),
                    Reason = table.Column<string>(type: "nvarchar(1000)", maxLength: 1000, nullable: true),
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
                    table.PrimaryKey("PK_FinancialEntries", x => x.Id);
                    table.ForeignKey(
                        name: "FK_FinancialEntries_FinancialEntries_ReversesEntryId",
                        column: x => x.ReversesEntryId,
                        principalTable: "FinancialEntries",
                        principalColumn: "Id");
                    table.ForeignKey(
                        name: "FK_FinancialEntries_PaymentItems_PaymentItemId",
                        column: x => x.PaymentItemId,
                        principalTable: "PaymentItems",
                        principalColumn: "Id");
                    table.ForeignKey(
                        name: "FK_FinancialEntries_Payments_PaymentId",
                        column: x => x.PaymentId,
                        principalTable: "Payments",
                        principalColumn: "Id");
                    table.ForeignKey(
                        name: "FK_FinancialEntries_Properties_PropertyId",
                        column: x => x.PropertyId,
                        principalTable: "Properties",
                        principalColumn: "Id");
                    table.ForeignKey(
                        name: "FK_FinancialEntries_Reservations_ReservationId",
                        column: x => x.ReservationId,
                        principalTable: "Reservations",
                        principalColumn: "Id");
                });

            migrationBuilder.CreateTable(
                name: "ReservationFinancialSnapshots",
                columns: table => new
                {
                    Id = table.Column<int>(type: "int", nullable: false)
                        .Annotation("SqlServer:Identity", "1, 1"),
                    ReservationId = table.Column<int>(type: "int", nullable: false),
                    PropertyId = table.Column<int>(type: "int", nullable: false),
                    PaymentId = table.Column<int>(type: "int", nullable: false),
                    PaymentItemId = table.Column<int>(type: "int", nullable: true),
                    GrossAmount = table.Column<decimal>(type: "decimal(18,2)", precision: 18, scale: 2, nullable: false),
                    Currency = table.Column<string>(type: "nvarchar(3)", maxLength: 3, nullable: false),
                    CommissionRate = table.Column<decimal>(type: "decimal(5,2)", precision: 5, scale: 2, nullable: false),
                    CommissionBase = table.Column<decimal>(type: "decimal(18,2)", precision: 18, scale: 2, nullable: false),
                    CommissionAmount = table.Column<decimal>(type: "decimal(18,2)", precision: 18, scale: 2, nullable: false),
                    PropertyPayableAmount = table.Column<decimal>(type: "decimal(18,2)", precision: 18, scale: 2, nullable: false),
                    CalculatedAtUtc = table.Column<DateTime>(type: "datetime2", nullable: false),
                    CommissionPolicySource = table.Column<string>(type: "nvarchar(100)", maxLength: 100, nullable: true),
                    CommissionPolicyVersion = table.Column<string>(type: "nvarchar(100)", maxLength: 100, nullable: true),
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
                    table.PrimaryKey("PK_ReservationFinancialSnapshots", x => x.Id);
                    table.ForeignKey(
                        name: "FK_ReservationFinancialSnapshots_PaymentItems_PaymentItemId",
                        column: x => x.PaymentItemId,
                        principalTable: "PaymentItems",
                        principalColumn: "Id");
                    table.ForeignKey(
                        name: "FK_ReservationFinancialSnapshots_Payments_PaymentId",
                        column: x => x.PaymentId,
                        principalTable: "Payments",
                        principalColumn: "Id");
                    table.ForeignKey(
                        name: "FK_ReservationFinancialSnapshots_Properties_PropertyId",
                        column: x => x.PropertyId,
                        principalTable: "Properties",
                        principalColumn: "Id");
                    table.ForeignKey(
                        name: "FK_ReservationFinancialSnapshots_Reservations_ReservationId",
                        column: x => x.ReservationId,
                        principalTable: "Reservations",
                        principalColumn: "Id");
                });

            migrationBuilder.CreateIndex(
                name: "IX_FinancialEntries_EntryType_CorrelationKey",
                table: "FinancialEntries",
                columns: new[] { "EntryType", "CorrelationKey" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_FinancialEntries_PaymentId",
                table: "FinancialEntries",
                column: "PaymentId");

            migrationBuilder.CreateIndex(
                name: "IX_FinancialEntries_PaymentItemId",
                table: "FinancialEntries",
                column: "PaymentItemId");

            migrationBuilder.CreateIndex(
                name: "IX_FinancialEntries_PropertyId_EffectiveAtUtc",
                table: "FinancialEntries",
                columns: new[] { "PropertyId", "EffectiveAtUtc" });

            migrationBuilder.CreateIndex(
                name: "IX_FinancialEntries_ReservationId",
                table: "FinancialEntries",
                column: "ReservationId");

            migrationBuilder.CreateIndex(
                name: "IX_FinancialEntries_ReversesEntryId",
                table: "FinancialEntries",
                column: "ReversesEntryId");

            migrationBuilder.CreateIndex(
                name: "IX_ReservationFinancialSnapshots_PaymentId_ReservationId",
                table: "ReservationFinancialSnapshots",
                columns: new[] { "PaymentId", "ReservationId" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_ReservationFinancialSnapshots_PaymentItemId",
                table: "ReservationFinancialSnapshots",
                column: "PaymentItemId",
                unique: true,
                filter: "[PaymentItemId] IS NOT NULL");

            migrationBuilder.CreateIndex(
                name: "IX_ReservationFinancialSnapshots_PropertyId_CalculatedAtUtc",
                table: "ReservationFinancialSnapshots",
                columns: new[] { "PropertyId", "CalculatedAtUtc" });

            migrationBuilder.CreateIndex(
                name: "IX_ReservationFinancialSnapshots_ReservationId",
                table: "ReservationFinancialSnapshots",
                column: "ReservationId");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "FinancialEntries");

            migrationBuilder.DropTable(
                name: "ReservationFinancialSnapshots");
        }
    }
}
