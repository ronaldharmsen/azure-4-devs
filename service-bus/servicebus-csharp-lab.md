# Lab: Messaging with Azure Service Bus (C#)

In this lab you build a small console application that sends and receives orders through **Azure Service Bus**.
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

Estimated time: about 1.5 hours. A finished version is in the [solution-csharp](solution-csharp/) folder.
There is also a [Node.js version](servicebus-nodejs-lab.md) of this lab.

---

## Prerequisites
- .NET 10 SDK installed
- Azure CLI installed, logged in (`az login`)
- An active Azure subscription
- Visual Studio or Visual Studio Code

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

1. Create a console app and add the Service Bus SDK and the user-secrets configuration package:
   ```sh
   dotnet new console -n ServiceBusLab
   cd ServiceBusLab
   dotnet add package Azure.Messaging.ServiceBus
   dotnet add package Microsoft.Extensions.Configuration.UserSecrets
   ```

2. Get the connection string of your namespace:
   ```sh
   az servicebus namespace authorization-rule keys list --resource-group rg-sblab-<suffix> --namespace-name sb-lab-<suffix> --name RootManageSharedAccessKey --query primaryConnectionString -o tsv
   ```

3. Store it with **user-secrets**. That keeps it outside your project folder, so it never ends up in git:
   ```sh
   dotnet user-secrets init
   dotnet user-secrets set ServiceBusConnectionString "<connection-string>"
   ```

4. Create `Order.cs`, the message you'll send:
   ```csharp
   public record Order(int Id, string Customer, decimal Amount, string Region)
   {
       private static readonly string[] Customers = ["contoso", "fabrikam", "northwind"];
       private static readonly string[] Regions = ["EU", "US", "APAC"];

       public static Order CreateRandom() => new(
           Random.Shared.Next(1000, 9999),
           Customers[Random.Shared.Next(Customers.Length)],
           Random.Shared.Next(1, 40) * 50,
           Regions[Random.Shared.Next(Regions.Length)]);

       public override string ToString() => $"order {Id}: {Customer}, EUR {Amount}, {Region}";
   }
   ```

5. Replace `Program.cs`. It reads the connection string, creates one `ServiceBusClient`, and runs a command
   from the command line. You'll add a `case` for every part of the lab:
   ```csharp
   using Azure.Messaging.ServiceBus;
   using Microsoft.Extensions.Configuration;

   // The connection string is stored with 'dotnet user-secrets', outside the project folder (and outside git).
   var config = new ConfigurationBuilder().AddUserSecrets<Program>().Build();
   string connectionString = config["ServiceBusConnectionString"]
       ?? throw new InvalidOperationException("Run: dotnet user-secrets set ServiceBusConnectionString \"<connection-string>\"");

   await using var client = new ServiceBusClient(connectionString);

   string command = args.Length > 0 ? args[0] : "";
   string argument = args.Length > 1 ? args[1] : "";

   switch (command)
   {
       // the cases for each part of the lab go here
       default:
           Console.WriteLine("Commands: send [count] | send-invalid | receive | process [name] | dlq | publish [count] | subscribe <subscription>");
           break;
   }
   ```
   > Create **one** `ServiceBusClient` per application and reuse it: it holds the connection to Service Bus.

6. Check that it builds and runs:
   ```sh
   dotnet run
   ```

---

## Part 3: Send messages

1. Create `Send.cs`:
   ```csharp
   using Azure.Messaging.ServiceBus;

   public static class Send
   {
       public static async Task Run(ServiceBusClient client, int count)
       {
           await using ServiceBusSender sender = client.CreateSender("orders");

           // A batch is sent in one network call. TryAddMessage returns false when the batch is full.
           using ServiceBusMessageBatch batch = await sender.CreateMessageBatchAsync();
           for (int i = 0; i < count; i++)
           {
               Order order = Order.CreateRandom();
               if (!batch.TryAddMessage(ToMessage(order)))
               {
                   throw new InvalidOperationException("The batch is full");
               }
               Console.WriteLine($"Added {order}");
           }

           await sender.SendMessagesAsync(batch);
           Console.WriteLine($"Sent {count} messages to 'orders'");
       }

       public static async Task Invalid(ServiceBusClient client)
       {
           await using ServiceBusSender sender = client.CreateSender("orders");
           await sender.SendMessageAsync(ToMessage(new Order(1, "contoso", -10, "EU")));
           await sender.SendMessageAsync(ToMessage(new Order(2, "blocked", 100, "US")));
           Console.WriteLine("Sent an order with a negative amount and an order from a blocked customer");
       }

       public static ServiceBusMessage ToMessage(Order order) => new(BinaryData.FromObjectAsJson(order))
       {
           MessageId = order.Id.ToString(),
           Subject = "order-created",
           ContentType = "application/json",
           // Application properties are visible to the broker, for example for filters on topic subscriptions.
           ApplicationProperties = { ["region"] = order.Region, ["amount"] = (double)order.Amount },
       };
   }
   ```
   A message has a **body** (here the order as JSON) and **properties**: system properties like `MessageId` and
   `Subject`, and your own **application properties**.

2. Add the cases to the switch in `Program.cs`:
   ```csharp
   case "send": await Send.Run(client, argument == "" ? 5 : int.Parse(argument)); break;
   case "send-invalid": await Send.Invalid(client); break;
   ```

3. Send 5 orders:
   ```sh
   dotnet run -- send 5
   ```
   In the portal, open the `orders` queue: the *Active message count* is 5. Open **Service Bus Explorer** (in the
   menu of the queue) and select *Peek from start* to look at the messages, their body and properties.
   Nobody has received them yet, and that's fine: they wait in the queue.

---

## Part 4: Receive messages with peek-lock

1. Create `Receive.cs`:
   ```csharp
   using Azure.Messaging.ServiceBus;

   public static class Receive
   {
       public static async Task Run(ServiceBusClient client)
       {
           // PeekLock (the default): a received message is locked, not removed.
           await using ServiceBusReceiver receiver = client.CreateReceiver("orders");

           IReadOnlyList<ServiceBusReceivedMessage> messages =
               await receiver.ReceiveMessagesAsync(maxMessages: 10, maxWaitTime: TimeSpan.FromSeconds(5));
           Console.WriteLine($"Received {messages.Count} messages");

           foreach (ServiceBusReceivedMessage message in messages)
           {
               Order order = message.Body.ToObjectFromJson<Order>()!;
               Console.WriteLine($"{order} (delivery count {message.DeliveryCount})");

               // Completing removes the message from the queue. Without it, the lock expires
               // and the message becomes available again.
               await receiver.CompleteMessageAsync(message);
           }
       }
   }
   ```

2. Add the case and receive the messages:
   ```csharp
   case "receive": await Receive.Run(client); break;
   ```
   ```sh
   dotnet run -- receive
   ```
   The queue is empty now (check the count in the portal).

3. **What if the receiver doesn't complete?** Comment out the `CompleteMessageAsync` line, then:
   ```sh
   dotnet run -- send 2
   dotnet run -- receive
   dotnet run -- receive
   ```
   The second `receive` gets **nothing**: the messages are locked by the first receive. Wait 30 seconds (the lock
   duration) and receive again: the messages are back, with **delivery count 2**.

   This is how Service Bus protects you against crashes: a receiver that dies halfway never completes the message, so
   after the lock expires another receiver gets it. Nothing is lost. The price: a message can be processed **more than
   once**, so make your processing idempotent.

4. Put the `CompleteMessageAsync` line back and run `receive` once more (wait for the lock if needed) to empty the queue.

> The other receive mode is `ReceiveAndDelete`: the message is removed as soon as it's received. Faster, but if your
> code crashes the message is gone.

---

## Part 5: Competing consumers

A `ServiceBusProcessor` keeps receiving in the background and calls your handler for every message. Run two of
them, and they share the work.

1. Create `Process.cs`:
   ```csharp
   using Azure.Messaging.ServiceBus;

   public static class Process
   {
       public static async Task Run(ServiceBusClient client, string name)
       {
           // A processor keeps receiving messages in the background and calls your handler for each one.
           await using ServiceBusProcessor processor = client.CreateProcessor("orders", new ServiceBusProcessorOptions
           {
               MaxConcurrentCalls = 1,
               AutoCompleteMessages = false,
           });

           processor.ProcessMessageAsync += async args =>
           {
               Order order = args.Message.Body.ToObjectFromJson<Order>()!;
               Console.WriteLine($"[{name}] {order} (delivery count {args.Message.DeliveryCount})");
               await Task.Delay(1000); // simulate work

               if (order.Customer == "blocked")
               {
                   // This can never succeed: move it to the dead-letter queue right away.
                   await args.DeadLetterMessageAsync(args.Message, "CustomerBlocked", "This customer may not order");
                   Console.WriteLine($"[{name}]   -> dead-lettered");
                   return;
               }
               if (order.Amount < 0)
               {
                   // Give the message back: it will be delivered again, until the max delivery count.
                   await args.AbandonMessageAsync(args.Message);
                   Console.WriteLine($"[{name}]   -> abandoned, will be retried");
                   return;
               }

               await args.CompleteMessageAsync(args.Message);
               Console.WriteLine($"[{name}]   -> completed");
           };

           processor.ProcessErrorAsync += args =>
           {
               Console.WriteLine($"[{name}] error: {args.Exception.Message}");
               return Task.CompletedTask;
           };

           await processor.StartProcessingAsync();
           Console.WriteLine($"[{name}] Processing messages from 'orders'. Press Enter to stop.");
           Console.ReadLine();
           await processor.StopProcessingAsync();
       }
   }
   ```

2. Add the case:
   ```csharp
   case "process": await Process.Run(client, argument == "" ? "worker" : argument); break;
   ```

3. Open **two extra terminals** in the project folder, and start a worker in each:
   ```sh
   dotnet run -- process A
   ```
   ```sh
   dotnet run -- process B
   ```

4. In your first terminal, send 10 orders:
   ```sh
   dotnet run -- send 10
   ```
   Watch the two workers: each order is processed by **exactly one** of them, and together they process the queue
   about twice as fast. This is how you scale background processing: add workers. When there's a peak, the queue
   absorbs it (*load leveling*).

5. Stop worker B (press Enter), send 10 more orders: worker A processes all of them. Keep worker A running.

---

## Part 6: When processing fails: retries and the dead-letter queue

The worker from Part 5 already contains two kinds of failures:
- An order with a **negative amount** is *abandoned*: it goes back to the queue and is delivered again.
- An order from a **blocked** customer can never succeed, so it's *dead-lettered* right away.

1. With worker A still running, send the two invalid orders:
   ```sh
   dotnet run -- send-invalid
   ```
   Worker A shows the negative order three times (delivery count 1, 2, 3). After the third attempt
   (`--max-delivery-count 3`), Service Bus moves it to the **dead-letter queue (DLQ)**. The blocked customer is
   dead-lettered immediately.

2. Create `DeadLetters.cs` to look at the dead-letter queue:
   ```csharp
   using Azure.Messaging.ServiceBus;

   public static class DeadLetters
   {
       public static async Task Run(ServiceBusClient client)
       {
           // The dead-letter queue is a sub-queue of 'orders'.
           await using ServiceBusReceiver receiver = client.CreateReceiver("orders",
               new ServiceBusReceiverOptions { SubQueue = SubQueue.DeadLetter });

           // Peek: read without locking or removing the messages.
           IReadOnlyList<ServiceBusReceivedMessage> messages = await receiver.PeekMessagesAsync(maxMessages: 20);
           Console.WriteLine($"{messages.Count} messages in the dead-letter queue");

           foreach (ServiceBusReceivedMessage message in messages)
           {
               Order order = message.Body.ToObjectFromJson<Order>()!;
               Console.WriteLine($"{order}: {message.DeadLetterReason} ({message.DeadLetterErrorDescription})");
           }
       }
   }
   ```
   ```csharp
   case "dlq": await DeadLetters.Run(client); break;
   ```
   ```sh
   dotnet run -- dlq
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

1. Create `Publish.cs`:
   ```csharp
   using Azure.Messaging.ServiceBus;

   public static class Publish
   {
       public static async Task Run(ServiceBusClient client, int count)
       {
           // Sending to a topic looks exactly like sending to a queue.
           await using ServiceBusSender sender = client.CreateSender("order-events");

           for (int i = 0; i < count; i++)
           {
               Order order = Order.CreateRandom();
               await sender.SendMessageAsync(Send.ToMessage(order));
               Console.WriteLine($"Published {order}");
           }
       }
   }
   ```

2. Create `Subscribe.cs`:
   ```csharp
   using Azure.Messaging.ServiceBus;

   public static class Subscribe
   {
       public static async Task Run(ServiceBusClient client, string subscription)
       {
           // Each subscription gets its own copy of every message that matches its filter.
           await using ServiceBusProcessor processor = client.CreateProcessor("order-events", subscription);

           processor.ProcessMessageAsync += args =>
           {
               Order order = args.Message.Body.ToObjectFromJson<Order>()!;
               Console.WriteLine($"[{subscription}] {order}");
               return Task.CompletedTask; // AutoCompleteMessages is true by default
           };
           processor.ProcessErrorAsync += args =>
           {
               Console.WriteLine($"[{subscription}] error: {args.Exception.Message}");
               return Task.CompletedTask;
           };

           await processor.StartProcessingAsync();
           Console.WriteLine($"Listening on subscription '{subscription}'. Press Enter to stop.");
           Console.ReadLine();
           await processor.StopProcessingAsync();
       }
   }
   ```

3. Add the cases:
   ```csharp
   case "publish": await Publish.Run(client, argument == "" ? 10 : int.Parse(argument)); break;
   case "subscribe": await Subscribe.Run(client, argument); break;
   ```

4. Start a subscriber for each subscription, in three terminals:
   ```sh
   dotnet run -- subscribe all-orders
   ```
   ```sh
   dotnet run -- subscribe big-orders
   ```
   ```sh
   dotnet run -- subscribe eu-orders
   ```

5. Publish 10 orders from another terminal:
   ```sh
   dotnet run -- publish 10
   ```
   `all-orders` gets all 10, `big-orders` only the orders of EUR 1000 or more, `eu-orders` only the EU orders.
   Some orders arrive at two or three subscribers: each subscription has its **own copy**.

6. Stop the `eu-orders` subscriber, publish 10 more orders, and start it again. It still receives the EU orders it
   missed: a subscription keeps its messages until they're received, just like a queue.

7. **Your turn:** add a subscription `small-orders` that only receives orders below EUR 500, and test it.
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
   (`sender.ScheduleMessageAsync(message, DateTimeOffset.UtcNow.AddMinutes(1))`). Watch *Scheduled message count* in
   the portal.
2. **Duplicate detection**: create a queue with `--enable-duplicate-detection true`, send the same order twice with the
   same `MessageId`, and count the messages in the queue.
3. **Sessions**: create a queue with `--enable-session true`. Send messages with a `SessionId` (for example the customer)
   and receive them with `client.CreateSessionProcessor(...)`. Messages of one session arrive in order, while different
   sessions are processed in parallel.
4. **No connection string**: use Microsoft Entra ID instead. Assign yourself the role *Azure Service Bus Data Owner* on
   the namespace, add the `Azure.Identity` package, and create the client with
   `new ServiceBusClient("sb-lab-<suffix>.servicebus.windows.net", new DefaultAzureCredential())`. In Azure, a managed
   identity takes your place.

---

## Troubleshooting

| Problem | Solution |
| --- | --- |
| `Run: dotnet user-secrets set ...` | The connection string isn't stored for this project: run the commands from Part 2, step 3 in the project folder |
| `MessagingEntityNotFound` | Check the queue, topic and subscription names, and that you created them in your own namespace |
| `receive` gets 0 messages right after a receive without complete | The messages are still locked: wait for the lock duration (30 seconds) |
| A subscriber receives nothing | Check the subscription's filter rules (in the portal, or with `az servicebus topic subscription rule list`), and that the `$Default` rule is removed only where intended |

---

## Congratulations!
You sent and received messages with Azure Service Bus, used peek-lock, competing consumers, retries and the
dead-letter queue, and built a publish/subscribe flow with topics and filtered subscriptions.
