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
