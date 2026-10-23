// Both connection strings come from the .env file (loaded with node --env-file=.env).
export const eventHubsConnectionString = required("EVENTHUBS_CONNECTION_STRING");
export const storageConnectionString = process.env.STORAGE_CONNECTION_STRING ?? "";
export const eventHubName = "telemetry";

export interface Reading {
    device: string;
    temperature: number;
    time: string;
}

export function describe(reading: Reading): string {
    return `${reading.device} ${reading.temperature.toFixed(1)} °C`;
}

function required(name: string): string {
    const value = process.env[name];
    if (!value) {
        throw new Error(`${name} is not set: create a .env file and run with --env-file=.env`);
    }
    return value;
}
