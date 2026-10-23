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
