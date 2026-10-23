# Lab: Streaming events with Azure Event Hubs (C#)

In this lab you build a small console application that streams sensor readings through **Azure Event Hubs** and reads
them back in several ways. Where Service Bus hands each message to one receiver and then removes it, Event Hubs is a
**log**: events stay for the retention period, and every reader keeps track of its own position.

| Part | What you'll do |
| --- | --- |
| 1 | Create an Event Hubs namespace, an event hub with 4 partitions, consumer groups, and a storage account for checkpoints |
| 2 | Set up the project and store the connection strings safely |
| 3 | Send events with a partition key, and look at the partitions |
| 4 | Read the whole stream, twice: reading doesn't remove anything |
| 5 | Process events with an event processor that saves checkpoints, and restart it |
| 6 | Scale out: two processors divide the partitions |
| 7 | A second consumer group reads the same stream independently |

Estimated time: about 1.5 hours. A finished version is in the [solution-csharp](solution-csharp/) folder.
There is also a [Node.js version](eventhubs-nodejs-lab.md) of this lab.

---

## Prerequisites
- .NET 10 SDK installed
- Azure CLI installed, logged in (`az login`)
- An active Azure subscription
- Visual Studio or Visual Studio Code

### Conventions in this lab
- Pick a **suffix** of 4-6 lowercase letters/digits, for example your initials plus three digits (`rh123`).
  Wherever you see `<suffix>`, use your own suffix. The namespace and storage account names must be globally unique.
- All commands are single-line and work in bash, zsh and PowerShell.

---

## Part 1: Create the Event Hubs resources

1. Create a resource group and an Event Hubs **namespace**. The *Standard* tier is needed for extra consumer groups:
   ```sh
   az group create --name rg-ehlab-<suffix> --location westeurope
   az eventhubs namespace create --name evh-lab-<suffix> --resource-group rg-ehlab-<suffix> --location westeurope --sku Standard
   ```

2. Create an **event hub** named `telemetry` with 4 **partitions**, keeping events for 24 hours:
   ```sh
   az eventhubs eventhub create --name telemetry --namespace-name evh-lab-<suffix> --resource-group rg-ehlab-<suffix> --partition-count 4 --cleanup-policy Delete --retention-time 24
   ```
   - A **partition** is an ordered sequence of events. More partitions means more readers can work in parallel.
   - **Retention**: events are deleted after 24 hours, not when they're read.

3. Create two **consumer groups**. A consumer group is an independent view of the whole stream: each group keeps
   its own position. Every event hub also has a `$Default` group.
   ```sh
   az eventhubs eventhub consumer-group create --name dashboard --eventhub-name telemetry --namespace-name evh-lab-<suffix> --resource-group rg-ehlab-<suffix>
   az eventhubs eventhub consumer-group create --name analytics --eventhub-name telemetry --namespace-name evh-lab-<suffix> --resource-group rg-ehlab-<suffix>
   ```

4. Create a storage account with a container `checkpoints`. The event processor stores its checkpoints there in Part 5:
   ```sh
   az storage account create --name stehlab<suffix> --resource-group rg-ehlab-<suffix> --location westeurope --sku Standard_LRS
   az storage container create --name checkpoints --account-name stehlab<suffix> --auth-mode key
   ```

5. Open the namespace in the Azure Portal, and look at the event hub `telemetry`: its partitions, retention and
   consumer groups.

---

## Part 2: Set up the project

1. Create a console app and add the Event Hubs SDK, the event processor package, and the user-secrets configuration package:
   ```sh
   dotnet new console -n EventHubsLab
   cd EventHubsLab
   dotnet add package Azure.Messaging.EventHubs
   dotnet add package Azure.Messaging.EventHubs.Processor
   dotnet add package Microsoft.Extensions.Configuration.UserSecrets
   ```

2. Get the two connection strings:
   ```sh
   az eventhubs namespace authorization-rule keys list --resource-group rg-ehlab-<suffix> --namespace-name evh-lab-<suffix> --name RootManageSharedAccessKey --query primaryConnectionString -o tsv
   az storage account show-connection-string --name stehlab<suffix> --resource-group rg-ehlab-<suffix> --query connectionString -o tsv
   ```

3. Store them with **user-secrets**, outside your project folder (and outside git):
   ```sh
   dotnet user-secrets init
   dotnet user-secrets set EventHubsConnectionString "<event-hubs-connection-string>"
   dotnet user-secrets set StorageConnectionString "<storage-connection-string>"
   ```

4. Create `Reading.cs`, the event you'll send:
   ```csharp
   public record Reading(string Device, double Temperature, DateTimeOffset Time)
   {
       public override string ToString() => $"{Device} {Temperature:F1} °C";
   }
   ```

5. Replace `Program.cs`. It reads the connection strings and runs a command from the command line.
   You'll add a `case` for every part of the lab:
   ```csharp
   using Microsoft.Extensions.Configuration;

   // Both connection strings are stored with 'dotnet user-secrets', outside the project folder (and outside git).
   var config = new ConfigurationBuilder().AddUserSecrets<Program>().Build();
   string eventHubsConnection = config["EventHubsConnectionString"]
       ?? throw new InvalidOperationException("Run: dotnet user-secrets set EventHubsConnectionString \"<connection-string>\"");
   string storageConnection = config["StorageConnectionString"] ?? "";

   const string EventHub = "telemetry";

   string command = args.Length > 0 ? args[0] : "";
   string argument = args.Length > 1 ? args[1] : "";
   string argument2 = args.Length > 2 ? args[2] : "";

   switch (command)
   {
       // the cases for each part of the lab go here
       default:
           Console.WriteLine("Commands: send [count] | info | read | process [name] [consumer-group]");
           break;
   }
   ```

6. Check that it builds and runs:
   ```sh
   dotnet run
   ```

---

## Part 3: Send events with a partition key

1. Create `Send.cs`. It sends readings for 8 sensors, using the sensor as **partition key**:
   ```csharp
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
   ```

2. Create `Info.cs`, which shows what's in each partition:
   ```csharp
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
   ```

3. Add the cases to the switch in `Program.cs`:
   ```csharp
   case "send": await Send.Run(eventHubsConnection, EventHub, argument == "" ? 5 : int.Parse(argument)); break;
   case "info": await Info.Run(eventHubsConnection, EventHub); break;
   ```

4. Send 5 readings per sensor (40 events), and look at the partitions:
   ```sh
   dotnet run -- info
   dotnet run -- send 5
   dotnet run -- info
   ```
   Every event gets a **sequence number** within its partition (0, 1, 2, ...). Notice that the events are not spread
   evenly: the partition is chosen by a hash of the partition key, and with only 8 keys one partition may get more
   sensors than another, or none at all. With real data you use a key with many different values.

---

## Part 4: Read the stream, twice

1. Create `Read.cs`. It reads every event that's still retained, from the start of every partition:
   ```csharp
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
   ```

2. Add the case and run it **twice**:
   ```csharp
   case "read": await Read.Run(eventHubsConnection, EventHub); break;
   ```
   ```sh
   dotnet run -- read
   dotnet run -- read
   ```
   Both runs read all 40 events. **Reading doesn't remove anything**: that's the big difference with a Service Bus queue.
   You also see which sensors ended up in which partition. Every sensor is in exactly one partition.

> `EventHubConsumerClient` is fine for tools, tests and simple reads like this. For real processing you use the
> **event processor** of the next part.

---

## Part 5: Process events with checkpoints

A reader needs to remember how far it got, so that after a restart it continues instead of starting over.
The `EventProcessorClient` stores that position, the **checkpoint**, per partition in blob storage.

1. Create `Process.cs`:
   ```csharp
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
   ```

2. Add the case:
   ```csharp
   case "process": await Process.Run(eventHubsConnection, EventHub, storageConnection,
       name: argument == "" ? "processor" : argument, consumerGroup: argument2 == "" ? "dashboard" : argument2); break;
   ```

3. Start a processor named A in consumer group `dashboard`:
   ```sh
   dotnet run -- process A
   ```
   It reads all partitions and processes all 40 events: without a checkpoint, it starts at the beginning of each
   partition. Every 5 events per partition, it saves a checkpoint. Press Enter to stop.

4. In the portal, open the storage account → *Containers* → `checkpoints`. You'll find a `checkpoint` blob per
   partition (the sequence number is in its metadata) and an `ownership` blob per partition.

5. Send more events, and start the processor again:
   ```sh
   dotnet run -- send 3
   dotnet run -- process A
   ```
   It only processes the **24 new** events: it continues from the checkpoints. Stop it with Enter.

6. Start it once more, **without** sending anything:
   ```sh
   dotnet run -- process A
   ```
   You'll see a few events **again**: the ones processed after the last checkpoint of their partition. Event Hubs
   processing is **at-least-once**: after a restart or crash, events since the last checkpoint are processed again.
   So make your processing idempotent, and choose how often to checkpoint: checkpointing every event is safe but
   expensive, checkpointing rarely means more reprocessing after a crash.

---

## Part 6: Scale out

Processors in the **same consumer group** divide the partitions among themselves. Each partition is read by one
processor at a time.

1. Start processor A in one terminal and wait until it reads all partitions:
   ```sh
   dotnet run -- process A
   ```

2. Start processor B in a second terminal:
   ```sh
   dotnet run -- process B
   ```
   Within about a minute, B takes over some of the partitions. Processor A shows `stopped reading partition ... (OwnershipLost)`,
   and B shows `now reading partition ...`.

3. Send events from a third terminal, and see that each processor only processes the partitions it owns:
   ```sh
   dotnet run -- send 4
   ```
   Around the hand-over, an event can be processed twice (at-least-once again).

4. Think about it: what happens if you start a fifth processor, with 4 partitions? The number of partitions is the
   maximum number of processors that can work in parallel in one consumer group.

5. Stop both processors (Enter). Always stop a processor cleanly: then it releases its partitions right away.
   A processor that was killed keeps its partitions for a while (about 2 minutes) before others can take them over.

---

## Part 7: A second consumer group

Start a processor in the consumer group `analytics`:
```sh
dotnet run -- process X analytics
```
It processes **all** events from the beginning, regardless of what the `dashboard` group has done: each consumer
group has its own checkpoints. This is how several applications (a dashboard, an analytics job, an archiver) read
the same stream independently, each at its own pace.

Compare this with Service Bus: there, a queue message goes to one receiver and is gone. For several independent
receivers you need a topic with a subscription per receiver.

---

## Part 8: Clean up

Delete the resource group with everything in it:
```sh
az group delete --name rg-ehlab-<suffix> --yes --no-wait
```

---

## Bonus challenges

1. **Hot partitions**: change `Devices` to 40 sensors and send again. How evenly are the partitions used now?
2. **Start position**: read only the events of the last 5 minutes: call `consumer.ReadEventsFromPartitionAsync(...)`
   for each partition, with `EventPosition.FromEnqueuedTime(DateTimeOffset.UtcNow.AddMinutes(-5))` as start position.
3. **Azure Functions**: an `EventHubTrigger` function does what your `Process` class does (including the checkpoints),
   and scales out automatically.
4. **No connection string**: use Microsoft Entra ID. Assign yourself the role *Azure Event Hubs Data Owner* on the
   namespace, add the `Azure.Identity` package, and create the clients with the namespace name
   (`evh-lab-<suffix>.servicebus.windows.net`) and `new DefaultAzureCredential()`.
5. **Find out**: what are *Event Hubs Capture* and the *Kafka endpoint* of Event Hubs, and when would you use them?

---

## Troubleshooting

| Problem | Solution |
| --- | --- |
| `Run: dotnet user-secrets set ...` | The connection strings aren't stored for this project: run the commands from Part 2, step 3 in the project folder |
| The processor fails with a storage error | Check the `StorageConnectionString` secret and that the container `checkpoints` exists |
| The processor doesn't read some partitions for a while | Another processor in the same consumer group still owns them (or a killed one, until its ownership expires after about 2 minutes) |
| `read` and `process` show different numbers | `read` reads everything still retained; `process` continues from its checkpoints |
| Consumer group not found | Check the name, and that you created it on the event hub `telemetry` |

---

## Congratulations!
You streamed events through Azure Event Hubs, used partition keys, read a retained stream more than once, processed
it with checkpoints, scaled out within a consumer group, and read the same stream independently with a second consumer group.
