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
