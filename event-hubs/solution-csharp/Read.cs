using Azure.Messaging.EventHubs.Consumer;

public static class Read
{
    public static async Task Run(string connectionString, string eventHub)
    {
        await using var consumer = new EventHubConsumerClient(EventHubConsumerClient.DefaultConsumerGroupName, connectionString, eventHub);

        // Read all events that are still retained, from the start of every partition.
        // MaximumWaitTime: if no event arrives within 3 seconds, an empty event is returned, so we know we're done.
        var options = new ReadEventOptions { MaximumWaitTime = TimeSpan.FromSeconds(3) };
        var devicesPerPartition = new SortedDictionary<string, SortedSet<string>>();
        int count = 0;

        await foreach (PartitionEvent partitionEvent in consumer.ReadEventsAsync(startReadingAtEarliestEvent: true, options))
        {
            if (partitionEvent.Data == null)
            {
                break;
            }
            Reading reading = partitionEvent.Data.EventBody.ToObjectFromJson<Reading>()!;
            string partition = partitionEvent.Partition.PartitionId;

            if (!devicesPerPartition.ContainsKey(partition))
            {
                devicesPerPartition[partition] = new SortedSet<string>();
            }
            devicesPerPartition[partition].Add(reading.Device);
            count++;
        }

        Console.WriteLine($"Read {count} events");
        foreach (var (partition, devices) in devicesPerPartition)
        {
            Console.WriteLine($"  partition {partition}: {string.Join(", ", devices)}");
        }
    }
}
