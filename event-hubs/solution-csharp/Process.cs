using Azure.Messaging.EventHubs;
using Azure.Messaging.EventHubs.Processor;
using Azure.Storage.Blobs;

public static class Process
{
    public static async Task Run(string connectionString, string eventHub, string storageConnection, string name, string consumerGroup)
    {
        // The processor stores its checkpoints (and which instance owns which partition) in blob storage.
        var checkpointStore = new BlobContainerClient(storageConnection, "checkpoints");

        var processor = new EventProcessorClient(checkpointStore, consumerGroup, connectionString, eventHub);

        var eventsSinceCheckpoint = new Dictionary<string, int>();

        processor.PartitionInitializingAsync += args =>
        {
            Console.WriteLine($"[{name}] now reading partition {args.PartitionId}");
            return Task.CompletedTask;
        };
        processor.PartitionClosingAsync += args =>
        {
            Console.WriteLine($"[{name}] stopped reading partition {args.PartitionId} ({args.Reason})");
            return Task.CompletedTask;
        };

        processor.ProcessEventAsync += async args =>
        {
            Reading reading = args.Data.EventBody.ToObjectFromJson<Reading>()!;
            string partition = args.Partition.PartitionId;
            Console.WriteLine($"[{name}] partition {partition}, sequence {args.Data.SequenceNumber}: {reading}");

            // Save a checkpoint every 5 events per partition: after a restart, processing continues from there.
            eventsSinceCheckpoint[partition] = eventsSinceCheckpoint.GetValueOrDefault(partition) + 1;
            if (eventsSinceCheckpoint[partition] >= 5)
            {
                await args.UpdateCheckpointAsync();
                eventsSinceCheckpoint[partition] = 0;
                Console.WriteLine($"[{name}]   checkpoint saved for partition {partition} at sequence {args.Data.SequenceNumber}");
            }
        };

        processor.ProcessErrorAsync += args =>
        {
            Console.WriteLine($"[{name}] error: {args.Exception.Message}");
            return Task.CompletedTask;
        };

        await processor.StartProcessingAsync();
        Console.WriteLine($"[{name}] Processing '{eventHub}' with consumer group '{consumerGroup}'. Press Enter to stop.");
        Console.ReadLine();
        await processor.StopProcessingAsync();
    }
}
