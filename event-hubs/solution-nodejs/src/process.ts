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
