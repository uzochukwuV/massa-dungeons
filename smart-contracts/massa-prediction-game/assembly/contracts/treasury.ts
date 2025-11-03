import { Address, Storage, generateEvent } from "@massalabs/massa-as-sdk";
import { ITreasury } from "../interfaces/ITreasury";

export class Treasury implements ITreasury {
    private balance: u64;

    constructor() {
        this.balance = 0;
    }

    deposit(amount: u64): void {
        assert(amount > 0, "Deposit amount must be greater than zero");
        this.balance += amount;
        generateEvent("Treasury: Deposited " + amount.toString());
    }

    withdraw(amount: u64): void {
        assert(amount > 0, "Withdrawal amount must be greater than zero");
        assert(amount <= this.balance, "Insufficient balance for withdrawal");
        this.balance -= amount;
        generateEvent("Treasury: Withdrawn " + amount.toString());
    }

    getBalance(): u64 {
        return this.balance;
    }

    payout(address: Address, amount: u64): void {
        assert(amount > 0, "Payout amount must be greater than zero");
        assert(amount <= this.balance, "Insufficient balance for payout");
        this.balance -= amount;
        // Logic to transfer amount to the address would go here
        generateEvent("Treasury: Payout of " + amount.toString() + " to " + address.toString());
    }
}