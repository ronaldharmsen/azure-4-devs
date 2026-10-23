using Microsoft.Extensions.Configuration;

// Both connection strings are stored with 'dotnet user-secrets', outside the project folder (and outside git).
var config = new ConfigurationBuilder().AddUserSecrets<Program>().Build();
string eventHubsConnection = config["EventHubsConnectionString"]
    ?? throw new InvalidOperationException("Run: dotnet user-secrets set EventHubsConnectionString \"<connection-string>\"");
string storageConnection = config["StorageConnectionString"] ?? "";

const string EventHub = "telemetry";

string command = args.Length > 0 ? args[0] : "";
string argument = args.Length > 1 ? args[1] : "";
string argument2 = args.Length > 2 ? args[2] : "";

switch (command)
{
    case "send": await Send.Run(eventHubsConnection, EventHub, argument == "" ? 5 : int.Parse(argument)); break;
    case "info": await Info.Run(eventHubsConnection, EventHub); break;
    case "read": await Read.Run(eventHubsConnection, EventHub); break;
    case "process": await Process.Run(eventHubsConnection, EventHub, storageConnection,
        name: argument == "" ? "processor" : argument, consumerGroup: argument2 == "" ? "dashboard" : argument2); break;
    default:
        Console.WriteLine("Commands: send [count] | info | read | process [name] [consumer-group]");
        break;
}
