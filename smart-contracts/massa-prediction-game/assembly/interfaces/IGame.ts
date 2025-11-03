export interface IGame {
    startGame(gameId: string, duration: u64): void;
    placeBet(playerAddress: string, amount: u64, prediction: boolean): void;
    settleGame(gameId: string): void;
    getGameStatus(gameId: string): string;
    getPlayerBets(playerAddress: string): Array<{ amount: u64; prediction: boolean }>;
}