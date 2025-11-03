// ITreasury.ts
export interface ITreasury {
    deposit(amount: u64): void;
    withdraw(amount: u64): void;
    getBalance(): u64;
}