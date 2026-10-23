# Lab: Messaging with Azure Service Bus (Node.js)

In this lab you build a few small **TypeScript** scripts that send and receive orders through **Azure Service Bus**.
You'll see what a message broker does for you: messages wait safely until someone processes them, several
workers can share the work, failed messages are retried and end up in a dead-letter queue, and with topics
one message can reach several subscribers.

| Part | What you'll do |
| --- | --- |
| 1 | Create a Service Bus namespace with a queue and a topic with filtered subscriptions |
| 2 | Set up the project and store the connection string safely |
| 3 | Send messages to a queue, one batch in one call |
| 4 | Receive messages with *peek-lock*, and see what happens if you don't complete them |
| 5 | Run two competing workers that share the queue |
| 6 | Handle failures: retries and the dead-letter queue |
| 7 | Publish to a topic and receive through filtered subscriptions |

Estimated time: about 1.5 hours. A finished version is in the [solution-nodejs](solution-nodejs/) folder
(copy `.env.example` to `.env` and fill in your connection string). There is also a [C# version](servicebus-csharp-lab.md) of this lab.

---

## Prerequisites
- Node.js 22 or 24
- Azure CLI installed, logged in (`az login`)
- An active Azure subscription
- Visual Studio Code

### Conventions in this lab
- Pick a **suffix** of 4-6 lowercase letters/digits, for example your initials plus three digits (`rh123`).
  Wherever you see `<suffix>`, use your own suffix. The namespace name must be globally unique.
- All commands are single-line and work in bash, zsh and PowerShell.

---

## Part 1: Create the Service Bus resources

1. Create a resource group and a Service Bus **namespace**. The namespace is the container for queues and topics.
   The *Standard* tier is needed for topics:
   ```sh
   az group create --name rg-sblab-<suffix> --location westeurope
   az servicebus namespace create --name sb-lab-<suffix> --resource-group rg-sblab-<suffix> --location westeurope --sku Standard
   ```

2. Create a **queue** named `orders`:
   ```sh
   az servicebus queue create --name orders --namespace-name sb-lab-<suffix> --resource-group rg-sblab-<suffix> --max-delivery-count 3 --lock-duration PT30S
   ```
   - `--max-delivery-count 3`: after 3 failed attempts, a message moves to the dead-letter queue (default: 10).
   - `--lock-duration PT30S`: a receiver gets 30 seconds to process a message (default: 1 minute).

3. Create a **topic** named `order-events` with three **subscriptions**:
   ```sh
   az servicebus topic create --name order-events --namespace-name sb-lab-<suffix> --resource-group rg-sblab-<suffix>
   az servicebus topic subscription create --name all-orders --topic-name order-events --namespace-name sb-lab-<suffix> --resource-group rg-sblab-<suffix>
   az servicebus topic subscription create --name big-orders --topic-name order-events --namespace-name sb-lab-<suffix> --resource-group rg-sblab-<suffix>
   az servicebus topic subscription create --name eu-orders --topic-name order-events --namespace-name sb-lab-<suffix> --resource-group rg-sblab-<suffix>
   ```

4. Give two subscriptions a **filter**. A new subscription has a rule named `$Default` that accepts everything;
   add your own rule and remove the default one (use single quotes around `'$Default'`, also in PowerShell):
   ```sh
   az servicebus topic subscription rule create --name big --subscription-name big-orders --topic-name order-events --namespace-name sb-lab-<suffix> --resource-group rg-sblab-<suffix> --filter-sql-expression "amount >= 1000"
   az servicebus topic subscription rule delete --name '$Default' --subscription-name big-orders --topic-name order-events --namespace-name sb-lab-<suffix> --resource-group rg-sblab-<suffix>
   az servicebus topic subscription rule create --name eu --subscription-name eu-orders --topic-name order-events --namespace-name sb-lab-<suffix> --resource-group rg-sblab-<suffix> --filter-sql-expression "region = 'EU'"
   az servicebus topic subscription rule delete --name '$Default' --subscription-name eu-orders --topic-name order-events --namespace-name sb-lab-<suffix> --resource-group rg-sblab-<suffix>
   ```
   The filters work on the **application properties** of a message (`amount`, `region`), which you'll set when sending.

5. Open your namespace in the Azure Portal and look at *Entities* → *Queues* and *Topics*. Keep the portal open:
   you'll use it to watch message counts during the lab.

---

## Part 2: Set up the project

1. Create a project folder, initialize it as an ES module project, and install the Service Bus SDK.
   [tsx](https://tsx.is/) runs TypeScript files directly, without a build step:
   ```sh
   mkdir servicebus-lab
   cd servicebus-lab
   npm init -y
   npm pkg set type=module
   npm install @azure/service-bus
   npm install --save-dev tsx @types/node
   ```

2. Get the connection string of your namespace:
   ```sh
   az servicebus namespace authorization-rule keys list --resource-group rg-sblab-<suffix> --namespace-name sb-lab-<suffix> --name RootManageSharedAccessKey --query primaryConnectionString -o tsv
   ```

3. Create a file `.env` in the project folder with the connection string (keep the quotes):
   ```
   SERVICEBUS_CONNECTION_STRING="<connection-string>"
   ```
   Node.js reads it with its built-in `--env-file` option. Never commit this file: create a `.gitignore` with:
   ```
   node_modules/
   .env
   ```

4. Add npm scripts for all the scripts you'll write (one command per script):
   ```sh
   npm pkg set scripts.send="tsx --env-file=.env src/send.ts"
   npm pkg set scripts.send-invalid="tsx --env-file=.env src/send-invalid.ts"
   npm pkg set scripts.receive="tsx --env-file=.env src/receive.ts"
   npm pkg set scripts.process="tsx --env-file=.env src/process.ts"
   npm pkg set scripts.dlq="tsx --env-file=.env src/dlq.ts"
   npm pkg set scripts.publish="tsx --env-file=.env src/publish.ts"
   npm pkg set scripts.subscribe="tsx --env-file=.env src/subscribe.ts"
   ```
   You run them with `npm run <name>`. Arguments go after `--`, for example `npm run send -- 5`.

5. Create `src/shared.ts` with the client, the order type and a helper that turns an order into a message:
   ```typescript
   import { ServiceBusClient, ServiceBusMessage } from "@azure/service-bus";

   // The connection string comes from the .env file (loaded with node --env-file=.env).
   const connectionString = process.env.SERVICEBUS_CONNECTION_STRING;
   if (!connectionString) {
       throw new Error("SERVICEBUS_CONNECTION_STRING is not set: create a .env file and run with --env-file=.env");
   }

   export const client = new ServiceBusClient(connectionString);

   export interface Order {
       id: number;
       customer: string;
       amount: number;
       region: string;
   }

   const customers = ["contoso", "fabrikam", "northwind"];
   const regions = ["EU", "US", "APAC"];
   const pick = (items: string[]) => items[Math.floor(Math.random() * items.length)];

   export function createRandomOrder(): Order {
       return {
           id: 1000 + Math.floor(Math.random() * 9000),
           customer: pick(customers),
           amount: (1 + Math.floor(Math.random() * 39)) * 50,
           region: pick(regions),
       };
   }

   export function describe(order: Order): string {
       return `order ${order.id}: ${order.customer}, EUR ${order.amount}, ${order.region}`;
   }

   export function toMessage(order: Order): ServiceBusMessage {
       return {
           body: order, // objects are sent as JSON
           messageId: order.id.toString(),
           subject: "order-created",
           contentType: "application/json",
           // Application properties are visible to the broker, for example for filters on topic subscriptions.
           applicationProperties: { region: order.region, amount: order.amount },
       };
   }
   ```
   > Create **one** `ServiceBusClient` per application and reuse it: it holds the connection to Service Bus.
   > Close it at the end of a script (`client.close()`), or Node.js keeps running.

---

## Part 3: Send messages

1. Create `src/send.ts`:
   ```typescript
   import { client, createRandomOrder, describe, toMessage } from "./shared.ts";

   const count = Number(process.argv[2] ?? 5);
   const sender = client.createSender("orders");

   // A batch is sent in one network call. tryAddMessage returns false when the batch is full.
   const batch = await sender.createMessageBatch();
   for (let i = 0; i < count; i++) {
       const order = createRandomOrder();
       if (!batch.tryAddMessage(toMessage(order))) {
           throw new Error("The batch is full");
       }
       console.log(`Added ${describe(order)}`);
   }

   await sender.sendMessages(batch);
   console.log(`Sent ${count} messages to 'orders'`);
   await client.close();
   ```
   A message has a **body** (here the order, sent as JSON) and **properties**: system properties like `messageId` and
   `subject`, and your own **application properties**.

2. Create `src/send-invalid.ts`, which you'll use in Part 6:
   ```typescript
   import { client, toMessage } from "./shared.ts";

   const sender = client.createSender("orders");
   await sender.sendMessages(toMessage({ id: 1, customer: "contoso", amount: -10, region: "EU" }));
   await sender.sendMessages(toMessage({ id: 2, customer: "blocked", amount: 100, region: "US" }));
   console.log("Sent an order with a negative amount and an order from a blocked customer");
   await client.close();
   ```

3. Send 5 orders:
   ```sh
   npm run send -- 5
   ```
   In the portal, open the `orders` queue: the *Active message count* is 5. Open **Service Bus Explorer** (in the
   menu of the queue) and select *Peek from start* to look at the messages, their body and properties.
   Nobody has received them yet, and that's fine: they wait in the queue.

---

## Part 4: Receive messages with peek-lock

1. Create `src/receive.ts`:
   ```typescript
   import { client, describe, Order } from "./shared.ts";

   // peekLock (the default): a received message is locked, not removed.
   const receiver = client.createReceiver("orders");

   const messages = await receiver.receiveMessages(10, { maxWaitTimeInMs: 5000 });
   console.log(`Received ${messages.length} messages`);

   for (const message of messages) {
       const order = message.body as Order;
       console.log(`${describe(order)} (delivery count ${message.deliveryCount})`);

       // Completing removes the message from the queue. Without it, the lock expires
       // and the message becomes available again.
       await receiver.completeMessage(message);
   }

   await client.close();
   ```

2. Receive the messages:
   ```sh
   npm run receive
   ```
   The queue is empty now (check the count in the portal). Note that `deliveryCount` is **0**: in the Node.js SDK it
   counts the *previous* delivery attempts.

3. **What if the receiver doesn't complete?** Comment out the `completeMessage` line, then:
   ```sh
   npm run send -- 2
   npm run receive
   npm run receive
   ```
   The second `receive` gets **nothing**: the messages are locked by the first receive. Wait 30 seconds (the lock
   duration) and receive again: the messages are back, with **delivery count 1**.

   This is how Service Bus protects you against crashes: a receiver that dies halfway never completes the message, so
   after the lock expires another receiver gets it. Nothing is lost. The price: a message can be processed **more than
   once**, so make your processing idempotent.

4. Put the `completeMessage` line back and run `receive` once more (wait for the lock if needed) to empty the queue.

> The other receive mode is `receiveAndDelete` (`client.createReceiver("orders", { receiveMode: "receiveAndDelete" })`):
> the message is removed as soon as it's received. Faster, but if your code crashes the message is gone.

---

## Part 5: Competing consumers

`receiver.subscribe(...)` keeps receiving in the background and calls your handler for every message. Run two
of these workers, and they share the work.

1. Create `src/process.ts`:
   ```typescript
   import { createInterface } from "node:readline/promises";
   import { client, describe, Order } from "./shared.ts";

   const name = process.argv[2] ?? "worker";
   const receiver = client.createReceiver("orders");

   // subscribe keeps receiving messages in the background and calls processMessage for each one.
   receiver.subscribe(
       {
           processMessage: async (message) => {
               const order = message.body as Order;
               console.log(`[${name}] ${describe(order)} (delivery count ${message.deliveryCount})`);
               await new Promise((resolve) => setTimeout(resolve, 1000)); // simulate work

               if (order.customer === "blocked") {
                   // This can never succeed: move it to the dead-letter queue right away.
                   await receiver.deadLetterMessage(message, {
                       deadLetterReason: "CustomerBlocked",
                       deadLetterErrorDescription: "This customer may not order",
                   });
                   console.log(`[${name}]   -> dead-lettered`);
                   return;
               }
               if (order.amount < 0) {
                   // Give the message back: it will be delivered again, until the max delivery count.
                   await receiver.abandonMessage(message);
                   console.log(`[${name}]   -> abandoned, will be retried`);
                   return;
               }

               await receiver.completeMessage(message);
               console.log(`[${name}]   -> completed`);
           },
           processError: async (args) => {
               console.log(`[${name}] error: ${args.error.message}`);
           },
       },
       { autoCompleteMessages: false, maxConcurrentCalls: 1 },
   );

   const input = createInterface({ input: process.stdin, output: process.stdout });
   await input.question(`[${name}] Processing messages from 'orders'. Press Enter to stop.\n`);
   input.close();
   await client.close();
   ```

2. Open **two extra terminals** in the project folder, and start a worker in each:
   ```sh
   npm run process -- A
   ```
   ```sh
   npm run process -- B
   ```

3. In your first terminal, send 10 orders:
   ```sh
   npm run send -- 10
   ```
   Watch the two workers: each order is processed by **exactly one** of them, and together they process the queue
   about twice as fast. This is how you scale background processing: add workers. When there's a peak, the queue
   absorbs it (*load leveling*).

4. Stop worker B (press Enter), send 10 more orders: worker A processes all of them. Keep worker A running.

---

## Part 6: When processing fails: retries and the dead-letter queue

The worker from Part 5 already contains two kinds of failures:
- An order with a **negative amount** is *abandoned*: it goes back to the queue and is delivered again.
- An order from a **blocked** customer can never succeed, so it's *dead-lettered* right away.

1. With worker A still running, send the two invalid orders:
   ```sh
   npm run send-invalid
   ```
   Worker A shows the negative order three times (delivery count 0, 1, 2). After the third attempt
   (`--max-delivery-count 3`), Service Bus moves it to the **dead-letter queue (DLQ)**. The blocked customer is
   dead-lettered immediately.

2. Create `src/dlq.ts` to look at the dead-letter queue:
   ```typescript
   import { client, describe, Order } from "./shared.ts";

   // The dead-letter queue is a sub-queue of 'orders'.
   const receiver = client.createReceiver("orders", { subQueueType: "deadLetter" });

   // Peek: read without locking or removing the messages.
   const messages = await receiver.peekMessages(20);
   console.log(`${messages.length} messages in the dead-letter queue`);

   for (const message of messages) {
       const order = message.body as Order;
       console.log(`${describe(order)}: ${message.deadLetterReason} (${message.deadLetterErrorDescription})`);
   }

   await client.close();
   ```
   ```sh
   npm run dlq
   ```
   You see both orders with their reason: `MaxDeliveryCountExceeded` and your own `CustomerBlocked`.

3. In the portal: Service Bus Explorer on the `orders` queue → *Dead-letter* tab. From there you can inspect messages,
   and **re-send** them to the queue after fixing the problem.

4. Stop worker A (press Enter).

> The DLQ keeps failed messages instead of losing them or blocking the queue. In production, **monitor the DLQ**
> (for example with an alert on the dead-letter message count).

---

## Part 7: Topics and subscriptions

A queue delivers each message to **one** receiver. A **topic** delivers a copy to **every subscription** whose filter
matches. The publisher doesn't know who's listening.

1. Create `src/publish.ts`:
   ```typescript
   import { client, createRandomOrder, describe, toMessage } from "./shared.ts";

   const count = Number(process.argv[2] ?? 10);

   // Sending to a topic looks exactly like sending to a queue.
   const sender = client.createSender("order-events");

   for (let i = 0; i < count; i++) {
       const order = createRandomOrder();
       await sender.sendMessages(toMessage(order));
       console.log(`Published ${describe(order)}`);
   }

   await client.close();
   ```

2. Create `src/subscribe.ts`:
   ```typescript
   import { createInterface } from "node:readline/promises";
   import { client, describe, Order } from "./shared.ts";

   const subscription = process.argv[2];
   if (!subscription) {
       throw new Error("Usage: subscribe.ts <subscription>");
   }

   // Each subscription gets its own copy of every message that matches its filter.
   const receiver = client.createReceiver("order-events", subscription);

   receiver.subscribe({
       processMessage: async (message) => {
           console.log(`[${subscription}] ${describe(message.body as Order)}`);
           // autoCompleteMessages is true by default
       },
       processError: async (args) => {
           console.log(`[${subscription}] error: ${args.error.message}`);
       },
   });

   const input = createInterface({ input: process.stdin, output: process.stdout });
   await input.question(`Listening on subscription '${subscription}'. Press Enter to stop.\n`);
   input.close();
   await client.close();
   ```

3. Start a subscriber for each subscription, in three terminals:
   ```sh
   npm run subscribe -- all-orders
   ```
   ```sh
   npm run subscribe -- big-orders
   ```
   ```sh
   npm run subscribe -- eu-orders
   ```

4. Publish 10 orders from another terminal:
   ```sh
   npm run publish -- 10
   ```
   `all-orders` gets all 10, `big-orders` only the orders of EUR 1000 or more, `eu-orders` only the EU orders.
   Some orders arrive at two or three subscribers: each subscription has its **own copy**.

5. Stop the `eu-orders` subscriber, publish 10 more orders, and start it again. It still receives the EU orders it
   missed: a subscription keeps its messages until they're received, just like a queue.

6. **Your turn:** add a subscription `small-orders` that only receives orders below EUR 500, and test it.
   (Tip: the `az` commands from Part 1, step 3 and 4.)

---

## Part 8: Clean up

Delete the resource group with everything in it:
```sh
az group delete --name rg-sblab-<suffix> --yes --no-wait
```

---

## Bonus challenges

1. **Scheduled messages**: send an order that only becomes visible in the queue after 1 minute
   (`sender.scheduleMessages(message, new Date(Date.now() + 60_000))`). Watch *Scheduled message count* in the portal.
2. **Duplicate detection**: create a queue with `--enable-duplicate-detection true`, send the same order twice with the
   same `messageId`, and count the messages in the queue.
3. **Sessions**: create a queue with `--enable-session true`. Send messages with a `sessionId` (for example the customer)
   and receive them with `client.acceptNextSession("<queue>")`. Messages of one session arrive in order.
4. **No connection string**: use Microsoft Entra ID instead. Assign yourself the role *Azure Service Bus Data Owner* on
   the namespace, install `@azure/identity`, and create the client with
   `new ServiceBusClient("sb-lab-<suffix>.servicebus.windows.net", new DefaultAzureCredential())`. In Azure, a managed
   identity takes your place.

---

## Troubleshooting

| Problem | Solution |
| --- | --- |
| `SERVICEBUS_CONNECTION_STRING is not set` | Create the `.env` file in the project folder (Part 2, step 3) and run the scripts with `npm run` |
| `node: bad option: --env-file` | Your Node.js version is too old: install Node.js 22 or 24 |
| `MessagingEntityNotFound` | Check the queue, topic and subscription names, and that you created them in your own namespace |
| `receive` gets 0 messages right after a receive without complete | The messages are still locked: wait for the lock duration (30 seconds) |
| A script doesn't stop | The `ServiceBusClient` is still open: make sure the script ends with `await client.close()` |
| A subscriber receives nothing | Check the subscription's filter rules (in the portal, or with `az servicebus topic subscription rule list`), and that the `$Default` rule is removed only where intended |

---

## Congratulations!
You sent and received messages with Azure Service Bus, used peek-lock, competing consumers, retries and the
dead-letter queue, and built a publish/subscribe flow with topics and filtered subscriptions.
