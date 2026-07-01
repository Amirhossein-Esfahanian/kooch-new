using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Kooch.Api.Migrations
{
    /// <inheritdoc />
    public partial class AddPropertyChildAndExtraGuestPrices : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<decimal>(
                name: "ChildPrice",
                table: "Properties",
                type: "decimal(18,2)",
                precision: 18,
                scale: 2,
                nullable: true);

            migrationBuilder.AddColumn<decimal>(
                name: "ExtraGuestPrice",
                table: "Properties",
                type: "decimal(18,2)",
                precision: 18,
                scale: 2,
                nullable: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql(@"
                IF COL_LENGTH(N'dbo.Properties', N'ExtraGuestPrice') IS NOT NULL
                    ALTER TABLE [Properties] DROP COLUMN [ExtraGuestPrice];
            ");

            migrationBuilder.Sql(@"
                IF COL_LENGTH(N'dbo.Properties', N'ChildPrice') IS NOT NULL
                    ALTER TABLE [Properties] DROP COLUMN [ChildPrice];
            ");
        }
    }
}
