import { Address } from "@massalabs/massa-as-sdk";

export class Bet {
    player: Address;
    amount: u64;
    prediction: boolean; // true for win, false for lose

    constructor(player: Address, amount: u64, prediction: boolean) {
        this.player = player;
        this.amount = amount;
        this.prediction = prediction;
    }
}