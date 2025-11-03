// Constant values used throughout the project

export const FEE_RATE: u64 = 30; // 0.3% fee
export const GAME_STATUS_PENDING: string = "pending";
export const GAME_STATUS_ACTIVE: string = "active";
export const GAME_STATUS_SETTLED: string = "settled";

export const EVENT_GAME_STARTED: string = "GameStarted";
export const EVENT_BET_PLACED: string = "BetPlaced";
export const EVENT_GAME_SETTLED: string = "GameSettled";

export const MAX_PLAYERS: u32 = 100; // Maximum number of players allowed in a game
export const MIN_BET_AMOUNT: u64 = 100; // Minimum bet amount
export const MAX_BET_AMOUNT: u64 = 10000; // Maximum bet amount