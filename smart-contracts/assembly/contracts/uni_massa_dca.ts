import {
    Address,
    Context,
    generateEvent,
    Storage,
} from "@massalabs/massa-as-sdk";
import { Args } from "@massalabs/as-types";
import { IERC20 } from "../interfaces";
import {
    ONE_UNIT,
    Pool,
    LimitOrder,
    ArbitrageOpportunity,
    callNextSlot,
    getPool,
    savePool,
    getAmountOut,
    getAmountIn,
    detectArbitrage,
    updatePrice,
    getPrice,
    getAllPoolKeys
} from "./uni_massa";

// DCA (Dollar Cost Averaging) structure
export class DCAStrategy {
    id: u64;
    user: Address;
    tokenIn: Address;
    tokenOut: Address;
    amountPerPeriod: u64;
    intervalPeriods: u64;
    totalPeriods: u64;
    currentPeriod: u64;
    lastExecution: u64;
    isActive: bool;
    minAmountOut: u64;

    constructor(
        id: u64,
        user: Address,
        tokenIn: Address,
        tokenOut: Address,
        amountPerPeriod: u64,
        intervalPeriods: u64,
        totalPeriods: u64,
        minAmountOut: u64 = 0
    ) {
        this.id = id;
        this.user = user;
        this.tokenIn = tokenIn;
        this.tokenOut = tokenOut;
        this.amountPerPeriod = amountPerPeriod;
        this.intervalPeriods = intervalPeriods;
        this.totalPeriods = totalPeriods;
        this.currentPeriod = 0;
        this.lastExecution = 0;
        this.isActive = true;
        this.minAmountOut = minAmountOut;
    }

    serialize(): StaticArray<u8> {
        const args = new Args();
        args.add(this.id);
        args.add(this.user.toString());
        args.add(this.tokenIn.toString());
        args.add(this.tokenOut.toString());
        args.add(this.amountPerPeriod);
        args.add(this.intervalPeriods);
        args.add(this.totalPeriods);
        args.add(this.currentPeriod);
        args.add(this.lastExecution);
        args.add(this.isActive);
        args.add(this.minAmountOut);
        return args.serialize();
    }

    static deserialize(data: StaticArray<u8>): DCAStrategy {
        const args = new Args(data);
        const strategy = new DCAStrategy(
            args.nextU64().unwrap(),
            new Address(args.nextString().unwrap()),
            new Address(args.nextString().unwrap()),
            new Address(args.nextString().unwrap()),
            args.nextU64().unwrap(),
            args.nextU64().unwrap(),
            args.nextU64().unwrap(),
            args.nextU64().unwrap()
        );
        strategy.currentPeriod = args.nextU64().unwrap();
        strategy.lastExecution = args.nextU64().unwrap();
        strategy.isActive = args.nextBool().unwrap();
        strategy.minAmountOut = args.nextU64().unwrap();
        return strategy;
    }
}

// Yield farming pool structure
export class YieldPool {
    id: u64;
    tokenA: Address;
    tokenB: Address;
    rewardToken: Address;
    totalStaked: u64;
    rewardRate: u64; // rewards per period
    lastUpdateTime: u64;
    rewardPerTokenStored: u64;
    isActive: bool;

    constructor(
        id: u64,
        tokenA: Address,
        tokenB: Address,
        rewardToken: Address,
        rewardRate: u64
    ) {
        this.id = id;
        this.tokenA = tokenA;
        this.tokenB = tokenB;
        this.rewardToken = rewardToken;
        this.totalStaked = 0;
        this.rewardRate = rewardRate;
        this.lastUpdateTime = Context.timestamp();
        this.rewardPerTokenStored = 0;
        this.isActive = true;
    }

    serialize(): StaticArray<u8> {
        const args = new Args();
        args.add(this.id);
        args.add(this.tokenA.toString());
        args.add(this.tokenB.toString());
        args.add(this.rewardToken.toString());
        args.add(this.totalStaked);
        args.add(this.rewardRate);
        args.add(this.lastUpdateTime);
        args.add(this.rewardPerTokenStored);
        args.add(this.isActive);
        return args.serialize();
    }

    static deserialize(data: StaticArray<u8>): YieldPool {
        const args = new Args(data);
        const pool = new YieldPool(
            args.nextU64().unwrap(),
            new Address(args.nextString().unwrap()),
            new Address(args.nextString().unwrap()),
            new Address(args.nextString().unwrap()),
            args.nextU64().unwrap()
        );
        pool.totalStaked = args.nextU64().unwrap();
        pool.rewardRate = args.nextU64().unwrap();
        pool.lastUpdateTime = args.nextU64().unwrap();
        pool.rewardPerTokenStored = args.nextU64().unwrap();
        pool.isActive = args.nextBool().unwrap();
        return pool;
    }
}

// Autonomous functions
export function startAutonomousEngine(_: StaticArray<u8>): void {
    Storage.set("autonomous_active", "true");
    Storage.set("last_arbitrage_check", Context.timestamp().toString());
    Storage.set("last_limit_order_check", Context.timestamp().toString());
    Storage.set("last_dca_check", Context.timestamp().toString());
    Storage.set("last_yield_update", Context.timestamp().toString());
    
    generateEvent("MassaSwap: Autonomous engine started");
    
    // Schedule first autonomous cycle
    callNextSlot(Context.callee(), "autonomousCycle", 800_000_000);
}

export function stopAutonomousEngine(_: StaticArray<u8>): void {
    Storage.set("autonomous_active", "false");
    generateEvent("MassaSwap: Autonomous engine stopped");
}

export function autonomousCycle(_: StaticArray<u8>): void {
    const isActive = Storage.has("autonomous_active") && Storage.get("autonomous_active") == "true";
    
    if (!isActive) {
        return;
    }
    
    const currentTime = Context.timestamp();
    
    // Check and execute arbitrage opportunities
    checkArbitrageOpportunities();
    
    // Process limit orders
    processLimitOrders();
    
    // Execute DCA strategies
    executeDCAStrategies();
    
    // Update yield farming rewards
    updateYieldFarmingRewards();
    
    // Auto-adjust fees based on volatility
    autoAdjustFees();
    
    // Schedule next cycle
    callNextSlot(Context.callee(), "autonomousCycle", 800_000_000);
}

export function checkArbitrageOpportunities(): void {
    const opportunities = detectArbitrage();
    
    for (let i = 0; i < opportunities.length; i++) {
        const opportunity = opportunities[i];
        
        // Only execute if profit is above threshold
        if (opportunity.profit > 100 * ONE_UNIT) {
            executeArbitrage(opportunity);
        }
    }
}

export function executeArbitrage(opportunity: ArbitrageOpportunity): void {
    const pool1 = opportunity.pool1;
    const pool2 = opportunity.pool2;
    
    // Calculate optimal trade size
    const tradeAmount = calculateOptimalArbitrageAmount(pool1, pool2);
    
    if (tradeAmount > 0) {
        // Execute the arbitrage trade
        performArbitrageTrade(pool1, pool2, tradeAmount);
        
        // Distribute profits to liquidity providers
        distributeArbitrageProfits(pool1, pool2, opportunity.profit);
        
        generateEvent(`MassaSwap: Arbitrage executed - Profit: ${opportunity.profit}`);
    }
}

export function calculateOptimalArbitrageAmount(pool1: Pool, pool2: Pool): u64 {
    // Simplified calculation - in practice, this would use more complex optimization
    const minReserve = pool1.reserveA < pool2.reserveA ? pool1.reserveA : pool2.reserveA;
    return minReserve / 100; // Trade 1% of the smaller reserve
}

export function performArbitrageTrade(pool1: Pool, pool2: Pool, amount: u64): void {
    // Execute trades on both pools
    const tokenAContract = new IERC20(pool1.tokenA);
    const tokenBContract = new IERC20(pool1.tokenB);
    
    // Trade on pool1
    const amountOut1 = getAmountOut(amount, pool1.reserveA, pool1.reserveB, pool1.fee);
    pool1.reserveA += amount;
    pool1.reserveB -= amountOut1;
    
    // Trade on pool2 (reverse direction)
    const amountOut2 = getAmountOut(amountOut1, pool2.reserveB, pool2.reserveA, pool2.fee);
    pool2.reserveB += amountOut1;
    pool2.reserveA -= amountOut2;
    
    // Update pools
    savePool(pool1);
    savePool(pool2);
}

export function distributeArbitrageProfits(pool1: Pool, pool2: Pool, profit: u64): void {
    // Distribute 80% of profits to LPs, 20% to protocol
    const lpShare = (profit * 80) / 100;
    const protocolShare = (profit * 20) / 100;
    
    // Add LP rewards to pool reserves
    pool1.reserveA += lpShare / 2;
    pool1.reserveB += lpShare / 2;
    
    // Update protocol treasury
    const currentTreasury = u64(parseInt(Storage.has("treasury_balance") ? Storage.get("treasury_balance") : "0"));
    Storage.set("treasury_balance", (currentTreasury + protocolShare).toString());
    
    savePool(pool1);
}

export function processLimitOrders(): void {
    const orderCount = u64(parseInt(Storage.has("order_count") ? Storage.get("order_count") : "0"));
    const currentTime = Context.timestamp();
    
    for (let i: u64 = 0; i < orderCount; i++) {
        const orderKey = "order:" + i.toString();
        
        if (!Storage.has(orderKey)) continue;
        
        const order = LimitOrder.deserialize(Storage.get(orderKey));
        
        if (!order.isActive || order.expiry < currentTime) {
            continue;
        }
        
        // Check if order can be executed
        const pool = getPool(order.tokenIn, order.tokenOut);
        if (pool == null) continue;
        
        const tokenInIsA = pool.tokenA.toString() == order.tokenIn.toString();
        const reserveIn = tokenInIsA ? pool.reserveA : pool.reserveB;
        const reserveOut = tokenInIsA ? pool.reserveB : pool.reserveA;
        
        const amountOut = getAmountOut(order.amountIn, reserveIn, reserveOut, pool.fee);
        
        if (amountOut >= order.minAmountOut) {
            executeLimitOrder(order, pool);
        }
    }
}

export function executeLimitOrder(order: LimitOrder, pool: Pool): void {
    const tokenInContract = new IERC20(order.tokenIn);
    const tokenOutContract = new IERC20(order.tokenOut);
    
    // Execute the trade
    const tokenInIsA = pool.tokenA.toString() == order.tokenIn.toString();
    const reserveIn = tokenInIsA ? pool.reserveA : pool.reserveB;
    const reserveOut = tokenInIsA ? pool.reserveB : pool.reserveA;
    
    const amountOut = getAmountOut(order.amountIn, reserveIn, reserveOut, pool.fee);
    
    // Update pool reserves
    if (tokenInIsA) {
        pool.reserveA += order.amountIn;
        pool.reserveB -= amountOut;
    } else {
        pool.reserveB += order.amountIn;
        pool.reserveA -= amountOut;
    }
    
    // Transfer tokens to user
    tokenOutContract.transfer(order.user, amountOut);
    
    // Mark order as inactive
    order.isActive = false;
    Storage.set("order:" + order.id.toString(), order.serialize());
    
    savePool(pool);
    
    generateEvent(`MassaSwap: Limit order executed - ${order.id}`);
}

export function executeDCAStrategies(): void {
    const dcaCount = u64(parseInt(Storage.has("dca_count") ? Storage.get("dca_count") : "0"));
    const currentTime = Context.timestamp();
    
    for (let i: u64 = 0; i < dcaCount; i++) {
        const dcaKey = "dca:" + i.toString();
        
        if (!Storage.has(dcaKey)) continue;
        
        const strategy = DCAStrategy.deserialize(Storage.get(dcaKey));
        
        if (!strategy.isActive || strategy.currentPeriod >= strategy.totalPeriods) {
            continue;
        }
        
        // Check if it's time to execute
        const timeSinceLastExecution = currentTime - strategy.lastExecution;
        if (timeSinceLastExecution >= strategy.intervalPeriods) {
            executeDCAOrder(strategy);
        }
    }
}

export function executeDCAOrder(strategy: DCAStrategy): void {
    const pool = getPool(strategy.tokenIn, strategy.tokenOut);
    if (pool == null) return;
    
    const tokenInContract = new IERC20(strategy.tokenIn);
    const tokenOutContract = new IERC20(strategy.tokenOut);
    
    // Calculate output amount
    const tokenInIsA = pool.tokenA.toString() == strategy.tokenIn.toString();
    const reserveIn = tokenInIsA ? pool.reserveA : pool.reserveB;
    const reserveOut = tokenInIsA ? pool.reserveB : pool.reserveA;
    
    const amountOut = getAmountOut(strategy.amountPerPeriod, reserveIn, reserveOut, pool.fee);
    
    if (amountOut >= strategy.minAmountOut) {
        // Execute the trade
        tokenInContract.transferFrom(strategy.user, Context.callee(), strategy.amountPerPeriod);
        tokenOutContract.transfer(strategy.user, amountOut);
        
        // Update pool reserves
        if (tokenInIsA) {
            pool.reserveA += strategy.amountPerPeriod;
            pool.reserveB -= amountOut;
        } else {
            pool.reserveB += strategy.amountPerPeriod;
            pool.reserveA -= amountOut;
        }
        
        // Update strategy
        strategy.currentPeriod++;
        strategy.lastExecution = Context.timestamp();
        
        if (strategy.currentPeriod >= strategy.totalPeriods) {
            strategy.isActive = false;
        }
        
        Storage.set("dca:" + strategy.id.toString(), strategy.serialize());
        savePool(pool);
        
        generateEvent(`MassaSwap: DCA executed - ${strategy.id}`);
    }
}

export function updateYieldFarmingRewards(): void {
    const yieldPoolCount = u64(parseInt(Storage.has("yield_pool_count") ? Storage.get("yield_pool_count") : "0"));
    const currentTime = Context.timestamp();
    
    for (let i: u64 = 0; i < yieldPoolCount; i++) {
        const poolKey = "yield_pool:" + i.toString();
        
        if (!Storage.has(poolKey)) continue;
        
        const yieldPool = YieldPool.deserialize(Storage.get(poolKey));
        
        if (!yieldPool.isActive || yieldPool.totalStaked == 0) continue;
        
        // Calculate reward per token
        const timeElapsed = currentTime - yieldPool.lastUpdateTime;
        const rewardPerToken = (yieldPool.rewardRate * timeElapsed) / yieldPool.totalStaked;
        
        yieldPool.rewardPerTokenStored += rewardPerToken;
        yieldPool.lastUpdateTime = currentTime;
        
        Storage.set(poolKey, yieldPool.serialize());
    }
}

export function autoAdjustFees(): void {
    const poolKeys = getAllPoolKeys();
    
    for (let i = 0; i < poolKeys.length; i++) {
        const poolKey = "pool:" + poolKeys[i];
        const pool = Pool.deserialize(Storage.get(poolKey));
        
        // Calculate volatility based on price changes
        const volatility = calculatePoolVolatility(pool);
        
        // Adjust fees based on volatility
        if (volatility > 1000) {
            pool.fee = 50; // 0.5% for high volatility
        } else if (volatility > 500) {
            pool.fee = 40; // 0.4% for medium volatility
        } else {
            pool.fee = 30; // 0.3% for low volatility
        }
        
        Storage.set(poolKey, pool.serialize());
    }
}

export function calculatePoolVolatility(pool: Pool): u64 {
    // Simplified volatility calculation
    const currentPrice = (pool.reserveB * ONE_UNIT) / pool.reserveA;
    const priceKey = "price:" + pool.tokenA.toString() + ":" + pool.tokenB.toString();
    const lastPrice = Storage.has(priceKey) ? u64(parseInt(Storage.get(priceKey))) : currentPrice;
    
    const priceChange = currentPrice > lastPrice ? currentPrice - lastPrice : lastPrice - currentPrice;
    return (priceChange * 10000) / lastPrice; // Return as basis points
}

// User-facing functions for creating strategies
export function createDCAStrategy(args: StaticArray<u8>): void {
    const arguments = new Args(args);
    const tokenIn = new Address(arguments.nextString().unwrap());
    const tokenOut = new Address(arguments.nextString().unwrap());
    const amountPerPeriod = arguments.nextU64().unwrap();
    const intervalPeriods = arguments.nextU64().unwrap();
    const totalPeriods = arguments.nextU64().unwrap();
    const minAmountOut = arguments.nextU64().unwrap();
    
    const caller = Context.caller();
    const dcaCount = u64(parseInt(Storage.has("dca_count") ? Storage.get("dca_count") : "0"));
    
    // Create new DCA strategy
    const strategy = new DCAStrategy(
        dcaCount,
        caller,
        tokenIn,
        tokenOut,
        amountPerPeriod,
        intervalPeriods,
        totalPeriods,
        minAmountOut
    );
    
    // Store strategy
    Storage.set("dca:" + dcaCount.toString(), strategy.serialize());
    Storage.set("dca_count", (dcaCount + 1).toString());
    
    // Store user's strategy reference
    const userDCAKey = "user_dca:" + caller.toString();
    const userDCAList = Storage.has(userDCAKey) ? Storage.get(userDCAKey) : "";
    const newUserDCAList = userDCAList == "" ? dcaCount.toString() : userDCAList + "," + dcaCount.toString();
    Storage.set(userDCAKey, newUserDCAList);
    
    generateEvent(`MassaSwap: DCA strategy created - ${dcaCount}`);
}

export function createLimitOrder(args: StaticArray<u8>): void {
    const arguments = new Args(args);
    const tokenIn = new Address(arguments.nextString().unwrap());
    const tokenOut = new Address(arguments.nextString().unwrap());
    const amountIn = arguments.nextU64().unwrap();
    const minAmountOut = arguments.nextU64().unwrap();
    const expiry = arguments.nextU64().unwrap();
    const orderType = arguments.nextString().unwrap();
    
    const caller = Context.caller();
    const orderCount = u64(parseInt(Storage.has("order_count") ? Storage.get("order_count") : "0"));
    
    // Transfer tokens to contract
    const tokenInContract = new IERC20(tokenIn);
    tokenInContract.transferFrom(caller, Context.callee(), amountIn);
    
    // Create limit order
    const order = new LimitOrder(
        orderCount,
        caller,
        tokenIn,
        tokenOut,
        amountIn,
        minAmountOut,
        expiry,
        orderType
    );
    
    // Store order
    Storage.set("order:" + orderCount.toString(), order.serialize());
    Storage.set("order_count", (orderCount + 1).toString());
    
    // Store user's order reference
    const userOrderKey = "user_orders:" + caller.toString();
    const userOrderList = Storage.has(userOrderKey) ? Storage.get(userOrderKey) : "";
    const newUserOrderList = userOrderList == "" ? orderCount.toString() : userOrderList + "," + orderCount.toString();
    Storage.set(userOrderKey, newUserOrderList);
    
    generateEvent(`MassaSwap: Limit order created - ${orderCount}`);
}

export function createYieldPool(args: StaticArray<u8>): void {
    const arguments = new Args(args);
    const tokenA = new Address(arguments.nextString().unwrap());
    const tokenB = new Address(arguments.nextString().unwrap());
    const rewardToken = new Address(arguments.nextString().unwrap());
    const rewardRate = arguments.nextU64().unwrap();
    
    const yieldPoolCount = u64(parseInt(Storage.has("yield_pool_count") ? Storage.get("yield_pool_count") : "0"));
    
    // Create yield pool
    const yieldPool = new YieldPool(
        yieldPoolCount,
        tokenA,
        tokenB,
        rewardToken,
        rewardRate
    );
    
    // Store yield pool
    Storage.set("yield_pool:" + yieldPoolCount.toString(), yieldPool.serialize());
    Storage.set("yield_pool_count", (yieldPoolCount + 1).toString());
    
    generateEvent(`MassaSwap: Yield pool created - ${yieldPoolCount}`);
}

export function stakeLP(args: StaticArray<u8>): void {
    const arguments = new Args(args);
    const yieldPoolId = arguments.nextU64().unwrap();
    const amount = arguments.nextU64().unwrap();
    
    const caller = Context.caller();
    const yieldPoolKey = "yield_pool:" + yieldPoolId.toString();
    
    if (!Storage.has(yieldPoolKey)) {
        generateEvent("MassaSwap: Yield pool does not exist");
        return;
    }
    
    const yieldPool = YieldPool.deserialize(Storage.get(yieldPoolKey));
    
    // Update rewards before staking
    updateYieldFarmingRewards();
    
    // Transfer LP tokens to contract
    const lpTokenKey = "lp_balance:" + yieldPool.tokenA.toString() + ":" + yieldPool.tokenB.toString() + ":" + caller.toString();
    const userLPBalance = u64(parseInt(Storage.has(lpTokenKey) ? Storage.get(lpTokenKey) : "0"));
    
    if (userLPBalance < amount) {
        generateEvent("MassaSwap: Insufficient LP balance");
        return;
    }
    
    // Update user LP balance
    Storage.set(lpTokenKey, (userLPBalance - amount).toString());
    
    // Update staking info
    const userStakeKey = "stake:" + yieldPoolId.toString() + ":" + caller.toString();
    const currentStake = u64(parseInt(Storage.has(userStakeKey) ? Storage.get(userStakeKey) : "0"));
    Storage.set(userStakeKey, (currentStake + amount).toString());
    
    // Update yield pool total
    yieldPool.totalStaked += amount;
    Storage.set(yieldPoolKey, yieldPool.serialize());
    
    generateEvent(`MassaSwap: LP tokens staked - ${amount}`);
}

export function unstakeLP(args: StaticArray<u8>): void {
    const arguments = new Args(args);
    const yieldPoolId = arguments.nextU64().unwrap();
    const amount = arguments.nextU64().unwrap();
    
    const caller = Context.caller();
    const yieldPoolKey = "yield_pool:" + yieldPoolId.toString();
    
    if (!Storage.has(yieldPoolKey)) {
        generateEvent("MassaSwap: Yield pool does not exist");
        return;
    }
    
    const yieldPool = YieldPool.deserialize(Storage.get(yieldPoolKey));
    
    // Update rewards before unstaking
    updateYieldFarmingRewards();
    
    // Check user stake
    const userStakeKey = "stake:" + yieldPoolId.toString() + ":" + caller.toString();
    const currentStake = u64(parseInt(Storage.has(userStakeKey) ? Storage.get(userStakeKey) : "0"));
    
    if (currentStake < amount) {
        generateEvent("MassaSwap: Insufficient staked amount");
        return;
    }
    
    // Calculate and distribute rewards
    const rewardAmount = calculateUserRewards(yieldPool, currentStake);
    if (rewardAmount > 0) {
        const rewardTokenContract = new IERC20(yieldPool.rewardToken);
        rewardTokenContract.transfer(caller, rewardAmount);
    }
    
    // Update user stake
    Storage.set(userStakeKey, (currentStake - amount).toString());
    
    // Return LP tokens
    const lpTokenKey = "lp_balance:" + yieldPool.tokenA.toString() + ":" + yieldPool.tokenB.toString() + ":" + caller.toString();
    const userLPBalance = u64(parseInt(Storage.has(lpTokenKey) ? Storage.get(lpTokenKey) : "0"));
    Storage.set(lpTokenKey, (userLPBalance + amount).toString());
    
    // Update yield pool total
    yieldPool.totalStaked -= amount;
    Storage.set(yieldPoolKey, yieldPool.serialize());
    
    generateEvent(`MassaSwap: LP tokens unstaked - ${amount}, Rewards: ${rewardAmount}`);
}

export function calculateUserRewards(yieldPool: YieldPool, userStake: u64): u64 {
    if (yieldPool.totalStaked == 0) return 0;
    
    const userShare = (userStake * ONE_UNIT) / yieldPool.totalStaked;
    return (yieldPool.rewardPerTokenStored * userShare) / ONE_UNIT;
}

export function claimRewards(args: StaticArray<u8>): void {
    const arguments = new Args(args);
    const yieldPoolId = arguments.nextU64().unwrap();
    
    const caller = Context.caller();
    const yieldPoolKey = "yield_pool:" + yieldPoolId.toString();
    
    if (!Storage.has(yieldPoolKey)) {
        generateEvent("MassaSwap: Yield pool does not exist");
        return;
    }
    
    const yieldPool = YieldPool.deserialize(Storage.get(yieldPoolKey));
    
    // Update rewards
    updateYieldFarmingRewards();
    
    // Calculate user rewards
    const userStakeKey = "stake:" + yieldPoolId.toString() + ":" + caller.toString();
    const userStake = u64(parseInt(Storage.has(userStakeKey) ? Storage.get(userStakeKey) : "0"));
    
    const rewardAmount = calculateUserRewards(yieldPool, userStake);
    
    if (rewardAmount > 0) {
        const rewardTokenContract = new IERC20(yieldPool.rewardToken);
        rewardTokenContract.transfer(caller, rewardAmount);
        
        // Reset user's reward tracking
        const userRewardKey = "user_rewards:" + yieldPoolId.toString() + ":" + caller.toString();
        Storage.set(userRewardKey, "0");
        
        generateEvent(`MassaSwap: Rewards claimed - ${rewardAmount}`);
    } else {
        generateEvent("MassaSwap: No rewards to claim");
    }
}