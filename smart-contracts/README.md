# Massa Prediction Game

## Overview

The Massa Prediction Game is an on-chain game built on the Massa blockchain that allows players to place bets on various outcomes. The game features a dynamic betting system, player interactions, and settlement logic to determine winners and distribute payouts.

## Features

- **Betting Mechanics**: Players can place bets on different predictions and compete against each other.
- **Game Rounds**: The game is structured into rounds, allowing for multiple betting opportunities.
- **Event Notifications**: Significant actions in the game emit events to notify external listeners.
- **Treasury Management**: A dedicated treasury contract manages funds, ensuring secure payouts and balance maintenance.

## Project Structure

```
massa-prediction-game
├── assembly
│   ├── contracts
│   │   ├── game.ts          # Main game logic
│   │   ├── events.ts        # Event definitions
│   │   └── treasury.ts      # Treasury management
│   ├── interfaces
│   │   ├── IGame.ts         # Game interface
│   │   └── ITreasury.ts     # Treasury interface
│   ├── models
│   │   ├── Player.ts        # Player representation
│   │   ├── Game.ts          # Game state management
│   │   ├── Bet.ts           # Bet representation
│   │   └── Round.ts         # Round management
│   └── utils
│       ├── constants.ts     # Constant values
│       └── helpers.ts       # Utility functions
├── tests
│   ├── game.spec.ts         # Unit tests for game contract
│   └── treasury.spec.ts     # Unit tests for treasury contract
├── package.json              # NPM configuration
├── asconfig.json             # AssemblyScript configuration
├── jest.config.js            # Jest configuration
└── README.md                 # Project documentation
```

## Setup Instructions

1. Clone the repository:
   ```bash
   git clone <repository-url>
   cd massa-prediction-game
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. Compile the project:
   ```bash
   npm run build
   ```

4. Run tests:
   ```bash
   npm test
   ```

## Usage

To interact with the Massa Prediction Game, deploy the smart contracts on the Massa blockchain and use the provided interfaces to start games, place bets, and settle outcomes.

## Contributing

Contributions are welcome! Please submit a pull request or open an issue for any enhancements or bug fixes.

## License

This project is licensed under the MIT License. See the LICENSE file for details.