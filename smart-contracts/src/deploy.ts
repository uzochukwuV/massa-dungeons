import * as dotenv from "dotenv";
import { readFileSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { deploySC, WalletClient, ISCData } from "@massalabs/massa-sc-deployer";
import { DefaultProviderUrls, MassaUnits } from "@massalabs/massa-web3";

dotenv.config();
console.log("Loading environment variables...");

// const publicApi = process.env.JSON_RPC_URL_PUBLIC!;
const publicApi = DefaultProviderUrls.TESTNET;

console.log("Connecting to Massa public API at:", publicApi);
const privKey = process.env.WALLET_SECRET_KEY;
if (!privKey) {
    throw new Error("Missing WALLET_SECRET_KEY in .env file");
}

const deployerAccount = await WalletClient.getAccountFromSecretKey(privKey);
const deployerAddress = deployerAccount.address || "";

const __filename = fileURLToPath(import.meta.url);

const __dirname = path.dirname(path.dirname(__filename));

(async () => {
    const price_variation: ISCData = {
        data: readFileSync(path.join(__dirname, "build", "uni_massa.wasm")),
        coins: BigInt(3) * MassaUnits.oneMassa,
    };
    const simple_bot: ISCData = {
        data: readFileSync(path.join(__dirname, "build", "uni_massa_dca.wasm")),
        coins: BigInt(3) * MassaUnits.oneMassa,
    };
    const bot: ISCData = {
        data: readFileSync(path.join(__dirname, "build", "bot_rsi.wasm")),
        coins: BigInt(3) * MassaUnits.oneMassa,
    };
    const commands: ISCData = {
        data: readFileSync(path.join(__dirname, "build", "commands.wasm")),
        coins: BigInt(3) * MassaUnits.oneMassa,
    };

    /// In the brackets you can specify the SCs you want to deploy
    await deploySC(publicApi, deployerAccount, [], BigInt(100000000), BigInt(3_200_000_000), true);
})();
