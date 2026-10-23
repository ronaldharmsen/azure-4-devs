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
    case "send": await Send.Run(client, argument == "" ? 5 : int.Parse(argument)); break;
    case "send-invalid": await Send.Invalid(client); break;
    case "receive": await Receive.Run(client); break;
    case "process": await Process.Run(client, argument == "" ? "worker" : argument); break;
    case "dlq": await DeadLetters.Run(client); break;
    case "publish": await Publish.Run(client, argument == "" ? 10 : int.Parse(argument)); break;
    case "subscribe": await Subscribe.Run(client, argument); break;
    default:
        Console.WriteLine("Commands: send [count] | send-invalid | receive | process [name] | dlq | publish [count] | subscribe <subscription>");
        break;
}
