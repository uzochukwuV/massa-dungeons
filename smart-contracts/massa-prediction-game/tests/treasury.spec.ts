Sure, here's the proposed content for the `/massa-prediction-game/massa-prediction-game/tests/treasury.spec.ts` file:

import { Context, storage } from "@massalabs/massa-as-sdk";
import { Treasury } from "../assembly/contracts/treasury";
import { Address } from "@massalabs/massa-as-sdk";

describe("Treasury Contract", () => {
    let treasury: Treasury;

    beforeEach(() => {
        treasury = new Treasury();
        storage.clear(); // Clear storage before each test
    });

    it("should deposit funds correctly", () => {
        const initialBalance = treasury.getBalance();
        const depositAmount = 1000;

        treasury.deposit(depositAmount);

        const newBalance = treasury.getBalance();
        expect(newBalance).toBe(initialBalance + depositAmount);
    });

    it("should withdraw funds correctly", () => {
        const depositAmount = 1000;
        treasury.deposit(depositAmount);

        const withdrawAmount = 500;
        treasury.withdraw(withdrawAmount);

        const newBalance = treasury.getBalance();
        expect(newBalance).toBe(depositAmount - withdrawAmount);
    });

    it("should not allow withdrawal exceeding balance", () => {
        const depositAmount = 1000;
        treasury.deposit(depositAmount);

        const withdrawAmount = 1500;

        expect(() => {
            treasury.withdraw(withdrawAmount);
        }).toThrow("Insufficient balance");
    });

    it("should return correct balance", () => {
        const depositAmount = 2000;
        treasury.deposit(depositAmount);

        const balance = treasury.getBalance();
        expect(balance).toBe(depositAmount);
    });
});