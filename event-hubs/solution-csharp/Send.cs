using Azure.Messaging.EventHubs;
using Azure.Messaging.EventHubs.Producer;

public static class Send
{
    private static readonly string[] Devices = ["sensor-01", "sensor-02", "sensor-03", "sensor-04", "sensor-05", "sensor-06", "sensor-07", "sensor-08"];

    public static async Task Run(string connectionString, string eventHub, int readingsPerDevice)
    {
        await using var producer = new EventHubProducerClient(connectionString, eventHub);

        foreach (string device in Devices)
        {
            // All events with the same partition key go to the same partition, so per device they stay in order.
            // A batch is sent in one network call.
            using EventDataBatch batch = await producer.CreateBatchAsync(new CreateBatchOptions { PartitionKey = device });
            for (int i = 0; i < readingsPerDevice; i++)
            {
                var reading = new Reading(device, Math.Round(18 + Random.Shared.NextDouble() * 6, 1), DateTimeOffset.UtcNow);
                if (!batch.TryAdd(new EventData(BinaryData.FromObjectAsJson(reading))))
                {
                    throw new InvalidOperationException("The batch is full");
                }
            }
            await producer.SendAsync(batch);
            Console.WriteLine($"Sent {batch.Count} readings for {device}");
        }
    }
}
