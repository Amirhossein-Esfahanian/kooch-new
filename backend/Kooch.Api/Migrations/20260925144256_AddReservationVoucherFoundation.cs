using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Kooch.Api.Migrations
{
    /// <inheritdoc />
    public partial class AddReservationVoucherFoundation : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "ReservationVouchers",
                columns: table => new
                {
                    Id = table.Column<int>(type: "int", nullable: false)
                        .Annotation("SqlServer:Identity", "1, 1"),
                    ReservationId = table.Column<int>(type: "int", nullable: false),
                    ReservationFinancialSnapshotId = table.Column<int>(type: "int", nullable: false),
                    PropertyId = table.Column<int>(type: "int", nullable: false),
                    VoucherNumber = table.Column<string>(type: "nvarchar(64)", maxLength: 64, nullable: false),
                    IssuedAtUtc = table.Column<DateTime>(type: "datetime2", nullable: false),
                    ReservationNumberSnapshot = table.Column<string>(type: "nvarchar(32)", maxLength: 32, nullable: false),
                    PropertyNameSnapshot = table.Column<string>(type: "nvarchar(200)", maxLength: 200, nullable: false),
                    GuestNameSnapshot = table.Column<string>(type: "nvarchar(201)", maxLength: 201, nullable: false),
                    GuestMobileSnapshot = table.Column<string>(type: "nvarchar(30)", maxLength: 30, nullable: true),
                    GuestEmailSnapshot = table.Column<string>(type: "nvarchar(320)", maxLength: 320, nullable: true),
                    RoomTypeNameSnapshot = table.Column<string>(type: "nvarchar(150)", maxLength: 150, nullable: false),
                    RoomNameSnapshot = table.Column<string>(type: "nvarchar(100)", maxLength: 100, nullable: true),
                    CheckInSnapshot = table.Column<DateOnly>(type: "date", nullable: false),
                    CheckOutSnapshot = table.Column<DateOnly>(type: "date", nullable: false),
                    NightsSnapshot = table.Column<int>(type: "int", nullable: false),
                    AdultCountSnapshot = table.Column<int>(type: "int", nullable: false),
                    ChildCountSnapshot = table.Column<int>(type: "int", nullable: false),
                    GrossAmount = table.Column<decimal>(type: "decimal(18,2)", precision: 18, scale: 2, nullable: false),
                    Currency = table.Column<string>(type: "nvarchar(3)", maxLength: 3, nullable: false),
                    CommissionRate = table.Column<decimal>(type: "decimal(5,2)", precision: 5, scale: 2, nullable: false),
                    CommissionAmount = table.Column<decimal>(type: "decimal(18,2)", precision: 18, scale: 2, nullable: false),
                    PropertyPayableAmount = table.Column<decimal>(type: "decimal(18,2)", precision: 18, scale: 2, nullable: false),
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
                    table.PrimaryKey("PK_ReservationVouchers", x => x.Id);
                    table.ForeignKey(
                        name: "FK_ReservationVouchers_Properties_PropertyId",
                        column: x => x.PropertyId,
                        principalTable: "Properties",
                        principalColumn: "Id");
                    table.ForeignKey(
                        name: "FK_ReservationVouchers_ReservationFinancialSnapshots_ReservationFinancialSnapshotId",
                        column: x => x.ReservationFinancialSnapshotId,
                        principalTable: "ReservationFinancialSnapshots",
                        principalColumn: "Id");
                    table.ForeignKey(
                        name: "FK_ReservationVouchers_Reservations_ReservationId",
                        column: x => x.ReservationId,
                        principalTable: "Reservations",
                        principalColumn: "Id");
                });

            migrationBuilder.CreateIndex(
                name: "IX_ReservationVouchers_PropertyId",
                table: "ReservationVouchers",
                column: "PropertyId");

            migrationBuilder.CreateIndex(
                name: "IX_ReservationVouchers_ReservationFinancialSnapshotId",
                table: "ReservationVouchers",
                column: "ReservationFinancialSnapshotId");

            migrationBuilder.CreateIndex(
                name: "IX_ReservationVouchers_ReservationId",
                table: "ReservationVouchers",
                column: "ReservationId",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_ReservationVouchers_VoucherNumber",
                table: "ReservationVouchers",
                column: "VoucherNumber",
                unique: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "ReservationVouchers");
        }
    }
}
