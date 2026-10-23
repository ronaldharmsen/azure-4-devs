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
