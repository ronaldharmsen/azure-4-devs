public record Reading(string Device, double Temperature, DateTimeOffset Time)
{
    public override string ToString() => $"{Device} {Temperature:F1} °C";
}
