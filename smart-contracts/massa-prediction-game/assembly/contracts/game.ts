import {
    Address,
    Context,
    generateEvent,
    Storage,
} from "@massalabs/massa-as-sdk";
import { Args } from "@massalabs/as-types";
import { IGame } from "../interfaces/IGame";
import { Player } from "../models/Player";
import { Bet } from "../models/Bet";
import { Round } from "../models/Round";
import { ONE_UNIT } from "../utils/constants";

export class PredictionGame implements IGame {
    private gameId: u64;
    private players: Map<Address, Player>;
    private currentRound: Round | null;
    private status: string;

    constructor() {
        this.gameId = 0;
        this.players = new Map<Address, Player>();
        this.currentRound = null;
        this.status = "inactive";
    }

    startGame(): void {
        assert(this.status == "inactive", "Game is already active");
        this.status = "active";
        this.currentRound = new Round(this.gameId);
        generateEvent("GameStarted", [this.gameId.toString()]);
    }

    placeBet(amount: u64, prediction: string): void {
        assert(this.status == "active", "Game is not active");
        const caller = Context.caller();
        assert(!this.players.has(caller), "Player has already placed a bet");

        const player = new Player(caller, amount, true);
        this.players.set(caller, player);
        const bet = new Bet(player, amount, prediction);
        this.currentRound?.addBet(bet);
        generateEvent("BetPlaced", [caller.toString(), amount.toString(), prediction]);
    }

    settleGame(winningPrediction: string): void {
        assert(this.status == "active", "Game is not active");
        this.status = "settled";
        const winners: Address[] = [];

        for (const player of this.players.values()) {
            if (player.isActive) {
                const bet = this.currentRound?.getBetByPlayer(player.address);
                if (bet && bet.prediction == winningPrediction) {
                    winners.push(player.address);
                    // Payout logic can be added here
                }
            }
        }

        generateEvent("GameSettled", [this.gameId.toString(), winningPrediction, winners.join(",")]);
        this.resetGame();
    }

    private resetGame(): void {
        this.players.clear();
        this.currentRound = null;
        this.status = "inactive";
        this.gameId++;
    }
}