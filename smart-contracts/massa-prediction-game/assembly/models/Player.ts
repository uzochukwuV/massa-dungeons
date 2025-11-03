// assembly/models/Player.ts

export class Player {
    address: string;
    betAmount: u64;
    isActive: bool;

    constructor(address: string, betAmount: u64 = 0, isActive: bool = true) {
        this.address = address;
        this.betAmount = betAmount;
        this.isActive = isActive;
    }

    placeBet(amount: u64): void {
        this.betAmount += amount;
    }

    resetBet(): void {
        this.betAmount = 0;
        this.isActive = false;
    }
}