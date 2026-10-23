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
