
const CONFIG = {
    // Update these addresses with your deployed contract addresses
    MASSASWAP_CORE_ADDRESS: "AS1xS7YryYp3NxXqv9KZspi9BtZnLBTtQY5GBGcSkNWu9mY8a7jg",
    ADVANCED_DEFI_ADDRESS: "AS12MWD7ntspmLjmMZRkQpyEAcFWYHQJiiRxnMJLWv7Q6MYzDoXNz",
    USDC_ADDRESS: "AS1dJ8mrm2cVSdZVZLXo43wRx5FxywZ9BmxiUmXCy7Tx72XNbit8",
    WMAS_ADDRESS: "AS12XdqMFYx1Ghd5LRzMq9hw81hVgBAYX9zqMJVZeVyM9nRn4C2pt",
    
    PROVIDERS: [
        {
            url: "http://149.202.84.7:33035",
            type: window.massa.ProviderType.PUBLIC,
        },
        {
            url: "http://149.202.84.7:33034",
            type: window.massa.ProviderType.PRIVATE,
        },
        {
            url: "ws://149.202.84.7:33036",
            type: window.massa.ProviderType.WS,
        }
    ],
    
    // Gas limits for different operations
    GAS_LIMITS: {
        READ_OPERATION: 20_000_000n,
        SWAP: 200_000_000n,
        ADD_LIQUIDITY: 300_000_000n,
        REMOVE_LIQUIDITY: 300_000_000n,
        CREATE_POOL: 500_000_000n,
        LIMIT_ORDER: 200_000_000n,
        DCA_STRATEGY: 300_000_000n,
        YIELD_FARMING: 400_000_000n,
        AUTONOMOUS_ENGINE: 800_000_000n
    }
};

const ONE_UNIT = BigInt(10 ** 9);

// Global variables
let web3Client = undefined;
let baseAccount = undefined;
let eventPoller = undefined;

// Initialize MassaSwap client
class MassaSwapClient {
    constructor(account) {
        this.account = account;
        this.isInitialized = false;
    }

    async initialize() {
        try {
            baseAccount = this.account;
            
            const client = await massa.ClientFactory.createCustomClient(
                CONFIG.PROVIDERS,
                true,
                baseAccount
            );
            
            const status = await client.publicApi().getNodeStatus();
            
            const eventsFilter = {
                start: status.last_slot,
                end: null,
                original_caller_address: null,
                original_operation_id: null,
                emitter_address: null,
            };
            
            web3Client = client;
            
            // Start event polling
            eventPoller = window.massa.EventPoller.startEventsPolling(
                eventsFilter,
                1000,
                web3Client
            );
            
            eventPoller.on(window.massa.ON_MASSA_EVENT_DATA, this.onEventData);
            eventPoller.on(window.massa.ON_MASSA_EVENT_ERROR, this.onEventDataError);
            
            this.isInitialized = true;
            console.log("MassaSwap client initialized successfully");
            
        } catch (error) {
            console.error("Failed to initialize MassaSwap client:", error);
            throw error;
        }
    }

    onEventData(events) {
        for (const evt of events) {
            if (evt.data.includes("MassaSwap:")) {
                console.log("MassaSwap Event:", evt.data);
                
                
                const customEvent = new CustomEvent("massaswap-event", {
                    detail: {
                        data: evt.data,
                        timestamp: new Date().toISOString()
                    }
                });
                document.dispatchEvent(customEvent);
            }
        }
    }

    onEventDataError(error) {
        console.error("Event polling error:", error);
    }

    // Ensure client is initialized before operations
    ensureInitialized() {
        if (!this.isInitialized || !web3Client) {
            throw new Error("MassaSwap client not initialized. Call initialize() first.");
        }
    }
}


class MassaSwapDEX {
    constructor(client) {
        this.client = client;
    }

    
    async createPool(tokenA, tokenB, amountA, amountB) {
        this.client.ensureInitialized();
        
        try {
            const args = new window.massa.Args();
            args.addString(tokenA);
            args.addString(tokenB);
            args.addU64(BigInt(amountA));
            args.addU64(BigInt(amountB));

            const result = await web3Client.smartContracts().callSmartContract(
                {
                    fee: 0n,
                    maxGas: CONFIG.GAS_LIMITS.CREATE_POOL,
                    coins: massa.fromMAS("1"),
                    targetAddress: CONFIG.MASSASWAP_CORE_ADDRESS,
                    functionName: "createPool",
                    parameter: args.serialize(),
                },
                baseAccount
            );

            console.log("Pool creation result:", result);
            return result;
        } catch (error) {
            console.error("Error creating pool:", error);
            throw error;
        }
    }

    // Add liquidity to existing pool
    async addLiquidity(tokenA, tokenB, amountA, amountB) {
        this.client.ensureInitialized();
        
        try {
            const args = new window.massa.Args();
            args.addString(tokenA);
            args.addString(tokenB);
            args.addU64(BigInt(amountA));
            args.addU64(BigInt(amountB));

            const result = await web3Client.smartContracts().callSmartContract(
                {
                    fee: 0n,
                    maxGas: CONFIG.GAS_LIMITS.ADD_LIQUIDITY,
                    coins: massa.fromMAS("1"),
                    targetAddress: CONFIG.MASSASWAP_CORE_ADDRESS,
                    functionName: "addLiquidity",
                    parameter: args.serialize(),
                },
                baseAccount
            );

            console.log("Add liquidity result:", result);
            return result;
        } catch (error) {
            console.error("Error adding liquidity:", error);
            throw error;
        }
    }

    // Remove liquidity from pool
    async removeLiquidity(tokenA, tokenB, liquidity) {
        this.client.ensureInitialized();
        
        try {
            const args = new window.massa.Args();
            args.addString(tokenA);
            args.addString(tokenB);
            args.addU64(BigInt(liquidity));

            const result = await web3Client.smartContracts().callSmartContract(
                {
                    fee: 0n,
                    maxGas: CONFIG.GAS_LIMITS.REMOVE_LIQUIDITY,
                    coins: massa.fromMAS("1"),
                    targetAddress: CONFIG.MASSASWAP_CORE_ADDRESS,
                    functionName: "removeLiquidity",
                    parameter: args.serialize(),
                },
                baseAccount
            );

            console.log("Remove liquidity result:", result);
            return result;
        } catch (error) {
            console.error("Error removing liquidity:", error);
            throw error;
        }
    }

    // Perform token swap
    async swap(tokenIn, tokenOut, amountIn, minAmountOut) {
        this.client.ensureInitialized();
        
        try {
            const args = new window.massa.Args();
            args.addString(tokenIn);
            args.addString(tokenOut);
            args.addU64(BigInt(amountIn));
            args.addU64(BigInt(minAmountOut));

            const result = await web3Client.smartContracts().callSmartContract(
                {
                    fee: 0n,
                    maxGas: CONFIG.GAS_LIMITS.SWAP,
                    coins: massa.fromMAS("1"),
                    targetAddress: CONFIG.MASSASWAP_CORE_ADDRESS,
                    functionName: "swap",
                    parameter: args.serialize(),
                },
                baseAccount
            );

            console.log("Swap result:", result);
            return result;
        } catch (error) {
            console.error("Error performing swap:", error);
            throw error;
        }
    }

    // Get token balance
    async getTokenBalance(tokenAddress, userAddress) {
        this.client.ensureInitialized();
        
        try {
            const args = new window.massa.Args();
            args.addString(userAddress);

            const result = await web3Client.smartContracts().readSmartContract(
                {
                    fee: 0n,
                    callerAddress: baseAccount.address,
                    maxGas: CONFIG.GAS_LIMITS.READ_OPERATION,
                    coins: massa.fromMAS("1"),
                    targetAddress: tokenAddress,
                    targetFunction: "balanceOf",
                    parameter: args.serialize(),
                }
            );

            const balance = new window.massa.Args(result.returnValue).nextU64();
            return balance;
        } catch (error) {
            console.error("Error getting token balance:", error);
            throw error;
        }
    }

    // Get LP token balance
    async getLPBalance(tokenA, tokenB, userAddress) {
        this.client.ensureInitialized();
        
        try {
            // This would need to be implemented as a read function in the smart contract
            // For now, we'll return a placeholder
            console.log(`Getting LP balance for ${userAddress} in ${tokenA}/${tokenB} pool`);
            return 0n;
        } catch (error) {
            console.error("Error getting LP balance:", error);
            throw error;
        }
    }
}

// Advanced DeFi Features
class MassaSwapAdvanced {
    constructor(client) {
        this.client = client;
    }

    // Create DCA (Dollar Cost Averaging) strategy
    async createDCAStrategy(tokenIn, tokenOut, amountPerPeriod, intervalPeriods, totalPeriods, minAmountOut = 0) {
        this.client.ensureInitialized();
        
        try {
            const args = new window.massa.Args();
            args.addString(tokenIn);
            args.addString(tokenOut);
            args.addU64(BigInt(amountPerPeriod));
            args.addU64(BigInt(intervalPeriods));
            args.addU64(BigInt(totalPeriods));
            args.addU64(BigInt(minAmountOut));

            const result = await web3Client.smartContracts().callSmartContract(
                {
                    fee: 0n,
                    maxGas: CONFIG.GAS_LIMITS.DCA_STRATEGY,
                    coins: massa.fromMAS("1"),
                    targetAddress: CONFIG.ADVANCED_DEFI_ADDRESS,
                    functionName: "createDCAStrategy",
                    parameter: args.serialize(),
                },
                baseAccount
            );

            console.log("DCA strategy creation result:", result);
            return result;
        } catch (error) {
            console.error("Error creating DCA strategy:", error);
            throw error;
        }
    }

    // Create limit order
    async createLimitOrder(tokenIn, tokenOut, amountIn, minAmountOut, expiry, orderType = "buy") {
        this.client.ensureInitialized();
        
        try {
            const args = new window.massa.Args();
            args.addString(tokenIn);
            args.addString(tokenOut);
            args.addU64(BigInt(amountIn));
            args.addU64(BigInt(minAmountOut));
            args.addU64(BigInt(expiry));
            args.addString(orderType);

            const result = await web3Client.smartContracts().callSmartContract(
                {
                    fee: 0n,
                    maxGas: CONFIG.GAS_LIMITS.LIMIT_ORDER,
                    coins: massa.fromMAS("1"),
                    targetAddress: CONFIG.ADVANCED_DEFI_ADDRESS,
                    functionName: "createLimitOrder",
                    parameter: args.serialize(),
                },
                baseAccount
            );

            console.log("Limit order creation result:", result);
            return result;
        } catch (error) {
            console.error("Error creating limit order:", error);
            throw error;
        }
    }

    // Create yield farming pool
    async createYieldPool(tokenA, tokenB, rewardToken, rewardRate) {
        this.client.ensureInitialized();
        
        try {
            const args = new window.massa.Args();
            args.addString(tokenA);
            args.addString(tokenB);
            args.addString(rewardToken);
            args.addU64(BigInt(rewardRate));

            const result = await web3Client.smartContracts().callSmartContract(
                {
                    fee: 0n,
                    maxGas: CONFIG.GAS_LIMITS.YIELD_FARMING,
                    coins: massa.fromMAS("1"),
                    targetAddress: CONFIG.ADVANCED_DEFI_ADDRESS,
                    functionName: "createYieldPool",
                    parameter: args.serialize(),
                },
                baseAccount
            );

            console.log("Yield pool creation result:", result);
            return result;
        } catch (error) {
            console.error("Error creating yield pool:", error);
            throw error;
        }
    }

    // Stake LP tokens in yield farming pool
    async stakeLP(yieldPoolId, amount) {
        this.client.ensureInitialized();
        
        try {
            const args = new window.massa.Args();
            args.addU64(BigInt(yieldPoolId));
            args.addU64(BigInt(amount));

            const result = await web3Client.smartContracts().callSmartContract(
                {
                    fee: 0n,
                    maxGas: CONFIG.GAS_LIMITS.YIELD_FARMING,
                    coins: massa.fromMAS("1"),
                    targetAddress: CONFIG.ADVANCED_DEFI_ADDRESS,
                    functionName: "stakeLP",
                    parameter: args.serialize(),
                },
                baseAccount
            );

            console.log("LP staking result:", result);
            return result;
        } catch (error) {
            console.error("Error staking LP tokens:", error);
            throw error;
        }
    }

    // Unstake LP tokens from yield farming pool
    async unstakeLP(yieldPoolId, amount) {
        this.client.ensureInitialized();
        
        try {
            const args = new window.massa.Args();
            args.addU64(BigInt(yieldPoolId));
            args.addU64(BigInt(amount));

            const result = await web3Client.smartContracts().callSmartContract(
                {
                    fee: 0n,
                    maxGas: CONFIG.GAS_LIMITS.YIELD_FARMING,
                    coins: massa.fromMAS("1"),
                    targetAddress: CONFIG.ADVANCED_DEFI_ADDRESS,
                    functionName: "unstakeLP",
                    parameter: args.serialize(),
                },
                baseAccount
            );

            console.log("LP unstaking result:", result);
            return result;
        } catch (error) {
            console.error("Error unstaking LP tokens:", error);
            throw error;
        }
    }

    // Claim yield farming rewards
    async claimRewards(yieldPoolId) {
        this.client.ensureInitialized();
        
        try {
            const args = new window.massa.Args();
            args.addU64(BigInt(yieldPoolId));

            const result = await web3Client.smartContracts().callSmartContract(
                {
                    fee: 0n,
                    maxGas: CONFIG.GAS_LIMITS.YIELD_FARMING,
                    coins: massa.fromMAS("1"),
                    targetAddress: CONFIG.ADVANCED_DEFI_ADDRESS,
                    functionName: "claimRewards",
                    parameter: args.serialize(),
                },
                baseAccount
            );

            console.log("Rewards claim result:", result);
            return result;
        } catch (error) {
            console.error("Error claiming rewards:", error);
            throw error;
        }
    }

    // Start autonomous engine
    async startAutonomousEngine() {
        this.client.ensureInitialized();
        
        try {
            const args = new window.massa.Args();

            const result = await web3Client.smartContracts().callSmartContract(
                {
                    fee: 0n,
                    maxGas: CONFIG.GAS_LIMITS.AUTONOMOUS_ENGINE,
                    coins: massa.fromMAS("1"),
                    targetAddress: CONFIG.ADVANCED_DEFI_ADDRESS,
                    functionName: "startAutonomousEngine",
                    parameter: args.serialize(),
                },
                baseAccount
            );

            console.log("Autonomous engine start result:", result);
            return result;
        } catch (error) {
            console.error("Error starting autonomous engine:", error);
            throw error;
        }
    }

    // Stop autonomous engine
    async stopAutonomousEngine() {
        this.client.ensureInitialized();
        
        try {
            const args = new window.massa.Args();

            const result = await web3Client.smartContracts().callSmartContract(
                {
                    fee: 0n,
                    maxGas: CONFIG.GAS_LIMITS.AUTONOMOUS_ENGINE,
                    coins: massa.fromMAS("1"),
                    targetAddress: CONFIG.ADVANCED_DEFI_ADDRESS,
                    functionName: "stopAutonomousEngine",
                    parameter: args.serialize(),
                },
                baseAccount
            );

            console.log("Autonomous engine stop result:", result);
            return result;
        } catch (error) {
            console.error("Error stopping autonomous engine:", error);
            throw error;
        }
    }
}

// Utility Functions
class MassaSwapUtils {
    // Convert human-readable amount to contract units
    static toContractUnits(amount) {
        return BigInt(Math.floor(parseFloat(amount) * Number(ONE_UNIT)));
    }

    // Convert contract units to human-readable amount
    static fromContractUnits(amount) {
        return Number(amount) / Number(ONE_UNIT);
    }

    // Calculate slippage tolerance
    static calculateMinAmountOut(amountOut, slippagePercent) {
        const slippage = BigInt(Math.floor(slippagePercent * 100));
        return (amountOut * (10000n - slippage)) / 10000n;
    }

    // Get current timestamp in seconds
    static getCurrentTimestamp() {
        return Math.floor(Date.now() / 1000);
    }

    // Calculate expiry timestamp (current time + hours)
    static getExpiryTimestamp(hours) {
        return this.getCurrentTimestamp() + (hours * 3600);
    }

    // Format address for display
    static formatAddress(address, length = 8) {
        if (!address || address.length < length * 2) return address;
        return `${address.slice(0, length)}...${address.slice(-length)}`;
    }

    // Validate Massa address format
    static isValidMassaAddress(address) {
        return /^AS[1-9A-HJ-NP-Za-km-z]{48,50}$/.test(address);
    }
}

// Main MassaSwap SDK
class MassaSwapSDK {
    constructor(account) {
        this.client = new MassaSwapClient(account);
        this.dex = new MassaSwapDEX(this.client);
        this.advanced = new MassaSwapAdvanced(this.client);
        this.utils = MassaSwapUtils;
    }

    async initialize() {
        await this.client.initialize();
        console.log("MassaSwap SDK initialized successfully");
    }

    // Quick access methods for common operations
    async quickSwap(tokenIn, tokenOut, amountIn, slippagePercent = 1) {
        // This would need price calculation from the contract
        // For now, we'll use a simplified approach
        const minAmountOut = 0; // Should be calculated based on current price and slippage
        return await this.dex.swap(tokenIn, tokenOut, amountIn, minAmountOut);
    }

    async getBalances(userAddress = null) {
        const address = userAddress || baseAccount.address;
        
        const usdcBalance = await this.dex.getTokenBalance(CONFIG.USDC_ADDRESS, address);
        const wmasBalance = await this.dex.getTokenBalance(CONFIG.WMAS_ADDRESS, address);
        
        return {
            USDC: this.utils.fromContractUnits(usdcBalance),
            WMAS: this.utils.fromContractUnits(wmasBalance)
        };
    }
}

// Example usage and initialization
async function initializeMassaSwap() {
    // Example account - replace with your actual account
    const account = {
        address: "AU139TmwoP6w5mgUQrpF9s49VXeFGXmN1SiuX5HEtzcGmuJAoXFa",
        secretKey: "S124xpCaad7hPhvezhHp2sSxb56Dpi2oufcp2m2NtkdPjgxFXNon",
        publicKey: "P1zir4oncNbkuQFkZyU4TjfNzR5BotZzf4hGVE4pCNwCb6Z2Kjn",
    };

    const massaSwap = new MassaSwapSDK(account);
    await massaSwap.initialize();
    
    return massaSwap;
}

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        MassaSwapSDK,
        MassaSwapUtils,
        CONFIG,
        initializeMassaSwap
    };
}

// Global access for browser usage
if (typeof window !== 'undefined') {
    window.MassaSwapSDK = MassaSwapSDK;
    window.MassaSwapUtils = MassaSwapUtils;
    window.initializeMassaSwap = initializeMassaSwap;
}

// Example usage functions for testing
async function exampleUsage() {
    try {
        // Initialize the SDK
        const massaSwap = await initializeMassaSwap();
        
        // Get user balances
        const balances = await massaSwap.getBalances();
        console.log("User balances:", balances);
        
        // Perform a swap
        const swapAmount = massaSwap.utils.toContractUnits("100"); // 100 tokens
        await massaSwap.quickSwap(
            CONFIG.USDC_ADDRESS,
            CONFIG.WMAS_ADDRESS,
            swapAmount,
            1 // 1% slippage
        );
        
        // Create a DCA strategy
        await massaSwap.advanced.createDCAStrategy(
            CONFIG.USDC_ADDRESS,
            CONFIG.WMAS_ADDRESS,
            massaSwap.utils.toContractUnits("10"), // 10 USDC per period
            100, // Every 100 periods
            10, // For 10 periods total
            0 // No minimum amount out
        );
        
        // Start autonomous engine
        await massaSwap.advanced.startAutonomousEngine();
        
        console.log("Example operations completed successfully");
        
    } catch (error) {
        console.error("Error in example usage:", error);
    }
}

// Event listeners for UI integration
document.addEventListener('massaswap-event', (event) => {
    console.log('MassaSwap Event Received:', event.detail);
    // Handle UI updates based on contract events
});

console.log("MassaSwap JavaScript SDK loaded successfully");

// Start of work 



















