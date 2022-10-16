
export const URI: string = process.env.SOCKET_URL || "";
export const TOKEN: string = process.env.TOKEN || "";
export const CHANNEL_ID: string = process.env.CHANNEL || "";
export const DEBUG_CHANNEL_ID: string = process.env.DEBUG_CHANNEL || "";
export const REJECT_UNAUTHORIZED: boolean = process.env.REJECT_UNAUTHORIZED == "true";

if (TOKEN == "") {
    throw new Error("Error: TOKEN in env is invalid or missing.");
}
if (URI == "") {
    throw new Error("Error: SOCKET_URL in env is invalid or missing.");
}
if (CHANNEL_ID == "") {
    throw new Error("Error: CHANNEL_ID in env is invalid or missing.");
}
if (DEBUG_CHANNEL_ID == "") {
    throw new Error("Error: DEBUG_CHANNEL_ID in env is invalid or missing.");
}
