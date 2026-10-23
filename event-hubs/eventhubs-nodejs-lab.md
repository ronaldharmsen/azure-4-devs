# Lab: Streaming events with Azure Event Hubs (Node.js)

In this lab you build a few small **TypeScript** scripts that stream sensor readings through **Azure Event Hubs** and
read them back in several ways. Where Service Bus hands each message to one receiver and then removes it, Event Hubs
is a **log**: events stay for the retention period, and every reader keeps track of its own position.

| Part | What you'll do |
| --- | --- |
| 1 | Create an Event Hubs namespace, an event hub with 4 partitions, consumer groups, and a storage account for checkpoints |
| 2 | Set up the project and store the connection strings safely |
| 3 | Send events with a partition key, and look at the partitions |
| 4 | Read the whole stream, twice: reading doesn't remove anything |
| 5 | Process events with checkpoints, and restart the processor |
| 6 | Scale out: two processors divide the partitions |
| 7 | A second consumer group reads the same stream independently |

Estimated time: about 1.5 hours. A finished version is in the [solution-nodejs](solution-nodejs/) folder
(copy `.env.example` to `.env` and fill in your connection strings). There is also a [C# version](eventhubs-csharp-lab.md) of this lab.

---

## Prerequisites
- Node.js 22 or 24
- Azure CLI installed, logged in (`az login`)
- An active Azure subscription
- Visual Studio Code

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

4. Create a storage account with a container `checkpoints`. The processor stores its checkpoints there in Part 5:
   ```sh
   az storage account create --name stehlab<suffix> --resource-group rg-ehlab-<suffix> --location westeurope --sku Standard_LRS
   az storage container create --name checkpoints --account-name stehlab<suffix> --auth-mode key
   ```

5. Open the namespace in the Azure Portal, and look at the event hub `telemetry`: its partitions, retention and
   consumer groups.

---

## Part 2: Set up the project

1. Create a project folder, initialize it as an ES module project, and install the Event Hubs SDK, the blob
   checkpoint store and the Storage SDK. [tsx](https://tsx.is/) runs TypeScript files directly, without a build step:
   ```sh
   mkdir eventhubs-lab
   cd eventhubs-lab
   npm init -y
   npm pkg set type=module
   npm install @azure/event-hubs @azure/eventhubs-checkpointstore-blob @azure/storage-blob
   npm install --save-dev tsx @types/node
   ```

2. Get the two connection strings:
   ```sh
   az eventhubs namespace authorization-rule keys list --resource-group rg-ehlab-<suffix> --namespace-name evh-lab-<suffix> --name RootManageSharedAccessKey --query primaryConnectionString -o tsv
   az storage account show-connection-string --name stehlab<suffix> --resource-group rg-ehlab-<suffix> --query connectionString -o tsv
   ```

3. Create a file `.env` in the project folder with both connection strings (keep the quotes):
   ```
   EVENTHUBS_CONNECTION_STRING="<event-hubs-connection-string>"
   STORAGE_CONNECTION_STRING="<storage-connection-string>"
   ```
   Node.js reads it with its built-in `--env-file` option. Never commit this file: create a `.gitignore` with:
   ```
   node_modules/
   .env
   ```

4. Add npm scripts for the scripts you'll write:
   ```sh
   npm pkg set scripts.send="tsx --env-file=.env src/send.ts"
   npm pkg set scripts.info="tsx --env-file=.env src/info.ts"
   npm pkg set scripts.read="tsx --env-file=.env src/read.ts"
   npm pkg set scripts.process="tsx --env-file=.env src/process.ts"
   ```
   You run them with `npm run <name>`. Arguments go after `--`, for example `npm run send -- 5`.

5. Create `src/shared.ts` with the settings and the reading type:
   ```typescript
   // Both connection strings come from the .env file (loaded with node --env-file=.env).
   export const eventHubsConnectionString = required("EVENTHUBS_CONNECTION_STRING");
   export const storageConnectionString = process.env.STORAGE_CONNECTION_STRING ?? "";
   export const eventHubName = "telemetry";

   export interface Reading {
       device: string;
       temperature: number;
       time: string;
   }

   export function describe(reading: Reading): string {
       return `${reading.device} ${reading.temperature.toFixed(1)} °C`;
   }

   function required(name: string): string {
       const value = process.env[name];
       if (!value) {
           throw new Error(`${name} is not set: create a .env file and run with --env-file=.env`);
       }
       return value;
   }
   ```

---

## Part 3: Send events with a partition key

1. Create `src/send.ts`. It sends readings for 8 sensors, using the sensor as **partition key**:
   ```typescript
   import { EventHubProducerClient } from "@azure/event-hubs";
   import { eventHubName, eventHubsConnectionString, Reading } from "./shared.ts";

   const devices = ["sensor-01", "sensor-02", "sensor-03", "sensor-04", "sensor-05", "sensor-06", "sensor-07", "sensor-08"];
   const readingsPerDevice = Number(process.argv[2] ?? 5);

   const producer = new EventHubProducerClient(eventHubsConnectionString, eventHubName);

   for (const device of devices) {
       // All events with the same partition key go to the same partition, so per device they stay in order.
       // A batch is sent in one network call.
       const batch = await producer.createBatch({ partitionKey: device });
       for (let i = 0; i < readingsPerDevice; i++) {
           const reading: Reading = {
               device,
               temperature: Math.round((18 + Math.random() * 6) * 10) / 10,
               time: new Date().toISOString(),
           };
           if (!batch.tryAdd({ body: reading })) {
               throw new Error("The batch is full");
           }
       }
       await producer.sendBatch(batch);
       console.log(`Sent ${batch.count} readings for ${device}`);
   }

   await producer.close();
   ```

2. Create `src/info.ts`, which shows what's in each partition:
   ```typescript
   import { EventHubConsumerClient } from "@azure/event-hubs";
   import { eventHubName, eventHubsConnectionString } from "./shared.ts";

   const consumer = new EventHubConsumerClient(EventHubConsumerClient.defaultConsumerGroupName, eventHubsConnectionString, eventHubName);

   const partitionIds = await consumer.getPartitionIds();
   console.log(`Event hub '${eventHubName}' has ${partitionIds.length} partitions`);

   for (const id of partitionIds) {
       const partition = await consumer.getPartitionProperties(id);
       console.log(partition.isEmpty
           ? `  partition ${id}: empty`
           : `  partition ${id}: sequence numbers ${partition.beginningSequenceNumber} to ${partition.lastEnqueuedSequenceNumber}, last event at ${partition.lastEnqueuedOnUtc.toISOString().slice(11, 19)} UTC`);
   }

   await consumer.close();
   ```

3. Send 5 readings per sensor (40 events), and look at the partitions:
   ```sh
   npm run info
   npm run send -- 5
   npm run info
   ```
   Every event gets a **sequence number** within its partition (0, 1, 2, ...). Notice that the events are not spread
   evenly: the partition is chosen by a hash of the partition key, and with only 8 keys one partition may get more
   sensors than another, or none at all. With real data you use a key with many different values.

---

## Part 4: Read the stream, twice

1. Create `src/read.ts`. It reads every event that's still retained, from the start of every partition:
   ```typescript
   import { earliestEventPosition, EventHubConsumerClient } from "@azure/event-hubs";
   import { eventHubName, eventHubsConnectionString, Reading } from "./shared.ts";

   const consumer = new EventHubConsumerClient(EventHubConsumerClient.defaultConsumerGroupName, eventHubsConnectionString, eventHubName);
   const partitionIds = await consumer.getPartitionIds();

   const devicesPerPartition = new Map<string, Set<string>>();
   const finishedPartitions = new Set<string>();
   let count = 0;

   // Read all events that are still retained, from the start of every partition.
   // When no events arrive within 3 seconds, processEvents is called with an empty list: that partition is done.
   await new Promise<void>((resolve) => {
       const subscription = consumer.subscribe(
           {
               processEvents: async (events, context) => {
                   if (events.length === 0) {
                       finishedPartitions.add(context.partitionId);
                       if (finishedPartitions.size === partitionIds.length) {
                           await subscription.close();
                           resolve();
                       }
                       return;
                   }
                   for (const event of events) {
                       const reading = event.body as Reading;
                       if (!devicesPerPartition.has(context.partitionId)) {
                           devicesPerPartition.set(context.partitionId, new Set());
                       }
                       devicesPerPartition.get(context.partitionId)!.add(reading.device);
                       count++;
                   }
               },
               processError: async (error) => {
                   console.log(`error: ${error.message}`);
               },
           },
           { startPosition: earliestEventPosition, maxWaitTimeInSeconds: 3 },
       );
   });

   console.log(`Read ${count} events`);
   for (const partition of [...devicesPerPartition.keys()].sort()) {
       console.log(`  partition ${partition}: ${[...devicesPerPartition.get(partition)!].sort().join(", ")}`);
   }

   await consumer.close();
   ```

2. Run it **twice**:
   ```sh
   npm run read
   npm run read
   ```
   Both runs read all 40 events. **Reading doesn't remove anything**: that's the big difference with a Service Bus queue.
   You also see which sensors ended up in which partition. Every sensor is in exactly one partition.

---

## Part 5: Process events with checkpoints

A reader needs to remember how far it got, so that after a restart it continues instead of starting over.
When you give `EventHubConsumerClient` a **checkpoint store**, it stores that position, the **checkpoint**, per
partition in blob storage. It also coordinates with other instances in the same consumer group (Part 6).

1. Create `src/process.ts`:
   ```typescript
   import { earliestEventPosition, EventHubConsumerClient } from "@azure/event-hubs";
   import { BlobCheckpointStore } from "@azure/eventhubs-checkpointstore-blob";
   import { ContainerClient } from "@azure/storage-blob";
   import { createInterface } from "node:readline/promises";
   import { describe, eventHubName, eventHubsConnectionString, Reading, storageConnectionString } from "./shared.ts";

   const name = process.argv[2] ?? "processor";
   const consumerGroup = process.argv[3] ?? "dashboard";

   // With a checkpoint store, the consumer stores its checkpoints (and which instance owns which partition)
   // in blob storage, and divides the partitions over all instances in the same consumer group.
   const checkpointStore = new BlobCheckpointStore(new ContainerClient(storageConnectionString, "checkpoints"));
   const consumer = new EventHubConsumerClient(consumerGroup, eventHubsConnectionString, eventHubName, checkpointStore);

   const eventsSinceCheckpoint = new Map<string, number>();

   const subscription = consumer.subscribe(
       {
           processInitialize: async (context) => {
               console.log(`[${name}] now reading partition ${context.partitionId}`);
           },
           processClose: async (reason, context) => {
               console.log(`[${name}] stopped reading partition ${context.partitionId} (${reason})`);
           },
           processEvents: async (events, context) => {
               if (events.length === 0) {
                   return;
               }
               for (const event of events) {
                   console.log(`[${name}] partition ${context.partitionId}, sequence ${event.sequenceNumber}: ${describe(event.body as Reading)}`);
               }

               // Save a checkpoint every 5 events per partition: after a restart, processing continues from there.
               const count = (eventsSinceCheckpoint.get(context.partitionId) ?? 0) + events.length;
               if (count >= 5) {
                   const last = events[events.length - 1];
                   await context.updateCheckpoint(last);
                   console.log(`[${name}]   checkpoint saved for partition ${context.partitionId} at sequence ${last.sequenceNumber}`);
                   eventsSinceCheckpoint.set(context.partitionId, 0);
               } else {
                   eventsSinceCheckpoint.set(context.partitionId, count);
               }
           },
           processError: async (error) => {
               console.log(`[${name}] error: ${error.message}`);
           },
       },
       // Where to start when a partition has no checkpoint yet (the default is the latest event: only new ones).
       { startPosition: earliestEventPosition },
   );

   const input = createInterface({ input: process.stdin, output: process.stdout });
   await input.question(`[${name}] Processing '${eventHubName}' with consumer group '${consumerGroup}'. Press Enter to stop.\n`);
   input.close();
   await subscription.close();
   await consumer.close();
   ```
   - `processEvents` receives the events in **batches**, per partition.
   - `startPosition: earliestEventPosition` only applies to partitions without a checkpoint. Without it, a new
     consumer would only see events that arrive after it started.

2. Start a processor named A in consumer group `dashboard`:
   ```sh
   npm run process -- A
   ```
   The processor claims the partitions **one by one, about 10 seconds apart**: wait until you've seen
   `now reading partition` for all of them (about 40 seconds). Without a checkpoint, it starts at the beginning of each
   partition, so together it processes all 40 events. After every batch with 5 or more events, it saves a checkpoint.
   Press Enter to stop.

3. In the portal, open the storage account → *Containers* → `checkpoints`. You'll find a `checkpoint` blob per
   partition (the sequence number is in its metadata) and an `ownership` blob per partition.

4. Send more events, and start the processor again:
   ```sh
   npm run send -- 3
   npm run process -- A
   ```
   Once it has claimed the partitions, it only processes the **new** events: it continues from the checkpoints.
   Stop it with Enter.

5. Start it once more, **without** sending anything:
   ```sh
   npm run process -- A
   ```
   You'll see a few events **again**: the ones processed after the last checkpoint of their partition. Event Hubs
   processing is **at-least-once**: after a restart or crash, events since the last checkpoint are processed again.
   So make your processing idempotent, and choose how often to checkpoint: checkpointing every event is safe but
   expensive, checkpointing rarely means more reprocessing after a crash.

---

## Part 6: Scale out

Processors in the **same consumer group** divide the partitions among themselves. Each partition is read by one
processor at a time.

1. Start processor A in one terminal:
   ```sh
   npm run process -- A
   ```

2. Before A has claimed all partitions (or a little after), start processor B in a second terminal:
   ```sh
   npm run process -- B
   ```
   The two processors divide the 4 partitions, 2 each. If A already owned all of them, B takes some over:
   A shows `stopped reading partition ... (OwnershipLost)`, and B shows `now reading partition ...`.

3. Send events from a third terminal, and see that each processor only processes the partitions it owns:
   ```sh
   npm run send -- 4
   ```

4. Think about it: what happens if you start a fifth processor, with 4 partitions? The number of partitions is the
   maximum number of processors that can work in parallel in one consumer group.

5. Stop both processors (Enter). Always stop a processor cleanly: then it releases its partitions right away.
   A processor that was killed keeps its partitions until its ownership expires (about a minute).

---

## Part 7: A second consumer group

Start a processor in the consumer group `analytics`:
```sh
npm run process -- X analytics
```
Once it has claimed the partitions, it processes **all** events from the beginning, regardless of what the
`dashboard` group has done: each consumer group has its own checkpoints. This is how several applications (a
dashboard, an analytics job, an archiver) read the same stream independently, each at its own pace.

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

1. **Hot partitions**: change `devices` to 40 sensors and send again. How evenly are the partitions used now?
2. **Start position**: read only the events of the last 5 minutes, with `startPosition: { enqueuedOn: new Date(Date.now() - 5 * 60_000) }`.
3. **Azure Functions**: an Event Hubs trigger (`app.eventHub(...)`) does what your `process.ts` does (including the
   checkpoints), and scales out automatically.
4. **No connection string**: use Microsoft Entra ID. Assign yourself the role *Azure Event Hubs Data Owner* on the
   namespace, install `@azure/identity`, and create the clients with the namespace name
   (`evh-lab-<suffix>.servicebus.windows.net`), the event hub name and `new DefaultAzureCredential()`.
5. **Find out**: what are *Event Hubs Capture* and the *Kafka endpoint* of Event Hubs, and when would you use them?

---

## Troubleshooting

| Problem | Solution |
| --- | --- |
| `EVENTHUBS_CONNECTION_STRING is not set` | Create the `.env` file in the project folder (Part 2, step 3) and run the scripts with `npm run` |
| `node: bad option: --env-file` | Your Node.js version is too old: install Node.js 22 or 24 |
| The processor shows only some partitions | It claims them one by one, about 10 seconds apart; or another processor in the same consumer group owns them |
| The processor processes nothing the first time | Check that `startPosition: earliestEventPosition` is set: the default only reads new events |
| `read` and `process` show different numbers | `read` reads everything still retained; `process` continues from its checkpoints |
| A script doesn't stop | Make sure it ends with `await consumer.close()` (or `producer.close()`) |

---

## Congratulations!
You streamed events through Azure Event Hubs, used partition keys, read a retained stream more than once, processed
it with checkpoints, scaled out within a consumer group, and read the same stream independently with a second consumer group.
