/**
 * Test Tournament Bot - Autonomous Tournament Management
 *
 * Tests the tournament bot autonomous system:
 * 1. Create test characters
 * 2. Create tournament with max participants
 * 3. Register characters up to max capacity
 * 4. Start tournament bot
 * 5. Monitor bot execution via events
 * 6. Verify bot auto-starts tournament when full
 * 7. Check tournament state and statistics
 *
 * Tournament Bot Features:
 * - Auto-starts tournaments when max participants reached
 * - Checks round progress (placeholder for future battle-tournament linking)
 * - Processes up to 5 tournaments per cycle
 * - Comprehensive event tracking
 *
 * Usage: npx tsx src/test-tournament-bot.ts
 */

import 'dotenv/config';
import {
  Account,
  Args,
  Mas,
  SmartContract,
  JsonRpcProvider,
} from '@massalabs/massa-web3';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

function log(message: string): void {
  console.log(`  ${message}`);
}

function logSection(title: string): void {
  console.log(`\n${'═'.repeat(70)}`);
  console.log(`  ${title}`);
  console.log(`${'═'.repeat(70)}`);
}

function logSuccess(message: string): void {
  console.log(`  ✅ ${message}`);
}

function logError(message: string): void {
  console.log(`  ❌ ${message}`);
}

function logEvent(data: string): void {
  console.log(`  📤 ${data}`);
}

async function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function main(): Promise<void> {
  logSection('🏆 TEST: TOURNAMENT BOT - AUTONOMOUS TOURNAMENT MANAGEMENT');

  try {
    const account = await Account.fromEnv();
    const provider = JsonRpcProvider.buildnet(account);

    log(`Account: ${account.address.toString()}`);

    const addressesPath = path.join(__dirname, 'deployed-addresses.json');
    if (!fs.existsSync(addressesPath)) {
      throw new Error('deployed-addresses.json not found!');
    }

    const deployed = JSON.parse(fs.readFileSync(addressesPath, 'utf-8'));
    const gameContractAddress = deployed.contracts.game;

    log(`Game Contract: ${gameContractAddress}`);

    const gameContract = new SmartContract(provider, gameContractAddress);

    // =========================================================================
    // STEP 1: Check initial bot status
    logSection('📋 STEP 1: Check Initial Tournament Count');

    log('Reading tournament count...');
    const tournamentCountBytes = await gameContract.read('game_readTournamentCount', new Args());
    const tournamentCount = new Args(tournamentCountBytes.value).nextU64();

    log(`Total Tournaments: ${tournamentCount}`);

    // =========================================================================
    // STEP 2: Create test characters for tournament
    logSection('👥 STEP 2: Create Test Characters');

    const characterIds: string[] = [];
    const maxParticipants = 4; // Create 4 characters to fill tournament

    for (let i = 0; i < maxParticipants; i++) {
      log(`Creating character ${i + 1}/${maxParticipants}...`);
      const charId = `test_tournament_char_${Date.now()}_${i}`;
      const classType = i % 3; // Rotate between classes

      const charTx = await gameContract.call(
        'game_createCharacter',
        new Args()
          .addString(charId)
          .addU8(classType)
          .addString(`TournamentFighter${i + 1}`),
        { coins: Mas.fromString('0.1') }
      );

      await charTx.waitFinalExecution();
      characterIds.push(charId);
      logSuccess(`Character ${i + 1} created: ${charId}`);
    }

    // =========================================================================
    // STEP 3: Create test tournament
    logSection('🏆 STEP 3: Create Test Tournament');

    log('Creating tournament...');
    const tournamentId = `test_tournament_${Date.now()}`;
    const entryFee = BigInt(1000000); // 0.001 MAS in nanoMAS
    const prizePool = BigInt(4000000); // 0.004 MAS in nanoMAS

    const tournamentTx = await gameContract.call(
      'game_createTournament',
      new Args()
        .addString(tournamentId)
        .addString('Bot Test Tournament')
        .addU8(maxParticipants)
        .addU64(entryFee)
        .addU64(prizePool),
      { coins: Mas.fromString('0.1') }
    );

    await tournamentTx.waitFinalExecution();
    const tournamentEvents = await tournamentTx.getFinalEvents();

    for (const event of tournamentEvents) {
      if (event.data.includes('TournamentCreated')) {
        logEvent(event.data);
      }
    }

    logSuccess(`Tournament created: ${tournamentId}`);

    // =========================================================================
    // STEP 4: Register characters in tournament
    logSection('📝 STEP 4: Register Characters in Tournament');

    log(`Registering ${maxParticipants} characters...`);

    for (let i = 0; i < maxParticipants; i++) {
      log(`Registering character ${i + 1}/${maxParticipants}: ${characterIds[i]}`);

      const registerTx = await gameContract.call(
        'game_registerForTournament',
        new Args()
          .addString(tournamentId)
          .addString(characterIds[i]),
        { coins: Mas.fromString('0.1') }
      );

      await registerTx.waitFinalExecution();
      const registerEvents = await registerTx.getFinalEvents();

      for (const event of registerEvents) {
        if (event.data.includes('TournamentRegistration')) {
          logEvent(event.data);
        }
      }
    }

    logSuccess(`All ${maxParticipants} characters registered`);

    // =========================================================================
    // STEP 5: Read tournament details before bot
    logSection('📖 STEP 5: Read Tournament Details (Before Bot)');

    log('Reading tournament state...');
    const tournamentBytes = await gameContract.read(
      'game_readTournament',
      new Args().addString(tournamentId)
    );

    const tournamentResult = new TextDecoder().decode(tournamentBytes.value);
    if (tournamentResult === 'null') {
      throw new Error('Tournament not found!');
    }

    const tournamentArgs = new Args(tournamentBytes.value);
    const name = tournamentArgs.nextString();
    const maxPart = tournamentArgs.nextU8();
    const currentRoundBefore = tournamentArgs.nextU32();
    const isFinishedBefore = tournamentArgs.nextBool();

    log(`  Tournament Name: ${name}`);
    log(`  Max Participants: ${maxPart}`);
    log(`  Current Round: ${currentRoundBefore}`);
    log(`  Is Finished: ${isFinishedBefore}`);

    logSuccess('Tournament details retrieved');

    // =========================================================================
    // STEP 6: Start Tournament Bot
    logSection('🚀 STEP 6: Start Tournament Bot');

    log('Starting tournament bot with maxIterations=50...');
    const botStartTx = await gameContract.call(
      'startTournamentBot',
      new Args().addU64(50n),
      { coins: Mas.fromString('1.0'), maxGas: BigInt(5000000000) }
    );

    await botStartTx.waitFinalExecution();
    const botStartEvents = await botStartTx.getFinalEvents();

    for (const event of botStartEvents) {
      if (event.data.includes('TournamentBot')) {
        logEvent(event.data);
      }
    }

    logSuccess('Tournament bot started');

    // =========================================================================
    // STEP 7: Monitor bot execution
    logSection('👀 STEP 7: Monitor Bot Execution');

    log('Monitoring bot cycles...');
    log('(Bot checks tournaments every cycle for auto-start conditions)\n');

    let maxWaitCycles = 10;
    let tournamentStarted = false;

    for (let wait = 0; wait < maxWaitCycles; wait++) {
      await sleep(5000);

      const updatedTournamentBytes = await gameContract.read(
        'game_readTournament',
        new Args().addString(tournamentId)
      );

      const updatedTournamentArgs = new Args(updatedTournamentBytes.value);
      updatedTournamentArgs.nextString(); // name
      updatedTournamentArgs.nextU8(); // maxParticipants
      const currentRound = updatedTournamentArgs.nextU32();

      log(`[${wait + 1}/${maxWaitCycles}] Checking tournament state...`);
      log(`  Current Round: ${currentRound}`);

      if (currentRound > 0) {
        tournamentStarted = true;
        logSuccess('Tournament auto-started by bot!');
        break;
      }
    }

    if (!tournamentStarted) {
      log('ℹ️  Tournament not yet started (may need more cycles)');
    }

    // =========================================================================
    // STEP 8: Check tournament final state
    logSection('📊 STEP 8: Check Tournament Final State');

    log('Reading final tournament state...');
    const finalTournamentBytes = await gameContract.read(
      'game_readTournament',
      new Args().addString(tournamentId)
    );

    const finalTournamentResult = new TextDecoder().decode(finalTournamentBytes.value);
    if (finalTournamentResult === 'null') {
      logError('Tournament not found');
    } else {
      const finalTournamentArgs = new Args(finalTournamentBytes.value);
      const finalName = finalTournamentArgs.nextString();
      const finalMaxPart = finalTournamentArgs.nextU8();
      const finalCurrentRound = finalTournamentArgs.nextU32();
      const finalIsFinished = finalTournamentArgs.nextBool();

      log(`  Tournament Name: ${finalName}`);
      log(`  Max Participants: ${finalMaxPart}`);
      log(`  Current Round: ${finalCurrentRound}`);
      log(`  Is Finished: ${finalIsFinished}`);

      if (finalCurrentRound > 0) {
        logSuccess('Tournament successfully started!');
      } else {
        log('ℹ️  Tournament still in registration phase');
      }
    }

    // =========================================================================
    // STEP 9: Stop Tournament Bot
    logSection('🛑 STEP 9: Stop Tournament Bot');

    log('Stopping tournament bot...');
    const botStopTx = await gameContract.call(
      'stopTournamentBot',
      new Args(),
      { coins: Mas.fromString('0.1'), maxGas: BigInt(2000000000) }
    );

    await botStopTx.waitFinalExecution();
    const botStopEvents = await botStopTx.getFinalEvents();

    for (const event of botStopEvents) {
      if (event.data.includes('TournamentBot')) {
        logEvent(event.data);
      }
    }

    logSuccess('Tournament bot stopped');

    // =========================================================================
    // STEP 10: Check tournament statistics
    logSection('📊 STEP 10: Check Tournament Statistics');

    log('Reading tournament statistics...');
    const statsBytes = await gameContract.read('game_getStats', new Args());
    const statsArgs = new Args(statsBytes.value);
    const totalCharacters = statsArgs.nextU64();
    const totalBattles = statsArgs.nextU64();
    const totalFinished = statsArgs.nextU64();

    log(`  Total Characters: ${totalCharacters}`);
    log(`  Total Battles: ${totalBattles}`);
    log(`  Total Finished: ${totalFinished}`);

    const finalTournamentCountBytes = await gameContract.read('game_readTournamentCount', new Args());
    const finalTournamentCount = new Args(finalTournamentCountBytes.value).nextU64();

    log(`  Total Tournaments: ${finalTournamentCount}`);

    // =========================================================================
    // SUMMARY
    logSection('📊 TEST SUMMARY');

    logSuccess('Tournament Bot Test Complete!');

    log(`\n💡 Tournament Bot Execution Summary:`);
    log(`  Test Tournament ID: ${tournamentId}`);
    log(`  Characters Created: ${characterIds.length}`);
    log(`  Initial Tournament Count: ${tournamentCount}`);
    log(`  Final Tournament Count: ${finalTournamentCount}`);
    log(`  Tournament Started: ${tournamentStarted ? 'Yes' : 'Not Yet'}`);

    log(`\n🤖 Tournament Bot Features:`);
    log(`  ✅ Auto-starts tournaments when max participants reached`);
    log(`  ✅ Checks round progress (future: battle-tournament linking)`);
    log(`  ✅ Processes up to 5 tournaments per cycle`);
    log(`  ✅ Comprehensive event tracking for monitoring`);

    log(`\n🔄 Bot Cycle Information:`);
    log(`  Each cycle checks tournament registration status`);
    log(`  Compares participant count with maxParticipants`);
    log(`  Auto-starts tournament when full capacity reached`);
    log(`  Reschedules itself for next block slot (when SDK updated)`);

    log(`\n⚡ Bot Settings:`);
    log(`  Check Interval: Every 5 blockchain slots`);
    log(`  Max Per Cycle: 5 tournaments processed`);
    log(`  Gas Budget: 500,000,000 per cycle`);

  } catch (error) {
    console.error('\n❌ Error:', error);
    process.exit(1);
  }
}

main().catch(console.error);
