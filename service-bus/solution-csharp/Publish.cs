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
