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
