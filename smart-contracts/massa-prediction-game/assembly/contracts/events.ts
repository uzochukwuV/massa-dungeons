import { generateEvent } from "@massalabs/massa-as-sdk";

// Event emitted when a game starts
export function emitGameStarted(gameId: u64): void {
    generateEvent("GameStarted", { gameId });
}

// Event emitted when a bet is placed
export function emitBetPlaced(player: Address, amount: u64, prediction: string): void {
    generateEvent("BetPlaced", { player, amount, prediction });
}

// Event emitted when a game is settled
export function emitGameSettled(gameId: u64, winner: Address, payout: u64): void {
    generateEvent("GameSettled", { gameId, winner, payout });
}