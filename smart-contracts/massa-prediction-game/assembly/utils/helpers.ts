import { u64 } from "@massalabs/as-types";
import { Player } from "../models/Player";
import { Bet } from "../models/Bet";

// Function to validate a bet
export function validateBet(player: Player, betAmount: u64): boolean {
    return player.isActive && betAmount > 0;
}

// Function to calculate payout based on odds
export function calculatePayout(betAmount: u64, odds: u64): u64 {
    return betAmount * odds;
}

// Function to generate a unique identifier for games or rounds
export function generateUniqueId(prefix: string): string {
    return `${prefix}-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
}

// Function to get the total amount of bets placed in a round
export function getTotalBets(bets: Bet[]): u64 {
    let total = u64(0);
    for (let i = 0; i < bets.length; i++) {
        total += bets[i].amount;
    }
    return total;
}