Sure, here's the proposed content for the `/massa-prediction-game/massa-prediction-game/tests/game.spec.ts` file:

import { Game } from "../assembly/contracts/game";
import { Player } from "../assembly/models/Player";
import { Bet } from "../assembly/models/Bet";

describe("Prediction Game Contract", () => {
    let game: Game;

    beforeEach(() => {
        game = new Game();
    });

    test("should start a new game", () => {
        game.startGame();
        expect(game.status).toBe("active");
    });

    test("should allow players to place bets", () => {
        const player = new Player("0x123");
        game.startGame();
        game.placeBet(player, 100, "win");
        expect(game.players.length).toBe(1);
        expect(game.players[0].betAmount).toBe(100);
    });

    test("should not allow bets if game is not active", () => {
        const player = new Player("0x123");
        game.placeBet(player, 100, "win");
        expect(game.players.length).toBe(0);
    });

    test("should settle the game and distribute payouts", () => {
        const player1 = new Player("0x123");
        const player2 = new Player("0x456");
        game.startGame();
        game.placeBet(player1, 100, "win");
        game.placeBet(player2, 200, "lose");
        game.settleGame("win");

        expect(player1.isActive).toBe(false);
        expect(player2.isActive).toBe(false);
    });

    test("should emit events on game actions", () => {
        const spy = jest.spyOn(game, "emitEvent");
        game.startGame();
        expect(spy).toHaveBeenCalledWith("GameStarted");

        const player = new Player("0x123");
        game.placeBet(player, 100, "win");
        expect(spy).toHaveBeenCalledWith("BetPlaced", player.address, 100, "win");
    });
});