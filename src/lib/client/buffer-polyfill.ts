// The Stellar SDK expects Node's Buffer; the browser does not have it.
// Import this module before "@stellar/stellar-sdk" in client code.
import { Buffer } from "buffer";

const g = globalThis as unknown as { Buffer?: typeof Buffer };
if (!g.Buffer) g.Buffer = Buffer;
