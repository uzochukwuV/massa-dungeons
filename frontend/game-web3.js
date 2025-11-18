/**
 * Massa Dungeons - Smart Contract Interaction Library
 *
 * This library provides helper functions for interacting with the Massa Dungeons
 * game smart contract and prediction market system.
 *
 * Features:
 * - Character management (create, read, equip, level up)
 * - Battle system (create, execute turns, read state)
 * - Prediction markets (create pools, place bets, claim winnings)
 * - Tournaments (create, register, manage)
 * - Leaderboards & Achievements
 * - Autonomous bot management
 */

// ============================================================================
// Configuration
// ============================================================================

const GAME_CONFIG = {
    // Update this with your deployed game contract address
    GAME_CONTRACT_ADDRESS: "AS1234567890...",

    PROVIDERS: [
        {
            url: "https://buildnet.massa.net/api/v2",
            type: window.massa?.ProviderType?.PUBLIC || 0,
        },
        {
            url: "https://testnet.massa.net/api/v2",
            type: window.massa?.ProviderType?.PUBLIC || 0,
        },
    ],

    // Gas limits for different operations
    GAS_LIMITS: {
        // Read operations (no state change)
        READ_OPERATION: 20_000_000n,

        // Character operations
        CREATE_CHARACTER: 200_000_000n,
        EQUIP_ITEM: 150_000_000n,
        LEVEL_UP: 150_000_000n,
        UNLOCK_SKILL: 150_000_000n,

        // Battle operations
        CREATE_BATTLE: 300_000_000n,
        EXECUTE_TURN: 250_000_000n,
        USE_ITEM: 200_000_000n,

        // Prediction market operations
        CREATE_POOL: 300_000_000n,
        PLACE_BET: 200_000_000n,
        SETTLE_POOL: 250_000_000n,
        CLAIM_WINNINGS: 200_000_000n,

        // Tournament operations
        CREATE_TOURNAMENT: 400_000_000n,
        REGISTER_TOURNAMENT: 200_000_000n,
        START_TOURNAMENT: 300_000_000n,

        // Autonomous bot operations
        START_BOT: 500_000_000n,
        STOP_BOT: 200_000_000n,
    },

    // Character classes
    CLASSES: {
        WARRIOR: 0,
        ASSASSIN: 1,
        MAGE: 2,
    },

    // Equipment slots
    SLOTS: {
        WEAPON: 0,
        ARMOR: 1,
        ACCESSORY: 2,
    },

    // Battle actions
    ACTIONS: {
        BASIC_ATTACK: 0,
        USE_SKILL: 1,
        USE_ITEM: 2,
        DEFEND: 3,
    },
};

const ONE_UNIT = BigInt(10 ** 9);

// ============================================================================
// Global Variables
// ============================================================================

let gameWeb3Client = undefined;
let gameBaseAccount = undefined;
let gameEventPoller = undefined;

// ============================================================================
// Utility Functions
// ============================================================================

class GameUtils {
    /**
     * Convert human-readable amount to contract units (9 decimals)
     */
    static toContractUnits(amount) {
        return BigInt(Math.floor(parseFloat(amount) * Number(ONE_UNIT)));
    }

    /**
     * Convert contract units to human-readable amount
     */
    static fromContractUnits(amount) {
        return Number(amount) / Number(ONE_UNIT);
    }

    /**
     * Get current timestamp in seconds
     */
    static getCurrentTimestamp() {
        return Math.floor(Date.now() / 1000);
    }

    /**
     * Format address for display
     */
    static formatAddress(address, length = 8) {
        if (!address || address.length < length * 2) return address;
        return `${address.slice(0, length)}...${address.slice(-length)}`;
    }

    /**
     * Validate Massa address format
     */
    static isValidMassaAddress(address) {
        return /^AS[1-9A-HJ-NP-Za-km-z]{48,50}$/.test(address);
    }

    /**
     * Get class name from class type
     */
    static getClassName(classType) {
        const classes = ['Warrior', 'Assassin', 'Mage'];
        return classes[classType] || 'Unknown';
    }

    /**
     * Get slot name from slot type
     */
    static getSlotName(slotType) {
        const slots = ['Weapon', 'Armor', 'Accessory'];
        return slots[slotType] || 'Unknown';
    }

    /**
     * Parse event data string
     */
    static parseEventData(eventString) {
        const parts = eventString.split('|');
        const result = { type: parts[0] };

        for (let i = 1; i < parts.length; i++) {
            const [key, value] = parts[i].split('=');
            if (key && value) {
                result[key] = value;
            }
        }

        return result;
    }
}

// ============================================================================
// Core Game Client
// ============================================================================

class MassaDungeonsClient {
    constructor(account) {
        this.account = account;
        this.isInitialized = false;
    }

    async initialize() {
        try {
            gameBaseAccount = this.account;

            // Create Web3 client
            const client = await massa.ClientFactory.createCustomClient(
                GAME_CONFIG.PROVIDERS,
                true,
                gameBaseAccount
            );

            // Get node status
            const status = await client.publicApi().getNodeStatus();
            console.log('Connected to Massa node:', status);

            gameWeb3Client = client;

            // Start event polling
            await this.startEventPolling(status.last_slot);

            this.isInitialized = true;
            console.log("Massa Dungeons client initialized successfully");

        } catch (error) {
            console.error("Failed to initialize Massa Dungeons client:", error);
            throw error;
        }
    }

    async startEventPolling(startSlot) {
        const eventsFilter = {
            start: startSlot,
            end: null,
            original_caller_address: null,
            original_operation_id: null,
            emitter_address: GAME_CONFIG.GAME_CONTRACT_ADDRESS,
        };

        gameEventPoller = window.massa.EventPoller.startEventsPolling(
            eventsFilter,
            1000,
            gameWeb3Client
        );

        gameEventPoller.on(window.massa.ON_MASSA_EVENT_DATA, this.onEventData);
        gameEventPoller.on(window.massa.ON_MASSA_EVENT_ERROR, this.onEventDataError);
    }

    onEventData(events) {
        for (const evt of events) {
            console.log("Game Event:", evt.data);

            // Dispatch custom events for UI updates
            const parsedEvent = GameUtils.parseEventData(evt.data);

            const customEvent = new CustomEvent("game-event", {
                detail: {
                    raw: evt.data,
                    parsed: parsedEvent,
                    timestamp: new Date().toISOString()
                }
            });
            document.dispatchEvent(customEvent);
        }
    }

    onEventDataError(error) {
        console.error("Event polling error:", error);
    }

    ensureInitialized() {
        if (!this.isInitialized || !gameWeb3Client) {
            throw new Error("Client not initialized. Call initialize() first.");
        }
    }
}

// ============================================================================
// Character Management
// ============================================================================

class CharacterManager {
    constructor(client) {
        this.client = client;
    }

    /**
     * Create a new character
     */
    async createCharacter(characterId, classType, name) {
        this.client.ensureInitialized();

        try {
            const args = new window.massa.Args();
            args.addString(characterId);
            args.addU8(classType);
            args.addString(name);

            const result = await gameWeb3Client.smartContracts().callSmartContract(
                {
                    fee: 100000000n,
                    maxGas: GAME_CONFIG.GAS_LIMITS.CREATE_CHARACTER,
                    coins: massa.fromMAS("0.1"),
                    targetAddress: GAME_CONFIG.GAME_CONTRACT_ADDRESS,
                    functionName: "game_createCharacter",
                    parameter: args.serialize(),
                },
                gameBaseAccount
            );

            console.log("Character created:", result);
            return result;
        } catch (error) {
            console.error("Error creating character:", error);
            throw error;
        }
    }

    /**
     * Read character data
     */
    async readCharacter(characterId) {
        this.client.ensureInitialized();

        try {
            const args = new window.massa.Args();
            args.addString(characterId);

            const result = await gameWeb3Client.smartContracts().readSmartContract({
                fee: 0n,
                callerAddress: gameBaseAccount.address,
                maxGas: GAME_CONFIG.GAS_LIMITS.READ_OPERATION,
                coins: 0n,
                targetAddress: GAME_CONFIG.GAME_CONTRACT_ADDRESS,
                targetFunction: "game_readCharacter",
                parameter: args.serialize(),
            });

            // Deserialize character data
            const resultArgs = new window.massa.Args(result.returnValue);

            const character = {
                owner: resultArgs.nextString(),
                name: resultArgs.nextString(),
                classType: resultArgs.nextU8(),
                level: resultArgs.nextU32(),
                experience: resultArgs.nextU64(),
                baseHp: resultArgs.nextU32(),
                baseAttack: resultArgs.nextU32(),
                baseDefense: resultArgs.nextU32(),
                critChance: resultArgs.nextU32(),
                critMultiplier: resultArgs.nextU32(),
                evasion: resultArgs.nextU32(),
            };

            return character;
        } catch (error) {
            console.error("Error reading character:", error);
            throw error;
        }
    }

    /**
     * Equip item to character
     */
    async equipItem(characterId, itemId, slotType) {
        this.client.ensureInitialized();

        try {
            const args = new window.massa.Args();
            args.addString(characterId);
            args.addString(itemId);
            args.addU8(slotType);

            const result = await gameWeb3Client.smartContracts().callSmartContract(
                {
                    fee: 100000000n,
                    maxGas: GAME_CONFIG.GAS_LIMITS.EQUIP_ITEM,
                    coins: massa.fromMAS("0.1"),
                    targetAddress: GAME_CONFIG.GAME_CONTRACT_ADDRESS,
                    functionName: "game_equipItem",
                    parameter: args.serialize(),
                },
                gameBaseAccount
            );

            console.log("Item equipped:", result);
            return result;
        } catch (error) {
            console.error("Error equipping item:", error);
            throw error;
        }
    }

    /**
     * Level up character
     */
    async levelUp(characterId) {
        this.client.ensureInitialized();

        try {
            const args = new window.massa.Args();
            args.addString(characterId);

            const result = await gameWeb3Client.smartContracts().callSmartContract(
                {
                    fee: 100000000n,
                    maxGas: GAME_CONFIG.GAS_LIMITS.LEVEL_UP,
                    coins: massa.fromMAS("0.1"),
                    targetAddress: GAME_CONFIG.GAME_CONTRACT_ADDRESS,
                    functionName: "game_levelUp",
                    parameter: args.serialize(),
                },
                gameBaseAccount
            );

            console.log("Character leveled up:", result);
            return result;
        } catch (error) {
            console.error("Error leveling up character:", error);
            throw error;
        }
    }

    /**
     * Unlock skill for character
     */
    async unlockSkill(characterId, skillId) {
        this.client.ensureInitialized();

        try {
            const args = new window.massa.Args();
            args.addString(characterId);
            args.addString(skillId);

            const result = await gameWeb3Client.smartContracts().callSmartContract(
                {
                    fee: 100000000n,
                    maxGas: GAME_CONFIG.GAS_LIMITS.UNLOCK_SKILL,
                    coins: massa.fromMAS("0.1"),
                    targetAddress: GAME_CONFIG.GAME_CONTRACT_ADDRESS,
                    functionName: "game_unlockSkill",
                    parameter: args.serialize(),
                },
                gameBaseAccount
            );

            console.log("Skill unlocked:", result);
            return result;
        } catch (error) {
            console.error("Error unlocking skill:", error);
            throw error;
        }
    }

    /**
     * Get character count
     */
    async getCharacterCount() {
        this.client.ensureInitialized();

        try {
            const args = new window.massa.Args();

            const result = await gameWeb3Client.smartContracts().readSmartContract({
                fee: 0n,
                callerAddress: gameBaseAccount.address,
                maxGas: GAME_CONFIG.GAS_LIMITS.READ_OPERATION,
                coins: 0n,
                targetAddress: GAME_CONFIG.GAME_CONTRACT_ADDRESS,
                targetFunction: "game_readCharacterCount",
                parameter: args.serialize(),
            });

            const count = new window.massa.Args(result.returnValue).nextU64();
            return count;
        } catch (error) {
            console.error("Error getting character count:", error);
            throw error;
        }
    }
}

// ============================================================================
// Battle System
// ============================================================================

class BattleManager {
    constructor(client) {
        this.client = client;
    }

    /**
     * Create a new battle
     */
    async createBattle(battleId, player1CharId, player2CharId) {
        this.client.ensureInitialized();

        try {
            const args = new window.massa.Args();
            args.addString(battleId);
            args.addString(player1CharId);
            args.addString(player2CharId);
            args.addU64(BigInt(Date.now()));

            const result = await gameWeb3Client.smartContracts().callSmartContract(
                {
                    fee: 100000000n,
                    maxGas: GAME_CONFIG.GAS_LIMITS.CREATE_BATTLE,
                    coins: massa.fromMAS("0.1"),
                    targetAddress: GAME_CONFIG.GAME_CONTRACT_ADDRESS,
                    functionName: "game_createBattle",
                    parameter: args.serialize(),
                },
                gameBaseAccount
            );

            console.log("Battle created:", result);
            return result;
        } catch (error) {
            console.error("Error creating battle:", error);
            throw error;
        }
    }

    /**
     * Execute a turn in battle
     */
    async executeTurn(battleId, action, skillId = "", itemId = "") {
        this.client.ensureInitialized();

        try {
            const args = new window.massa.Args();
            args.addString(battleId);
            args.addU8(action);

            if (action === GAME_CONFIG.ACTIONS.USE_SKILL) {
                args.addString(skillId);
            } else if (action === GAME_CONFIG.ACTIONS.USE_ITEM) {
                args.addString(itemId);
            }

            const result = await gameWeb3Client.smartContracts().callSmartContract(
                {
                    fee: 100000000n,
                    maxGas: GAME_CONFIG.GAS_LIMITS.EXECUTE_TURN,
                    coins: massa.fromMAS("0.1"),
                    targetAddress: GAME_CONFIG.GAME_CONTRACT_ADDRESS,
                    functionName: "game_executeTurn",
                    parameter: args.serialize(),
                },
                gameBaseAccount
            );

            console.log("Turn executed:", result);
            return result;
        } catch (error) {
            console.error("Error executing turn:", error);
            throw error;
        }
    }

    /**
     * Read battle state
     */
    async readBattle(battleId) {
        this.client.ensureInitialized();

        try {
            const args = new window.massa.Args();
            args.addString(battleId);

            const result = await gameWeb3Client.smartContracts().readSmartContract({
                fee: 0n,
                callerAddress: gameBaseAccount.address,
                maxGas: GAME_CONFIG.GAS_LIMITS.READ_OPERATION,
                coins: 0n,
                targetAddress: GAME_CONFIG.GAME_CONTRACT_ADDRESS,
                targetFunction: "game_readBattle",
                parameter: args.serialize(),
            });

            // Deserialize battle data
            const resultArgs = new window.massa.Args(result.returnValue);

            const battle = {
                player1Char: resultArgs.nextString(),
                player2Char: resultArgs.nextString(),
                player1Owner: resultArgs.nextString(),
                player2Owner: resultArgs.nextString(),
                startTs: resultArgs.nextU64(),
                createdAt: resultArgs.nextU64(),
                turnNumber: resultArgs.nextU32(),
                currentTurn: resultArgs.nextU8(),
                isFinished: resultArgs.nextBool(),
                winner: resultArgs.nextU8(),
                player1Hp: resultArgs.nextU32(),
                player2Hp: resultArgs.nextU32(),
                player1MaxHp: resultArgs.nextU32(),
                player2MaxHp: resultArgs.nextU32(),
            };

            return battle;
        } catch (error) {
            console.error("Error reading battle:", error);
            throw error;
        }
    }

    /**
     * Get battle statistics
     */
    async getStats() {
        this.client.ensureInitialized();

        try {
            const args = new window.massa.Args();

            const result = await gameWeb3Client.smartContracts().readSmartContract({
                fee: 0n,
                callerAddress: gameBaseAccount.address,
                maxGas: GAME_CONFIG.GAS_LIMITS.READ_OPERATION,
                coins: 0n,
                targetAddress: GAME_CONFIG.GAME_CONTRACT_ADDRESS,
                targetFunction: "game_getStats",
                parameter: args.serialize(),
            });

            const resultArgs = new window.massa.Args(result.returnValue);

            const stats = {
                totalCharacters: resultArgs.nextU64(),
                totalBattles: resultArgs.nextU64(),
                totalFinished: resultArgs.nextU64(),
            };

            return stats;
        } catch (error) {
            console.error("Error getting stats:", error);
            throw error;
        }
    }
}

// ============================================================================
// Prediction Markets
// ============================================================================

class PredictionMarketManager {
    constructor(client) {
        this.client = client;
    }

    /**
     * Create a prediction pool
     */
    async createPool(poolId, battleId, description, outcomeA, outcomeB) {
        this.client.ensureInitialized();

        try {
            const args = new window.massa.Args();
            args.addString(poolId);
            args.addString(battleId);
            args.addString(description);
            args.addString(outcomeA);
            args.addString(outcomeB);

            const result = await gameWeb3Client.smartContracts().callSmartContract(
                {
                    fee: 100000000n,
                    maxGas: GAME_CONFIG.GAS_LIMITS.CREATE_POOL,
                    coins: massa.fromMAS("0.1"),
                    targetAddress: GAME_CONFIG.GAME_CONTRACT_ADDRESS,
                    functionName: "game_createPredictionPool",
                    parameter: args.serialize(),
                },
                gameBaseAccount
            );

            console.log("Prediction pool created:", result);
            return result;
        } catch (error) {
            console.error("Error creating prediction pool:", error);
            throw error;
        }
    }

    /**
     * Place a bet on a prediction pool
     */
    async placeBet(poolId, outcome, amount) {
        this.client.ensureInitialized();

        try {
            const args = new window.massa.Args();
            args.addString(poolId);
            args.addU8(outcome);
            args.addU64(GameUtils.toContractUnits(amount));

            const result = await gameWeb3Client.smartContracts().callSmartContract(
                {
                    fee: 100000000n,
                    maxGas: GAME_CONFIG.GAS_LIMITS.PLACE_BET,
                    coins: massa.fromMAS("0.1"),
                    targetAddress: GAME_CONFIG.GAME_CONTRACT_ADDRESS,
                    functionName: "game_placeBet",
                    parameter: args.serialize(),
                },
                gameBaseAccount
            );

            console.log("Bet placed:", result);
            return result;
        } catch (error) {
            console.error("Error placing bet:", error);
            throw error;
        }
    }

    /**
     * Claim winnings from a prediction pool
     */
    async claimWinnings(poolId) {
        this.client.ensureInitialized();

        try {
            const args = new window.massa.Args();
            args.addString(poolId);

            const result = await gameWeb3Client.smartContracts().callSmartContract(
                {
                    fee: 100000000n,
                    maxGas: GAME_CONFIG.GAS_LIMITS.CLAIM_WINNINGS,
                    coins: massa.fromMAS("0.1"),
                    targetAddress: GAME_CONFIG.GAME_CONTRACT_ADDRESS,
                    functionName: "game_claimWinnings",
                    parameter: args.serialize(),
                },
                gameBaseAccount
            );

            console.log("Winnings claimed:", result);
            return result;
        } catch (error) {
            console.error("Error claiming winnings:", error);
            throw error;
        }
    }

    /**
     * Read prediction pool data
     */
    async readPool(poolId) {
        this.client.ensureInitialized();

        try {
            const args = new window.massa.Args();
            args.addString(poolId);

            const result = await gameWeb3Client.smartContracts().readSmartContract({
                fee: 0n,
                callerAddress: gameBaseAccount.address,
                maxGas: GAME_CONFIG.GAS_LIMITS.READ_OPERATION,
                coins: 0n,
                targetAddress: GAME_CONFIG.GAME_CONTRACT_ADDRESS,
                targetFunction: "game_readPredictionPool",
                parameter: args.serialize(),
            });

            const resultArgs = new window.massa.Args(result.returnValue);

            const pool = {
                battleId: resultArgs.nextString(),
                description: resultArgs.nextString(),
                outcomeA: resultArgs.nextString(),
                outcomeB: resultArgs.nextString(),
                isSettled: resultArgs.nextBool(),
                winningOutcome: resultArgs.nextU8(),
                totalBetsA: resultArgs.nextU64(),
                totalBetsB: resultArgs.nextU64(),
            };

            return pool;
        } catch (error) {
            console.error("Error reading pool:", error);
            throw error;
        }
    }

    /**
     * Get user's bet in a pool
     */
    async getUserBet(poolId, userAddress) {
        this.client.ensureInitialized();

        try {
            const args = new window.massa.Args();
            args.addString(poolId);
            args.addString(userAddress);

            const result = await gameWeb3Client.smartContracts().readSmartContract({
                fee: 0n,
                callerAddress: gameBaseAccount.address,
                maxGas: GAME_CONFIG.GAS_LIMITS.READ_OPERATION,
                coins: 0n,
                targetAddress: GAME_CONFIG.GAME_CONTRACT_ADDRESS,
                targetFunction: "game_readUserBet",
                parameter: args.serialize(),
            });

            const resultArgs = new window.massa.Args(result.returnValue);

            const bet = {
                outcome: resultArgs.nextU8(),
                amount: resultArgs.nextU64(),
                claimed: resultArgs.nextBool(),
            };

            return bet;
        } catch (error) {
            console.error("Error reading user bet:", error);
            throw error;
        }
    }

    /**
     * Get prediction pool count
     */
    async getPoolCount() {
        this.client.ensureInitialized();

        try {
            const args = new window.massa.Args();

            const result = await gameWeb3Client.smartContracts().readSmartContract({
                fee: 0n,
                callerAddress: gameBaseAccount.address,
                maxGas: GAME_CONFIG.GAS_LIMITS.READ_OPERATION,
                coins: 0n,
                targetAddress: GAME_CONFIG.GAME_CONTRACT_ADDRESS,
                targetFunction: "game_readPredictionPoolCount",
                parameter: args.serialize(),
            });

            const count = new window.massa.Args(result.returnValue).nextU64();
            return count;
        } catch (error) {
            console.error("Error getting pool count:", error);
            throw error;
        }
    }
}

// ============================================================================
// Tournament System
// ============================================================================

class TournamentManager {
    constructor(client) {
        this.client = client;
    }

    /**
     * Create a tournament
     */
    async createTournament(tournamentId, name, maxParticipants, entryFee, prizePool) {
        this.client.ensureInitialized();

        try {
            const args = new window.massa.Args();
            args.addString(tournamentId);
            args.addString(name);
            args.addU8(maxParticipants);
            args.addU64(GameUtils.toContractUnits(entryFee));
            args.addU64(GameUtils.toContractUnits(prizePool));

            const result = await gameWeb3Client.smartContracts().callSmartContract(
                {
                    fee: 100000000n,
                    maxGas: GAME_CONFIG.GAS_LIMITS.CREATE_TOURNAMENT,
                    coins: massa.fromMAS("0.1"),
                    targetAddress: GAME_CONFIG.GAME_CONTRACT_ADDRESS,
                    functionName: "game_createTournament",
                    parameter: args.serialize(),
                },
                gameBaseAccount
            );

            console.log("Tournament created:", result);
            return result;
        } catch (error) {
            console.error("Error creating tournament:", error);
            throw error;
        }
    }

    /**
     * Register for a tournament
     */
    async registerForTournament(tournamentId, characterId) {
        this.client.ensureInitialized();

        try {
            const args = new window.massa.Args();
            args.addString(tournamentId);
            args.addString(characterId);

            const result = await gameWeb3Client.smartContracts().callSmartContract(
                {
                    fee: 100000000n,
                    maxGas: GAME_CONFIG.GAS_LIMITS.REGISTER_TOURNAMENT,
                    coins: massa.fromMAS("0.1"),
                    targetAddress: GAME_CONFIG.GAME_CONTRACT_ADDRESS,
                    functionName: "game_registerForTournament",
                    parameter: args.serialize(),
                },
                gameBaseAccount
            );

            console.log("Registered for tournament:", result);
            return result;
        } catch (error) {
            console.error("Error registering for tournament:", error);
            throw error;
        }
    }

    /**
     * Read tournament data
     */
    async readTournament(tournamentId) {
        this.client.ensureInitialized();

        try {
            const args = new window.massa.Args();
            args.addString(tournamentId);

            const result = await gameWeb3Client.smartContracts().readSmartContract({
                fee: 0n,
                callerAddress: gameBaseAccount.address,
                maxGas: GAME_CONFIG.GAS_LIMITS.READ_OPERATION,
                coins: 0n,
                targetAddress: GAME_CONFIG.GAME_CONTRACT_ADDRESS,
                targetFunction: "game_readTournament",
                parameter: args.serialize(),
            });

            const resultArgs = new window.massa.Args(result.returnValue);

            const tournament = {
                name: resultArgs.nextString(),
                maxParticipants: resultArgs.nextU8(),
                currentRound: resultArgs.nextU32(),
                isFinished: resultArgs.nextBool(),
                winner: resultArgs.nextString(),
                entryFee: resultArgs.nextU64(),
                prizePool: resultArgs.nextU64(),
            };

            return tournament;
        } catch (error) {
            console.error("Error reading tournament:", error);
            throw error;
        }
    }

    /**
     * Get tournament count
     */
    async getTournamentCount() {
        this.client.ensureInitialized();

        try {
            const args = new window.massa.Args();

            const result = await gameWeb3Client.smartContracts().readSmartContract({
                fee: 0n,
                callerAddress: gameBaseAccount.address,
                maxGas: GAME_CONFIG.GAS_LIMITS.READ_OPERATION,
                coins: 0n,
                targetAddress: GAME_CONFIG.GAME_CONTRACT_ADDRESS,
                targetFunction: "game_readTournamentCount",
                parameter: args.serialize(),
            });

            const count = new window.massa.Args(result.returnValue).nextU64();
            return count;
        } catch (error) {
            console.error("Error getting tournament count:", error);
            throw error;
        }
    }
}

// ============================================================================
// Autonomous Bot Management
// ============================================================================

class BotManager {
    constructor(client) {
        this.client = client;
    }

    /**
     * Start battle bot
     */
    async startBattleBot(maxIterations = 1000) {
        this.client.ensureInitialized();

        try {
            const args = new window.massa.Args();
            args.addU64(BigInt(maxIterations));

            const result = await gameWeb3Client.smartContracts().callSmartContract(
                {
                    fee: 100000000n,
                    maxGas: GAME_CONFIG.GAS_LIMITS.START_BOT,
                    coins: massa.fromMAS("1.0"),
                    targetAddress: GAME_CONFIG.GAME_CONTRACT_ADDRESS,
                    functionName: "startBattleBot",
                    parameter: args.serialize(),
                },
                gameBaseAccount
            );

            console.log("Battle bot started:", result);
            return result;
        } catch (error) {
            console.error("Error starting battle bot:", error);
            throw error;
        }
    }

    /**
     * Stop battle bot
     */
    async stopBattleBot() {
        this.client.ensureInitialized();

        try {
            const args = new window.massa.Args();

            const result = await gameWeb3Client.smartContracts().callSmartContract(
                {
                    fee: 100000000n,
                    maxGas: GAME_CONFIG.GAS_LIMITS.STOP_BOT,
                    coins: massa.fromMAS("0.1"),
                    targetAddress: GAME_CONFIG.GAME_CONTRACT_ADDRESS,
                    functionName: "stopBattleBot",
                    parameter: args.serialize(),
                },
                gameBaseAccount
            );

            console.log("Battle bot stopped:", result);
            return result;
        } catch (error) {
            console.error("Error stopping battle bot:", error);
            throw error;
        }
    }

    /**
     * Start tournament bot
     */
    async startTournamentBot(maxIterations = 1000) {
        this.client.ensureInitialized();

        try {
            const args = new window.massa.Args();
            args.addU64(BigInt(maxIterations));

            const result = await gameWeb3Client.smartContracts().callSmartContract(
                {
                    fee: 100000000n,
                    maxGas: GAME_CONFIG.GAS_LIMITS.START_BOT,
                    coins: massa.fromMAS("1.0"),
                    targetAddress: GAME_CONFIG.GAME_CONTRACT_ADDRESS,
                    functionName: "startTournamentBot",
                    parameter: args.serialize(),
                },
                gameBaseAccount
            );

            console.log("Tournament bot started:", result);
            return result;
        } catch (error) {
            console.error("Error starting tournament bot:", error);
            throw error;
        }
    }

    /**
     * Stop tournament bot
     */
    async stopTournamentBot() {
        this.client.ensureInitialized();

        try {
            const args = new window.massa.Args();

            const result = await gameWeb3Client.smartContracts().callSmartContract(
                {
                    fee: 100000000n,
                    maxGas: GAME_CONFIG.GAS_LIMITS.STOP_BOT,
                    coins: massa.fromMAS("0.1"),
                    targetAddress: GAME_CONFIG.GAME_CONTRACT_ADDRESS,
                    functionName: "stopTournamentBot",
                    parameter: args.serialize(),
                },
                gameBaseAccount
            );

            console.log("Tournament bot stopped:", result);
            return result;
        } catch (error) {
            console.error("Error stopping tournament bot:", error);
            throw error;
        }
    }

    /**
     * Start prediction bot
     */
    async startPredictionBot(maxIterations = 1000) {
        this.client.ensureInitialized();

        try {
            const args = new window.massa.Args();
            args.addU64(BigInt(maxIterations));

            const result = await gameWeb3Client.smartContracts().callSmartContract(
                {
                    fee: 100000000n,
                    maxGas: GAME_CONFIG.GAS_LIMITS.START_BOT,
                    coins: massa.fromMAS("1.0"),
                    targetAddress: GAME_CONFIG.GAME_CONTRACT_ADDRESS,
                    functionName: "startPredictionBot",
                    parameter: args.serialize(),
                },
                gameBaseAccount
            );

            console.log("Prediction bot started:", result);
            return result;
        } catch (error) {
            console.error("Error starting prediction bot:", error);
            throw error;
        }
    }

    /**
     * Stop prediction bot
     */
    async stopPredictionBot() {
        this.client.ensureInitialized();

        try {
            const args = new window.massa.Args();

            const result = await gameWeb3Client.smartContracts().callSmartContract(
                {
                    fee: 100000000n,
                    maxGas: GAME_CONFIG.GAS_LIMITS.STOP_BOT,
                    coins: massa.fromMAS("0.1"),
                    targetAddress: GAME_CONFIG.GAME_CONTRACT_ADDRESS,
                    functionName: "stopPredictionBot",
                    parameter: args.serialize(),
                },
                gameBaseAccount
            );

            console.log("Prediction bot stopped:", result);
            return result;
        } catch (error) {
            console.error("Error stopping prediction bot:", error);
            throw error;
        }
    }
}

// ============================================================================
// Main SDK Class
// ============================================================================

class MassaDungeonsSDK {
    constructor(account) {
        this.client = new MassaDungeonsClient(account);
        this.characters = new CharacterManager(this.client);
        this.battles = new BattleManager(this.client);
        this.predictions = new PredictionMarketManager(this.client);
        this.tournaments = new TournamentManager(this.client);
        this.bots = new BotManager(this.client);
        this.utils = GameUtils;
    }

    async initialize() {
        await this.client.initialize();
        console.log("Massa Dungeons SDK initialized successfully");
    }

    /**
     * Update game contract address
     */
    setContractAddress(address) {
        if (!GameUtils.isValidMassaAddress(address)) {
            throw new Error("Invalid Massa contract address");
        }
        GAME_CONFIG.GAME_CONTRACT_ADDRESS = address;
        console.log("Game contract address updated:", address);
    }

    /**
     * Get current configuration
     */
    getConfig() {
        return { ...GAME_CONFIG };
    }
}

// ============================================================================
// Initialization Helper
// ============================================================================

async function initializeMassaDungeons(secretKey, contractAddress) {
    try {
        // Create account from secret key
        const account = await massa.WalletClient.getAccountFromSecretKey(secretKey);
        console.log("Account initialized:", account.address);

        // Create SDK instance
        const sdk = new MassaDungeonsSDK(account);

        // Set contract address if provided
        if (contractAddress) {
            sdk.setContractAddress(contractAddress);
        }

        // Initialize the SDK
        await sdk.initialize();

        return sdk;

    } catch (error) {
        console.error("Failed to initialize Massa Dungeons:", error);
        throw error;
    }
}

// ============================================================================
// Browser Exports
// ============================================================================

if (typeof window !== 'undefined') {
    window.MassaDungeonsSDK = MassaDungeonsSDK;
    window.GameUtils = GameUtils;
    window.GAME_CONFIG = GAME_CONFIG;
    window.initializeMassaDungeons = initializeMassaDungeons;
}

// ============================================================================
// Node.js Exports
// ============================================================================

if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        MassaDungeonsSDK,
        GameUtils,
        GAME_CONFIG,
        initializeMassaDungeons
    };
}

console.log("Massa Dungeons Web3 SDK loaded successfully");
