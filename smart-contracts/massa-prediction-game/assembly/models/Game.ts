import { Player } from "../models/Player";
import { Bet } from "../models/Bet";
import { Round } from "../models/Round";

export class Game {
    private gameId: u64;
    private players: Map<string, Player>;
    private rounds: Round[];
    private status: string;

    constructor(gameId: u64) {
        this.gameId = gameId;
        this.players = new Map<string, Player>();
        this.rounds = [];
        this.status = "inactive"; // Possible statuses: inactive, active, settled
    }

    public addPlayer(playerAddress: string): void {
        if (!this.players.has(playerAddress)) {
            this.players.set(playerAddress, new Player(playerAddress));
        }
    }

    public placeBet(playerAddress: string, amount: u64, prediction: string): void {
        const player = this.players.get(playerAddress);
        if (player && player.isActive) {
            const bet = new Bet(player, amount, prediction);
            const currentRound = this.getCurrentRound();
            currentRound.addBet(bet);
        }
    }

    public startGame(): void {
        this.status = "active";
        this.rounds.push(new Round(this.rounds.length + 1));
    }

    public settleGame(): void {
        this.status = "settled";
        // Logic for settling the game and distributing payouts
    }

    private getCurrentRound(): Round {
        return this.rounds[this.rounds.length - 1];
    }

    public getGameId(): u64 {
        return this.gameId;
    }

    public getPlayers(): Map<string, Player> {
        return this.players;
    }

    public getStatus(): string {
        return this.status;
    }
}