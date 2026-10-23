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
