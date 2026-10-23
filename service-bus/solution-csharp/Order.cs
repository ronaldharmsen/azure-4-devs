public record Order(int Id, string Customer, decimal Amount, string Region)
{
    private static readonly string[] Customers = ["contoso", "fabrikam", "northwind"];
    private static readonly string[] Regions = ["EU", "US", "APAC"];

    public static Order CreateRandom() => new(
        Random.Shared.Next(1000, 9999),
        Customers[Random.Shared.Next(Customers.Length)],
        Random.Shared.Next(1, 40) * 50,
        Regions[Random.Shared.Next(Regions.Length)]);

    public override string ToString() => $"order {Id}: {Customer}, EUR {Amount}, {Region}";
}
