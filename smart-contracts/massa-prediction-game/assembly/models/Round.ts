// This file defines the Round class, which represents a round of the game, including properties like roundId, bets, and methods for processing bets.

import { Bet } from "./Bet";

export class Round {
    roundId: u64;
    bets: Bet[];
    totalBetAmount: u64;

    constructor(roundId: u64) {
        this.roundId = roundId;
        this.bets = new Array<Bet>();
        this.totalBetAmount = 0;
    }

    placeBet(bet: Bet): void {
        this.bets.push(bet);
        this.totalBetAmount += bet.amount;
    }

    getBets(): Bet[] {
        return this.bets;
    }

    getTotalBetAmount(): u64 {
        return this.totalBetAmount;
    }

    clearBets(): void {
        this.bets = new Array<Bet>();
        this.totalBetAmount = 0;
    }
}