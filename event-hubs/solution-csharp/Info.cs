using Azure.Messaging.EventHubs.Consumer;

public static class Info
{
    public static async Task Run(string connectionString, string eventHub)
    {
        await using var consumer = new EventHubConsumerClient(EventHubConsumerClient.DefaultConsumerGroupName, connectionString, eventHub);

        string[] partitionIds = await consumer.GetPartitionIdsAsync();
        Console.WriteLine($"Event hub '{eventHub}' has {partitionIds.Length} partitions");

        foreach (string id in partitionIds)
        {
            var partition = await consumer.GetPartitionPropertiesAsync(id);
            Console.WriteLine(partition.IsEmpty
                ? $"  partition {id}: empty"
                : $"  partition {id}: sequence numbers {partition.BeginningSequenceNumber} to {partition.LastEnqueuedSequenceNumber}, last event at {partition.LastEnqueuedTime:HH:mm:ss} UTC");
        }
    }
}
