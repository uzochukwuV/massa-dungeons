Sure, here's the contents for the file `/massa-prediction-game/massa-prediction-game/jest.config.js`:

module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  testPathIgnorePatterns: ['/node_modules/', '/dist/'],
  transform: {
    '^.+\\.ts$': 'ts-jest',
  },
  moduleFileExtensions: ['ts', 'js', 'json', 'node'],
  coverageDirectory: 'coverage',
  collectCoverage: true,
  collectCoverageFrom: [
    'assembly/**/*.ts',
    '!assembly/**/*.spec.ts',
    '!assembly/**/index.ts',
  ],
};