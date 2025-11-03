import {
    Address,
    asyncCall,
    Context,
    generateEvent,
    sendMessage,
    Slot,
    Storage,
} from "@massalabs/massa-as-sdk";
import { Args, stringToBytes } from "@massalabs/as-types";
import { IERC20 } from "../testDir/assembly/contracts/interfaces/IERC20";
import {
    ONE_UNIT,
    Pool,
    getPool,
    savePool,
    getAmountOut,
    getAmountIn,
    getPoolKey,
    safeSqrt as sqrt,
    // Access control functions
    onlyRole,
    whenNotPaused,
    nonReentrant,
    endNonReentrant,
    validDeadline,
    validateTokenPair,
    validateAmounts,
    safeTransferFrom,
    safeTransfer,
    grantRole,
    revokeRole,
    // Constants
    ADMIN_ROLE,
    PAUSER_ROLE,
    MIN_LIQUIDITY,
    MAX_DEADLINE_HOURS
} from "../testDir/assembly/contracts/beam_legacy/massa_beam";
import {
    detectAllArbitrageOpportunities,
    executeArbitrageOpportunity,
    ArbitrageOpportunity,
    startArbitrageEngine,
    stopArbitrageEngine,
    ARBITRAGE_GAS_LIMIT
} from "../testDir/assembly/contracts/beam_legacy/massa_beam_engine";

export {grantRole, revokeRole}

// Enhanced constants for advanced features
export const MAX_DCA_PERIODS : u64= 365; // Maximum 1 year DCA
export const MIN_DCA_INTERVAL : u64= 3600; // Minimum 1 hour interval
export const MAX_ORDER_EXPIRY : u64= 30 * 24 * 3600; // 30 days maximum
export const YIELD_FARMING_FEE : u64= 100; // 1% performance fee
export const MAX_LEVERAGE:u64 = 300; // 3x maximum leverage
export const LIQUIDATION_THRESHOLD:u64 = 8500; // 85% collateral ratio
export const INSURANCE_FUND_RATE:u64 = 50; // 0.5% goes to insurance fund

// Role definitions for advanced features
export const YIELD_MANAGER_ROLE = "YIELD_MANAGER";
export const LIQUIDATOR_ROLE = "LIQUIDATOR";
export const KEEPER_ROLE = "KEEPER";

// Enhanced limit order with advanced features
export class LimitOrder {
    id: u64;
    user: Address;
    tokenIn: Address;
    tokenOut: Address;
    amountIn: u64;
    minAmountOut: u64;
    expiry: u64;
    isActive: bool;
    orderType: string;
    partialFill: bool;
    filledAmount: u64;
    createdAt: u64;
    priority: u64;
    slippageTolerance: u64;
    gasPrice: u64;

    constructor(
        id: u64,
        user: Address,
        tokenIn: Address,
        tokenOut: Address,
        amountIn: u64,
        minAmountOut: u64,
        expiry: u64,
        orderType: string,
        partialFill: bool = false,
        slippageTolerance: u64 = 100
    ) {
        this.id = id;
        this.user = user;
        this.tokenIn = tokenIn;
        this.tokenOut = tokenOut;
        this.amountIn = amountIn;
        this.minAmountOut = minAmountOut;
        this.expiry = expiry;
        this.isActive = true;
        this.orderType = orderType;
        this.partialFill = partialFill;
        this.filledAmount = 0;
        this.createdAt = Context.timestamp();
        this.priority = this.calculatePriority();
        this.slippageTolerance = slippageTolerance;
        this.gasPrice = getCurrentGasPrice();
    }

    calculatePriority(): u64 {
        // Higher amounts and better prices get higher priority
        const sizeScore = this.amountIn / ONE_UNIT;
        const timeScore = (Context.timestamp() - this.createdAt) / 1000; // Age bonus
        return sizeScore + timeScore;
    }

    serialize(): StaticArray<u8> {
        const args = new Args();
        args.add(this.id);
        args.add(this.user.toString());
        args.add(this.tokenIn.toString());
        args.add(this.tokenOut.toString());
        args.add(this.amountIn);
        args.add(this.minAmountOut);
        args.add(this.expiry);
        args.add(this.isActive);
        args.add(this.orderType);
        args.add(this.partialFill);
        args.add(this.filledAmount);
        args.add(this.createdAt);
        args.add(this.priority);
        args.add(this.slippageTolerance);
        args.add(this.gasPrice);
        return args.serialize();
    }

    static deserialize(data: StaticArray<u8>): LimitOrder {
        const args = new Args(data);
        const order = new LimitOrder(
            args.nextU64().unwrap(),
            new Address(args.nextString().unwrap()),
            new Address(args.nextString().unwrap()),
            new Address(args.nextString().unwrap()),
            args.nextU64().unwrap(),
            args.nextU64().unwrap(),
            args.nextU64().unwrap(),
            args.nextString().unwrap(),
            args.nextBool().unwrap(),
            args.nextU64().unwrap()
        );
        order.filledAmount = args.nextU64().unwrap();
        order.createdAt = args.nextU64().unwrap();
        order.priority = args.nextU64().unwrap();
        order.slippageTolerance = args.nextU64().unwrap();
        order.gasPrice = args.nextU64().unwrap();
        return order;
    }
}

// Enhanced DCA with advanced features
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
    maxSlippage: u64;
    pausedUntil: u64;
    accumulatedTokens: u64;
    totalSpent: u64;
    averagePrice: u64;
    stopLoss: u64;
    takeProfit: u64;

    constructor(
        id: u64,
        user: Address,
        tokenIn: Address,
        tokenOut: Address,
        amountPerPeriod: u64,
        intervalPeriods: u64,
        totalPeriods: u64,
        minAmountOut: u64 = 0,
        maxSlippage: u64 = 300,
        stopLoss: u64 = 0,
        takeProfit: u64 = 0
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
        this.maxSlippage = maxSlippage;
        this.pausedUntil = 0;
        this.accumulatedTokens = 0;
        this.totalSpent = 0;
        this.averagePrice = 0;
        this.stopLoss = stopLoss;
        this.takeProfit = takeProfit;
    }

    updateAveragePrice(newTokens: u64, amountSpent: u64): void {
        if (this.accumulatedTokens == 0) {
            this.averagePrice = (amountSpent * ONE_UNIT) / newTokens;
        } else {
            const totalValue = this.totalSpent + amountSpent;
            const totalTokens = this.accumulatedTokens + newTokens;
            this.averagePrice = (totalValue * ONE_UNIT) / totalTokens;
        }
        this.accumulatedTokens += newTokens;
        this.totalSpent += amountSpent;
    }

    shouldTriggerStopLoss(currentPrice: u64): bool {
        if (this.stopLoss == 0 || this.averagePrice == 0) return false;
        const priceDrop = ((this.averagePrice - currentPrice) * 10000) / this.averagePrice;
        return priceDrop >= this.stopLoss;
    }

    shouldTriggerTakeProfit(currentPrice: u64): bool {
        if (this.takeProfit == 0 || this.averagePrice == 0) return false;
        const priceGain = ((currentPrice - this.averagePrice) * 10000) / this.averagePrice;
        return priceGain >= this.takeProfit;
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
        args.add(this.maxSlippage);
        args.add(this.pausedUntil);
        args.add(this.accumulatedTokens);
        args.add(this.totalSpent);
        args.add(this.averagePrice);
        args.add(this.stopLoss);
        args.add(this.takeProfit);
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
            args.nextU64().unwrap(),
            args.nextU64().unwrap(),
            args.nextU64().unwrap(),
            args.nextU64().unwrap()
        );
        strategy.currentPeriod = args.nextU64().unwrap();
        strategy.lastExecution = args.nextU64().unwrap();
        strategy.isActive = args.nextBool().unwrap();
        strategy.pausedUntil = args.nextU64().unwrap();
        strategy.accumulatedTokens = args.nextU64().unwrap();
        strategy.totalSpent = args.nextU64().unwrap();
        strategy.averagePrice = args.nextU64().unwrap();
        strategy.stopLoss = args.nextU64().unwrap();
        strategy.takeProfit = args.nextU64().unwrap();
        return strategy;
    }
}

// Enhanced yield farming with leverage and insurance
export class YieldPool {
    id: u64;
    tokenA: Address;
    tokenB: Address;
    rewardToken: Address;
    totalStaked: u64;
    rewardRate: u64;
    lastUpdateTime: u64;
    rewardPerTokenStored: u64;
    isActive: bool;
    performanceFee: u64;
    lockupPeriod: u64;
    maxLeverage: u64;
    liquidationThreshold: u64;
    totalBorrowed: u64;
    insuranceFund: u64;
    apr: u64;
    volatilityRisk: u64;

    constructor(
        id: u64,
        tokenA: Address,
        tokenB: Address,
        rewardToken: Address,
        rewardRate: u64,
        performanceFee: u64 = YIELD_FARMING_FEE,
        lockupPeriod: u64 = 0,
        maxLeverage: u64 = MAX_LEVERAGE
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
        this.performanceFee = performanceFee;
        this.lockupPeriod = lockupPeriod;
        this.maxLeverage = maxLeverage;
        this.liquidationThreshold = LIQUIDATION_THRESHOLD;
        this.totalBorrowed = 0;
        this.insuranceFund = 0;
        this.apr = 0;
        this.volatilityRisk = 0;
    }

    updateRewards(): void {
        if (this.totalStaked == 0) {
            this.lastUpdateTime = Context.timestamp();
            return;
        }

        const currentTime = Context.timestamp();
        const timeElapsed = currentTime - this.lastUpdateTime;
        const rewardPerToken = (timeElapsed * this.rewardRate * ONE_UNIT) / this.totalStaked;
        
        this.rewardPerTokenStored += rewardPerToken;
        this.lastUpdateTime = currentTime;
    }

    calculateAPR(): u64 {
        if (this.totalStaked == 0) return 0;
        const yearlyRewards = this.rewardRate * 365 * 24 * 3600;
        return (yearlyRewards * 10000) / this.totalStaked; // Return as basis points
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
        args.add(this.performanceFee);
        args.add(this.lockupPeriod);
        args.add(this.maxLeverage);
        args.add(this.liquidationThreshold);
        args.add(this.totalBorrowed);
        args.add(this.insuranceFund);
        args.add(this.apr);
        args.add(this.volatilityRisk);
        return args.serialize();
    }

    static deserialize(data: StaticArray<u8>): YieldPool {
        const args = new Args(data);
        const pool = new YieldPool(
            args.nextU64().unwrap(),
            new Address(args.nextString().unwrap()),
            new Address(args.nextString().unwrap()),
            new Address(args.nextString().unwrap()),
            args.nextU64().unwrap(),
            args.nextU64().unwrap(),
            args.nextU64().unwrap(),
            args.nextU64().unwrap()
        );
        pool.totalStaked = args.nextU64().unwrap();
        pool.lastUpdateTime = args.nextU64().unwrap();
        pool.rewardPerTokenStored = args.nextU64().unwrap();
        pool.isActive = args.nextBool().unwrap();
        pool.liquidationThreshold = args.nextU64().unwrap();
        pool.totalBorrowed = args.nextU64().unwrap();
        pool.insuranceFund = args.nextU64().unwrap();
        pool.apr = args.nextU64().unwrap();
        pool.volatilityRisk = args.nextU64().unwrap();
        return pool;
    }
}



// Leveraged position for yield farming
export class LeveragedPosition {
    id: u64;
    user: Address;
    poolId: u64;
    collateral: u64;
    borrowed: u64;
    leverage: u64;
    liquidationPrice: u64;
    createdAt: u64;
    lastUpdate: u64;
    isActive: bool;
    accruedInterest: u64;
    healthFactor: u64;

    constructor(
        id: u64,
        user: Address,
        poolId: u64,
        collateral: u64,
        borrowed: u64,
        leverage: u64
    ) {
        this.id = id;
        this.user = user;
        this.poolId = poolId;
        this.collateral = collateral;
        this.borrowed = borrowed;
        this.leverage = leverage;
        this.liquidationPrice = this.calculateLiquidationPrice();
        this.createdAt = Context.timestamp();
        this.lastUpdate = Context.timestamp();
        this.isActive = true;
        this.accruedInterest = 0;
        this.healthFactor = this.calculateHealthFactor();
    }

    calculateLiquidationPrice(): u64 {
        if (this.collateral == 0) return 0;
        return (this.borrowed * 10000) / (this.collateral * LIQUIDATION_THRESHOLD / 10000);
    }

    calculateHealthFactor(): u64 {
        if (this.borrowed == 0) return u64.MAX_VALUE;
        return (this.collateral * LIQUIDATION_THRESHOLD) / (this.borrowed * 10000);
    }

    updatePosition(newCollateral: u64, newBorrowed: u64): void {
        this.collateral = newCollateral;
        this.borrowed = newBorrowed;
        this.liquidationPrice = this.calculateLiquidationPrice();
        this.healthFactor = this.calculateHealthFactor();
        this.lastUpdate = Context.timestamp();
    }

    serialize(): StaticArray<u8> {
        const args = new Args();
        args.add(this.id);
        args.add(this.user.toString());
        args.add(this.poolId);
        args.add(this.collateral);
        args.add(this.borrowed);
        args.add(this.leverage);
        args.add(this.liquidationPrice);
        args.add(this.createdAt);
        args.add(this.lastUpdate);
        args.add(this.isActive);
        args.add(this.accruedInterest);
        args.add(this.healthFactor);
        return args.serialize();
    }

    static deserialize(data: StaticArray<u8>): LeveragedPosition {
        const args = new Args(data);
        const position = new LeveragedPosition(
            args.nextU64().unwrap(),
            new Address(args.nextString().unwrap()),
            args.nextU64().unwrap(),
            args.nextU64().unwrap(),
            args.nextU64().unwrap(),
            args.nextU64().unwrap()
        );
        position.liquidationPrice = args.nextU64().unwrap();
        position.createdAt = args.nextU64().unwrap();
        position.lastUpdate = args.nextU64().unwrap();
        position.isActive = args.nextBool().unwrap();
        position.accruedInterest = args.nextU64().unwrap();
        position.healthFactor = args.nextU64().unwrap();
        return position;
    }
}


// Storage keys
const LIMIT_ORDER_COUNT = "limitOrderCount";
const DCA_COUNT = "dcaCount";
const YIELD_POOL_COUNT = "yieldPoolCount";
const POSITION_COUNT = "positionCount";
const NEXT_EXECUTION_TIME = "nextExecutionTime";
const GAS_PRICE = "gasPrice";

// Global counters
let limitOrderCounter: u64 = 0;
let dcaCounter: u64 = 0;
let yieldPoolCounter: u64 = 0;
let positionCounter: u64 = 0;



export function constructor(): void {
    // Initialize contract state, if needed
    const owner = Context.caller();
    Storage.set("owner", owner.toString());
    Storage.set(ADMIN_ROLE + ":" + owner.toString(), "true");
    
    
    setGasPrice(1000);
    generateEvent(`Contract initialized by ${owner.toString()}`);
}

// Utility functions
export function getCurrentGasPrice(): u64 {
    const gasPriceBytes = Storage.get(stringToBytes(GAS_PRICE));
    if (gasPriceBytes.length > 0) {
        const args = new Args(gasPriceBytes);
        return args.nextU64().unwrap();
    }
    return 1000; // Default gas price
}

export function setGasPrice(price: u64): void {
    onlyRole(ADMIN_ROLE);
    const args = new Args();
    args.add(price);
    Storage.set(stringToBytes(GAS_PRICE), args.serialize());
}

function getLimitOrderKey(id: u64): string {
    return `limitOrder_${id}`;
}

function getDCAKey(id: u64): string {
    return `dca_${id}`;
}

function getYieldPoolKey(id: u64): string {
    return `yieldPool_${id}`;
}

function getPositionKey(id: u64): string {
    return `position_${id}`;
}

function getUserOrdersKey(user: Address): string {
    return `userOrders_${user.toString()}`;
}

function getUserDCAKey(user: Address): string {
    return `userDCA_${user.toString()}`;
}

function getUserPositionsKey(user: Address): string {
    return `userPositions_${user.toString()}`;
}

// Limit Order Functions
export function createLimitOrder(
    tokenIn: Address,
    tokenOut: Address,
    amountIn: u64,
    minAmountOut: u64,
    expiry: u64,
    orderType: string,
    partialFill: bool = false,
    slippageTolerance: u64 = 100
): u64 {
    whenNotPaused();
    nonReentrant();
    
    validateTokenPair(tokenIn, tokenOut);
    validateAmounts(amountIn, minAmountOut);
    validDeadline(expiry);
    
    const user = Context.caller();
    limitOrderCounter++;
    
    const order = new LimitOrder(
        limitOrderCounter,
        user,
        tokenIn,
        tokenOut,
        amountIn,
        minAmountOut,
        expiry,
        orderType,
        partialFill,
        slippageTolerance
    );
    
    // Transfer tokens from user
    safeTransferFrom(tokenIn, user, Context.callee(), amountIn);
    
    // Save order
    Storage.set(stringToBytes(getLimitOrderKey(order.id)), order.serialize());
    
    // Update user orders list
    updateUserOrdersList(user, order.id, true);
    
    // Schedule order execution check
    scheduleOrderExecution(order.id, Context.timestamp() + 60); // Check in 1 minute
    
    generateEvent(`LimitOrderCreated:${order.id}:${user.toString()}:${amountIn}:${minAmountOut}`);
    
    endNonReentrant();
    return order.id;
}

export function executeOrderBatch(orderIds: u64[]): void {
    onlyRole(KEEPER_ROLE);
    
    for (let i = 0; i < orderIds.length; i++) {
        executeOrder(orderIds[i]);
    }
}

function executeOrder(orderId: u64): bool {
    const orderKey = getLimitOrderKey(orderId);
    const orderBytes = Storage.get(stringToBytes(orderKey));
    
    if (orderBytes.length == 0) return false;
    
    const order = LimitOrder.deserialize(orderBytes);
    
    if (!order.isActive || Context.timestamp() > order.expiry) {
        cancelOrder(orderId);
        return false;
    }
    
    const pool = getPool(order.tokenIn, order.tokenOut);
    if (!pool) return false;
//     ) getAmountOut(amountIn: u64, reserveIn: u64, reserveOut: u64, fee: u64): u64
// import getAmountOut
    const amountOut = getAmountOut(order.amountIn - order.filledAmount, pool.reserveA, pool.reserveB, pool.fee);
    
    if (amountOut >= order.minAmountOut) {
        // Execute the order
        const actualAmountOut = performSwap(
            order.tokenIn,
            order.tokenOut,
            order.amountIn - order.filledAmount,
            order.minAmountOut,
            order.user
        );
        
        if (order.partialFill) {
            order.filledAmount = order.amountIn;
        }
        
        order.isActive = false;
        Storage.set(stringToBytes(orderKey), order.serialize());
        
        generateEvent(`OrderExecuted:${orderId}:${actualAmountOut}`);
        return true;
    }
    return false;
}

// Yield Farming Functions
export function createYieldPool(
    tokenA: Address,
    tokenB: Address,
    rewardToken: Address,
    rewardRate: u64,
    performanceFee: u64 = YIELD_FARMING_FEE,
    lockupPeriod: u64 = 0,
    maxLeverage: u64 = MAX_LEVERAGE
): u64 {
    onlyRole(YIELD_MANAGER_ROLE);
    whenNotPaused();
    
    validateTokenPair(tokenA, tokenB);
    yieldPoolCounter++;
    
    const pool = new YieldPool(
        yieldPoolCounter,
        tokenA,
        tokenB,
        rewardToken,
        rewardRate,
        performanceFee,
        lockupPeriod,
        maxLeverage
    );
    
    Storage.set(stringToBytes(getYieldPoolKey(pool.id)), pool.serialize());
    
    generateEvent(`YieldPoolCreated:${pool.id}:${tokenA.toString()}:${tokenB.toString()}`);
    return pool.id;
}

export function stakeInYieldPool(poolId: u64, amountA: u64, amountB: u64): bool {
    whenNotPaused();
    nonReentrant();
    
    const poolKey = getYieldPoolKey(poolId);
    const poolBytes = Storage.get(stringToBytes(poolKey));
    
    if (poolBytes.length == 0) {
        endNonReentrant();
        return false;
    }
    
    const pool = YieldPool.deserialize(poolBytes);
    if (!pool.isActive) {
        endNonReentrant();
        return false;
    }
    
    const user = Context.caller();
    
    // Transfer tokens from user
    safeTransferFrom(pool.tokenA, user, Context.callee(), amountA);
    safeTransferFrom(pool.tokenB, user, Context.callee(), amountB);
    
    // Update pool state
    pool.updateRewards();
    const lpTokens = calculateLPTokens(amountA, amountB, pool);
    pool.totalStaked += lpTokens;
    pool.apr = pool.calculateAPR();
    
    // Update user stake
    updateUserStake(user, poolId, lpTokens, true);
    
    Storage.set(stringToBytes(poolKey), pool.serialize());
    
    generateEvent(`StakeAdded:${poolId}:${user.toString()}:${lpTokens}`);
    
    endNonReentrant();
    return true;
}

export function createLeveragedPosition(
    poolId: u64,
    collateralAmount: u64,
    leverage: u64
): u64 {
    whenNotPaused();
    nonReentrant();
    
    if (leverage > MAX_LEVERAGE) {
        endNonReentrant();
        return 0;
    }
    
    const poolKey = getYieldPoolKey(poolId);
    const poolBytes = Storage.get(stringToBytes(poolKey));
    
    if (poolBytes.length == 0) {
        endNonReentrant();
        return 0;
    }
    
    const pool = YieldPool.deserialize(poolBytes);
    const user = Context.caller();
    
    positionCounter++;
    const borrowAmount = collateralAmount * (leverage - 100) / 100;
    
    const position = new LeveragedPosition(
        positionCounter,
        user,
        poolId,
        collateralAmount,
        borrowAmount,
        leverage
    );
    
    // Transfer collateral from user
    safeTransferFrom(pool.tokenA, user, Context.callee(), collateralAmount);
    
    // Update pool borrowed amount and insurance fund
    pool.totalBorrowed += borrowAmount;
    pool.insuranceFund += (borrowAmount * INSURANCE_FUND_RATE) / 10000;
    
    Storage.set(stringToBytes(getPositionKey(position.id)), position.serialize());
    Storage.set(stringToBytes(poolKey), pool.serialize());
    
    updateUserPositionsList(user, position.id, true);
    
    // Schedule health check
    scheduleHealthCheck(position.id, Context.timestamp() + 3600); // Check hourly
    
    generateEvent(`LeveragedPositionCreated:${position.id}:${user.toString()}:${leverage}`);
    
    endNonReentrant();
    return position.id;
}

export function liquidatePosition(positionId: u64): bool {
    onlyRole(LIQUIDATOR_ROLE);
    nonReentrant();
    
    const positionKey = getPositionKey(positionId);
    const positionBytes = Storage.get(stringToBytes(positionKey));
    
    if (positionBytes.length == 0) {
        endNonReentrant();
        return false;
    }
    
    const position = LeveragedPosition.deserialize(positionBytes);
    
    if (!position.isActive || position.healthFactor >= 10000) {
        endNonReentrant();
        return false;
    }
    
    const poolKey = getYieldPoolKey(position.poolId);
    const poolBytes = Storage.get(stringToBytes(poolKey));
    const pool = YieldPool.deserialize(poolBytes);
    
    // Calculate liquidation amounts
    const liquidationValue = position.collateral + position.borrowed;
    const liquidatorReward = (liquidationValue * 500) / 10000; // 5% liquidation reward
    const insurancePayout = liquidationValue - liquidatorReward;
    
    // Update pool state
    pool.totalBorrowed -= position.borrowed;
    pool.insuranceFund += insurancePayout;
    
    // Pay liquidator
    const liquidator = Context.caller();
    safeTransfer(pool.tokenA, liquidator, liquidatorReward);
    
    // Mark position as inactive
    position.isActive = false;
    
    Storage.set(stringToBytes(positionKey), position.serialize());
    Storage.set(stringToBytes(poolKey), pool.serialize());
    
    updateUserPositionsList(position.user, positionId, false);
    
    generateEvent(`PositionLiquidated:${positionId}:${liquidator.toString()}:${liquidatorReward}`);
    
    endNonReentrant();
    return true;
}

// Autonomous execution functions using Massa's scheduling
function scheduleOrderExecution(orderId: u64, executionTime: u64): void {
    const args = new Args();
    args.add("executeOrderBatch");
    args.add([orderId]);
    
    asyncCall(
        Context.callee(),
        "autonomousExecution",
        new Slot(Context.timestamp() + 60, 1), // Start in 1 minute
        new Slot(Context.timestamp() + 120, 2), // End slot (example: +120 seconds)
        0,
        0,
        args.serialize()
    );
}

function scheduleDCAExecution(strategyId: u64, executionTime: u64): void {
    const args = new Args();
    args.add("executeDCA");
    args.add(strategyId);
    
    asyncCall(
        Context.callee(),
        "autonomousExecution",
        new Slot(Context.timestamp() + 60, 1), // Start in 1 minute
        new Slot(Context.timestamp() + 120, 2), // End slot (example: +120 seconds)
        0,
        0,
        args.serialize()
    );
}

function scheduleHealthCheck(positionId: u64, executionTime: u64): void {
    const args = new Args();
    args.add("checkPositionHealth");
    args.add(positionId);
    

     asyncCall(
        Context.callee(),
        "autonomousExecution",
        new Slot(Context.timestamp() + 60, 1), // Start in 1 minute
        new Slot(Context.timestamp() + 120, 2), // End slot (example: +120 seconds)
        0,
        0,
        args.serialize()
    );
}

// Autonomous execution handler
export function autonomousExecution(args: StaticArray<u8>): void {
    const argsObj = new Args(args);
    const functionName = argsObj.nextString().unwrap();
    
    if (functionName == "executeOrderBatch") {
        const orderIds = argsObj.nextFixedSizeArray<u64>().unwrapOrDefault();
        executeOrderBatch(orderIds);
    } else if (functionName == "executeDCA") {
        const strategyId = argsObj.nextU64().unwrap();
        executeDCA(strategyId);
    } else if (functionName == "checkPositionHealth") {
        const positionId = argsObj.nextU64().unwrap();
        checkPositionHealth(positionId);
    } else if (functionName == "arbitrageExecution") {
        executeAutonomousArbitrage();
    }
}

function checkPositionHealth(positionId: u64): void {
    const positionKey = getPositionKey(positionId);
    const positionBytes = Storage.get(stringToBytes(positionKey));
    
    if (positionBytes.length == 0) return;
    
    const position = LeveragedPosition.deserialize(positionBytes);
    
    if (!position.isActive) return;
    
    // Update health factor based on current prices
    const pool = getPool(position.user, position.user); // This needs to be updated with proper pool lookup
    if (pool) {
        const currentPrice = (pool.reserveB * ONE_UNIT) / pool.reserveA;
        const newCollateralValue = (position.collateral * currentPrice) / ONE_UNIT;
        position.updatePosition(newCollateralValue, position.borrowed);
        
        if (position.healthFactor < 10000) {
            // Position is at risk - emit warning event
            generateEvent(`PositionAtRisk:${positionId}:${position.healthFactor}`);
            
            // Schedule immediate liquidation check
            scheduleHealthCheck(positionId, Context.timestamp() + 300); // 5 minutes
        } else {
            // Schedule next regular health check
            scheduleHealthCheck(positionId, Context.timestamp() + 3600); // 1 hour
        }
        
        Storage.set(stringToBytes(positionKey), position.serialize());
    }
}

// Enhanced arbitrage integration
function executeAutonomousArbitrage(): void {
    const opportunities = detectAllArbitrageOpportunities();
    
    for (let i = 0; i < opportunities.length; i++) {
        const opportunity = opportunities[i];
        if (opportunity.estimatedProfit > ARBITRAGE_GAS_LIMIT * 2) { // Ensure profitability
            executeArbitrageOpportunity(opportunity.id);
            
            generateEvent(`ArbitrageExecuted:${opportunity.estimatedProfit}:${opportunity.path.length}`);
        }
    }
    
    // Schedule next arbitrage check
    const args = new Args();
    args.add("arbitrageExecution");


     asyncCall(
        Context.callee(),
        "autonomousExecution",
        new Slot(Context.timestamp() + 60, 1), // Start in 1 minute
        new Slot(Context.timestamp() + 120, 2), // End slot (example: +120 seconds)
        0,
        0,
        args.serialize()
    );
}

// Utility functions for user data management
function updateUserOrdersList(user: Address, orderId: u64, add: bool): void {
    const key = getUserOrdersKey(user);
    const existingBytes = Storage.get(stringToBytes(key));
    
    let orderIds: u64[] = [];
    if (existingBytes.length > 0) {
        const args = new Args(existingBytes);
        orderIds = args.nextFixedSizeArray<u64>().unwrapOrDefault();
    }
    
    if (add) {
        orderIds.push(orderId);
    } else {
        const index = orderIds.indexOf(orderId);
        if (index > -1) {
            orderIds.splice(index, 1);
        }
    }
    
    const args = new Args();
    args.add(orderIds);
    Storage.set(stringToBytes(key), args.serialize());
}

function updateUserDCAList(user: Address, dcaId: u64, add: bool): void {
    const key = getUserDCAKey(user);
    const existingBytes = Storage.get(stringToBytes(key));
    
    let dcaIds: u64[] = [];
    if (existingBytes.length > 0) {
        const args = new Args(existingBytes);
        dcaIds = args.nextFixedSizeArray<u64>().unwrapOrDefault();
    }
    
    if (add) {
        dcaIds.push(dcaId);
    } else {
        const index = dcaIds.indexOf(dcaId);
        if (index > -1) {
            dcaIds.splice(index, 1);
        }
    }
    
    const args = new Args();
    args.add(dcaIds);
    Storage.set(stringToBytes(key), args.serialize());
}

function updateUserPositionsList(user: Address, positionId: u64, add: bool): void {
    const key = getUserPositionsKey(user);
    const existingBytes = Storage.get(stringToBytes(key));
    
    let positionIds: u64[] = [];
    if (existingBytes.length > 0) {
        const args = new Args(existingBytes);
        positionIds = args.nextFixedSizeArray<u64>().unwrapOrDefault();
    }
    
    if (add) {
        positionIds.push(positionId);
    } else {
        const index = positionIds.indexOf(positionId);
        if (index > -1) {
            positionIds.splice(index, 1);
        }
    }
    
    const args = new Args();
    args.add(positionIds);
    Storage.set(stringToBytes(key), args.serialize());
}

function updateUserStake(user: Address, poolId: u64, amount: u64, add: bool): void {
    const key = `userStake_${user.toString()}_${poolId}`;
    const existingBytes = Storage.get(stringToBytes(key));
    
    let currentStake: u64 = 0;
    if (existingBytes.length > 0) {
        const args = new Args(existingBytes);
        currentStake = args.nextU64().unwrap();
    }
    
    if (add) {
        currentStake += amount;
    } else {
        currentStake = currentStake > amount ? currentStake - amount : 0;
    }
    
    const args = new Args();
    args.add(currentStake);
    Storage.set(stringToBytes(key), args.serialize());
}

function calculateLPTokens(amountA: u64, amountB: u64, pool: YieldPool): u64 {
    // Simple LP token calculation - in production, use proper AMM math
    return sqrt(amountA , amountB);
}

function performSwap(
    tokenIn: Address,
    tokenOut: Address,
    amountIn: u64,
    minAmountOut: u64,
    recipient: Address
): u64 {
    const pool = getPool(tokenIn, tokenOut);
    if (!pool) return 0;
    
    const amountOut = getAmountOut(amountIn, pool.reserveA, pool.reserveB, pool.fee);
    if (amountOut < minAmountOut) return 0;
    
    // Update pool reserves
    if (pool.tokenA == tokenIn) {
        pool.reserveA += amountIn;
        pool.reserveB -= amountOut;
    } else {
        pool.reserveB += amountIn;
        pool.reserveA -= amountOut;
    }
    
    savePool(pool);
    safeTransfer(tokenOut, recipient, amountOut);
    
    return amountOut;
}

// Administrative functions
export function pauseContract(): void {
    onlyRole(PAUSER_ROLE);
    // Implementation would depend on your pause mechanism
    generateEvent("ContractPaused");
}

export function unpauseContract(): void {
    onlyRole(ADMIN_ROLE);
    // Implementation would depend on your pause mechanism
    generateEvent("ContractUnpaused");
}

export function emergencyWithdraw(token: Address, amount: u64): void {
    onlyRole(ADMIN_ROLE);
    safeTransfer(token, Context.caller(), amount);
    generateEvent(`EmergencyWithdraw:${token.toString()}:${amount}`);
}

// View functions
export function getLimitOrder(orderId: u64): LimitOrder | null {
    const orderBytes = Storage.get(stringToBytes(getLimitOrderKey(orderId)));
    if (orderBytes.length == 0) return null;
    return LimitOrder.deserialize(orderBytes);
}

export function getDCAStrategy(strategyId: u64): DCAStrategy | null {
    const strategyBytes = Storage.get(stringToBytes(getDCAKey(strategyId)));
    if (strategyBytes.length == 0) return null;
    return DCAStrategy.deserialize(strategyBytes);
}

export function getYieldPool(poolId: u64): YieldPool | null {
    const poolBytes = Storage.get(stringToBytes(getYieldPoolKey(poolId)));
    if (poolBytes.length == 0) return null;
    return YieldPool.deserialize(poolBytes);
}

export function getLeveragedPosition(positionId: u64): LeveragedPosition | null {
    const positionBytes = Storage.get(stringToBytes(getPositionKey(positionId)));
    if (positionBytes.length == 0) return null;
    return LeveragedPosition.deserialize(positionBytes);
}

export function getUserOrders(user: Address): u64[] {
    const orderBytes = Storage.get(stringToBytes(getUserOrdersKey(user)));
    if (orderBytes.length == 0) return [];
    const args = new Args(orderBytes);
    return args.nextFixedSizeArray<u64>().unwrapOrDefault();
}

export function getUserDCAs(user: Address): u64[] {
    const dcaBytes = Storage.get(stringToBytes(getUserDCAKey(user)));
    if (dcaBytes.length == 0) return [];
    const args = new Args(dcaBytes);
    return args.nextFixedSizeArray<u64>().unwrapOrDefault();
}

export function getUserPositions(user: Address): u64[] {
    const positionBytes = Storage.get(stringToBytes(getUserPositionsKey(user)));
    if (positionBytes.length == 0) return [];
    const args = new Args(positionBytes);
    return args.nextFixedSizeArray<u64>().unwrapOrDefault();
}

// Initialize the autonomous arbitrage engine
export function initializeArbitrageEngine(): void {
    onlyRole(ADMIN_ROLE);
    startArbitrageEngine(new StaticArray<u8>(0));
    
    // Schedule first arbitrage check
    const args = new Args();
    args.add("arbitrageExecution");
    
    asyncCall(
        Context.callee(),
        "autonomousExecution",
        new Slot(Context.timestamp() + 60, 1), // Start in 1 minute
        new Slot(Context.timestamp() + 120, 2), // End slot (example: +120 seconds)
        0,
        0,
        args.serialize()
    );
    
    generateEvent("ArbitrageEngineInitialized");
}

// Helper function to check if user has role (assuming this exists in your access control)
function hasRole(role: string, user: Address): bool {
    onlyRole(role)
    return true;
}


function executeScheduleOrder(orderId: u64): bool {
    const orderKey = getLimitOrderKey(orderId);
    const orderBytes = Storage.get(stringToBytes(orderKey));
    if (orderBytes.length == 0) return false;
    const order = LimitOrder.deserialize(orderBytes);
    if (!order.isActive || Context.timestamp() > order.expiry) {
        cancelOrder(orderId);
        return false;
    }
    const pool = getPool(order.tokenIn, order.tokenOut);
    if (!pool) return false;
    const amountOut = getAmountOut(order.amountIn - order.filledAmount, pool.reserveA, pool.reserveB, pool.fee);
    if (amountOut < order.minAmountOut) {
        // Not enough output, reschedule
        scheduleOrderExecution(orderId, Context.timestamp() + 60); // Check again in 1 minute
        return false;
    }
    
    // Reschedule if not executed
    scheduleOrderExecution(orderId, Context.timestamp() + 300); // Check again in 5 minutes
    return false;
}

function cancelOrder(orderId: u64): void {
    const orderKey = getLimitOrderKey(orderId);
    const orderBytes = Storage.get(stringToBytes(orderKey));
    
    if (orderBytes.length == 0) return;
    
    const order = LimitOrder.deserialize(orderBytes);
    const caller = Context.caller();
    
    if (order.user != caller && !hasRole(ADMIN_ROLE, caller)) {
        return;
    }
    
    // Refund remaining tokens
    const remainingAmount = order.amountIn - order.filledAmount;
    if (remainingAmount > 0) {
        safeTransfer(order.tokenIn, order.user, remainingAmount);
    }
    
    order.isActive = false;
    Storage.set(stringToBytes(orderKey), order.serialize());
    
    updateUserOrdersList(order.user, orderId, false);
    
    generateEvent(`OrderCancelled:${orderId}`);
}

// DCA Functions
export function createDCAStrategy(
    tokenIn: Address,
    tokenOut: Address,
    amountPerPeriod: u64,
    intervalPeriods: u64,
    totalPeriods: u64,
    minAmountOut: u64 = 0,
    maxSlippage: u64 = 300,
    stopLoss: u64 = 0,
    takeProfit: u64 = 0
): u64 {
    whenNotPaused();
    nonReentrant();
    
    validateTokenPair(tokenIn, tokenOut);
    
    if (totalPeriods > MAX_DCA_PERIODS || intervalPeriods < MIN_DCA_INTERVAL) {
        return 0;
    }
    
    const user = Context.caller();
    dcaCounter++;
    
    const strategy = new DCAStrategy(
        dcaCounter,
        user,
        tokenIn,
        tokenOut,
        amountPerPeriod,
        intervalPeriods,
        totalPeriods,
        minAmountOut,
        maxSlippage,
        stopLoss,
        takeProfit
    );
    
    const totalAmount = amountPerPeriod * totalPeriods;
    safeTransferFrom(tokenIn, user, Context.callee(), totalAmount);
    
    Storage.set(stringToBytes(getDCAKey(strategy.id)), strategy.serialize());
    updateUserDCAList(user, strategy.id, true);
    
    // Schedule first DCA execution
    scheduleDCAExecution(strategy.id, Context.timestamp() + intervalPeriods);
    
    generateEvent(`DCACreated:${strategy.id}:${user.toString()}:${totalAmount}`);
    
    endNonReentrant();
    return strategy.id;
}

function executeDCA(strategyId: u64): bool {
    const strategyKey = getDCAKey(strategyId);
    const strategyBytes = Storage.get(stringToBytes(strategyKey));
    
    if (strategyBytes.length == 0) return false;
    
    const strategy = DCAStrategy.deserialize(strategyBytes);
    
    if (!strategy.isActive || strategy.currentPeriod >= strategy.totalPeriods) {
        return false;
    }
    
    if (Context.timestamp() < strategy.pausedUntil) {
        scheduleDCAExecution(strategyId, strategy.pausedUntil + 60);
        return false;
    }
    
    // Get current price for stop loss/take profit checks
    const pool = getPool(strategy.tokenIn, strategy.tokenOut);
    if (!pool) return false;
    
    const currentPrice = (pool.reserveB * ONE_UNIT) / pool.reserveA;
    
    if (strategy.shouldTriggerStopLoss(currentPrice) || strategy.shouldTriggerTakeProfit(currentPrice)) {
        // Execute remaining amount at once
        const remainingAmount = (strategy.totalPeriods - strategy.currentPeriod) * strategy.amountPerPeriod;
        const amountOut = performSwap(strategy.tokenIn, strategy.tokenOut, remainingAmount, 0, strategy.user);
        
        strategy.updateAveragePrice(amountOut, remainingAmount);
        strategy.currentPeriod = strategy.totalPeriods;
        strategy.isActive = false;
        
        generateEvent(`DCACompleted:${strategyId}:StopLoss/TakeProfit`);
    } else {
        // Execute regular DCA
        const amountOut = performSwap(
            strategy.tokenIn,
            strategy.tokenOut,
            strategy.amountPerPeriod,
            strategy.minAmountOut,
            strategy.user
        );
        
        strategy.updateAveragePrice(amountOut, strategy.amountPerPeriod);
        strategy.currentPeriod++;
        strategy.lastExecution = Context.timestamp();
        
        if (strategy.currentPeriod < strategy.totalPeriods) {
            scheduleDCAExecution(strategyId, Context.timestamp() + strategy.intervalPeriods);
        } else {
            strategy.isActive = false;
            generateEvent(`DCACompleted:${strategyId}:AllPeriods`);
        }
    }
    
    Storage.set(stringToBytes(strategyKey), strategy.serialize());
    generateEvent(`DCAExecuted:${strategyId}:${strategy.currentPeriod}`);
    
    return true;

}
// Yield Farming Functions