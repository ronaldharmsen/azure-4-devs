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
